import {
  Injectable,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocialGateway } from './social.gateway';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => SocialGateway))
    private readonly socialGateway: SocialGateway,
    private readonly redisService: RedisService,
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

    return friendships.map((f) => {
      const isRequester = f.requesterId === userId;
      return isRequester ? f.receiver : f.requester;
    });
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
    const locked = await this.redisService.getClient().set(lockKey, '1', 'EX', 5, 'NX');
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

      this.socialGateway.notifyUser(receiverId, 'friendRequestReceived', newReq);
      return newReq;
    } finally {
      await this.redisService.getClient().del(lockKey);
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

    this.socialGateway.notifyUser(
      receiverId,
      'challengeReceived',
      newChallenge,
    );
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

    await this.prisma.challenge.update({
      where: { id: challengeId },
      data: { status: 'ACCEPTED' },
    });


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

    // Publish to Go Gameserver via Redis (Split-Brain Fix)
    const payload = JSON.stringify({
      type: 'create_match',
      challengeId,
      whitePlayerId,
      blackPlayerId,
      timeControl: challenge.timeControl,
      gameType: 'LIVE',
    });
    
    await this.redisService.getClient().publish('gameserver:events', payload);

    this.socialGateway.notifyUser(challenge.senderId, 'challengeAccepted', {
      challengeId,
      message: 'Game creation requested',
    });
    this.socialGateway.notifyUser(challenge.receiverId, 'challengeAccepted', {
      challengeId,
      message: 'Game creation requested',
    });

    return { success: true, message: 'Game creation requested to Go Gameserver' };
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
}
