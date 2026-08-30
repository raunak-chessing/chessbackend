import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { SocialEventService } from './social-event.service';
import * as crypto from 'crypto';

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly socialEventService: SocialEventService,
  ) {}

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      include: {
        requester: {
          select: { id: true, name: true, rating: true, image: true },
        },
        receiver: {
          select: { id: true, name: true, rating: true, image: true },
        },
      },
    });

    const mappedFriends = friendships.map((f) => {
      const isRequester = f.requesterId === userId;
      return isRequester ? f.receiver : f.requester;
    });

    const result = await Promise.all(
      mappedFriends.map(async (friend) => {
        const count = await this.cacheService.get(`presence:${friend.id}`);
        return {
          ...friend,
          isOnline: count ? parseInt(count) > 0 : false,
        };
      }),
    );

    return result;
  }

  async getPendingRequests(userId: string) {
    const incoming = await this.prisma.friendship.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      include: {
        requester: {
          select: { id: true, name: true, rating: true, image: true },
        },
      },
    });

    const outgoing = await this.prisma.friendship.findMany({
      where: { requesterId: userId, status: 'PENDING' },
      include: {
        receiver: {
          select: { id: true, name: true, rating: true, image: true },
        },
      },
    });

    return { incoming, outgoing };
  }

  async sendFriendRequest(requesterId: string, receiverId: string) {
    if (requesterId === receiverId)
      throw new BadRequestException('Cannot friend yourself');

    const [min, max] = requesterId < receiverId ? [requesterId, receiverId] : [receiverId, requesterId];
    const lockKey = `friend_req:${min}:${max}`;
    
    // Acquire simple Redis lock
    const locked = await this.cacheService.acquireLock(lockKey, 5);
    if (!locked) {
      throw new BadRequestException('Friendship request already in progress');
    }

    try {
      const existing = await this.prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId, receiverId },
            { requesterId: receiverId, receiverId: requesterId },
          ],
        },
      });

      if (existing) {
        throw new BadRequestException('Friendship or request already exists');
      }

      const newReq = await this.prisma.friendship.create({
        data: { requesterId, receiverId, status: 'PENDING' },
      });

      await this.socialEventService.publish(receiverId, 'friendRequestReceived', newReq);
      return newReq;
    } finally {
      await this.cacheService.releaseLock(lockKey);
    }
  }

  async acceptFriendRequest(userId: string, friendshipId: string) {
    const request = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
    });
    if (!request) throw new BadRequestException('Request not found');
    if (request.receiverId !== userId)
      throw new BadRequestException('Unauthorized');
    if (request.status === 'ACCEPTED') return request;

    return this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'ACCEPTED' },
    });
  }

  async declineFriendRequest(userId: string, friendshipId: string) {
    const request = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
    });
    if (!request) throw new BadRequestException('Request not found');
    if (request.receiverId !== userId && request.requesterId !== userId)
      throw new BadRequestException('Unauthorized');

    return this.prisma.friendship.delete({ where: { id: friendshipId } });
  }



  async getIncomingChallenges(userId: string) {
    return this.prisma.challenge.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      include: {
        sender: { select: { id: true, name: true, rating: true, image: true } },
      },
    });
  }

  async sendChallenge(
    senderId: string,
    receiverId: string,
    timeControl: string,
    colorPref: string,
  ) {
    if (senderId === receiverId)
      throw new BadRequestException('Cannot challenge yourself');

    const newChallenge = await this.prisma.challenge.create({
      data: {
        senderId,
        receiverId,
        timeControl,
        colorPref,
        status: 'PENDING',
      },
      include: {
        sender: { select: { id: true, name: true, rating: true, image: true } },
      },
    });

    await this.socialEventService.publish(receiverId, 'challengeReceived', newChallenge);
    return newChallenge;
  }

  async acceptChallenge(userId: string, challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });
    if (!challenge) throw new BadRequestException('Challenge not found');
    if (challenge.receiverId !== userId)
      throw new BadRequestException('Unauthorized');
    if (challenge.status !== 'PENDING')
      throw new BadRequestException('Challenge no longer pending');

    let whitePlayerId = challenge.senderId;
    let blackPlayerId = challenge.receiverId;

    if (challenge.colorPref === 'b') {
      whitePlayerId = challenge.receiverId;
      blackPlayerId = challenge.senderId;
    } else if (challenge.colorPref === 'random') {
      // Secure random choice
      if (crypto.randomBytes(1)[0] > 127) {
        whitePlayerId = challenge.receiverId;
        blackPlayerId = challenge.senderId;
      }
    }

    const gameId = crypto.randomUUID();
    const timeLimits = challenge.timeControl.split('|');
    const baseTimeMs = parseInt(timeLimits[0] || '10', 10) * 60 * 1000;
    const incrementMs = parseInt(timeLimits[1] || '0', 10) * 1000;

    await this.prisma.$transaction([
      this.prisma.challenge.update({
        where: { id: challengeId },
        data: { status: 'ACCEPTED' },
      }),
      this.prisma.game.create({
        data: {
          id: gameId,
          whitePlayerId,
          blackPlayerId,
          timeControl: challenge.timeControl,
          gameType: 'LIVE',
          status: 'IN_PROGRESS',
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          whiteTimeMs: baseTimeMs,
          blackTimeMs: baseTimeMs,
          incrementMs: incrementMs,
          lastMoveTime: new Date()
        }
      }),
    ]);

    await this.socialEventService.publish(challenge.senderId, 'challengeAccepted', {
      challengeId,
      gameId,
      message: 'Game created!',
    });
    await this.socialEventService.publish(challenge.receiverId, 'challengeAccepted', {
      challengeId,
      gameId,
      message: 'Game created!',
    });

    return { gameId };
  }

  async declineChallenge(userId: string, challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });
    if (!challenge) throw new BadRequestException('Challenge not found');
    if (challenge.receiverId !== userId && challenge.senderId !== userId)
      throw new BadRequestException('Unauthorized');

    return this.prisma.challenge.update({
      where: { id: challengeId },
      data: { status: 'DECLINED' },
    });
  }

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new BadRequestException('Cannot block yourself');
    
    await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: blockerId, receiverId: blockedId },
          { requesterId: blockedId, receiverId: blockerId }
        ]
      }
    });

    return this.prisma.block.upsert({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId
        }
      },
      create: {
        blockerId,
        blockedId
      },
      update: {}
    });
  }

  async unblockUser(blockerId: string, blockedId: string) {
    return this.prisma.block.deleteMany({
      where: { blockerId, blockedId }
    });
  }

  async reportUser(reporterId: string, reportedId: string, reason: string, description?: string) {
    if (reporterId === reportedId) throw new BadRequestException('Cannot report yourself');
    
    return this.prisma.report.create({
      data: {
        reporterId,
        reportedId,
        reason,
        description
      }
    });
  }
}
