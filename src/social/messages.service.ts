import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocialEventService } from './social-event.service';

interface ConversationSummaryRow {
  partnerId: string;
  content: string;
  createdAt: Date;
  senderId: string;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socialEventService: SocialEventService,
  ) {}

  private async assertNotBlocked(userAId: string, userBId: string) {
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userAId, blockedId: userBId },
          { blockerId: userBId, blockedId: userAId },
        ],
      },
    });
    if (blocked) throw new ForbiddenException('Cannot message this user');
  }

  async sendMessage(senderId: string, receiverId: string, content: string) {
    if (senderId === receiverId) throw new BadRequestException('Cannot message yourself');

    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true },
    });
    if (!receiver) throw new NotFoundException('User not found');

    await this.assertNotBlocked(senderId, receiverId);

    const message = await this.prisma.message.create({
      data: { senderId, receiverId, content },
    });

    await this.socialEventService.publish(receiverId, 'dmReceived', message);

    return message;
  }

  async getConversation(userId: string, otherUserId: string, cursor?: string) {
    const messages = await this.prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    await this.prisma.message.updateMany({
      where: { senderId: otherUserId, receiverId: userId, readAt: null },
      data: { readAt: new Date() },
    });

    return messages.reverse();
  }

  async listConversations(userId: string) {
    const rows = await this.prisma.$queryRaw<ConversationSummaryRow[]>`
      SELECT DISTINCT ON (partner_id)
        partner_id AS "partnerId",
        content,
        "createdAt",
        "senderId"
      FROM (
        SELECT
          CASE WHEN "senderId" = ${userId} THEN "receiverId" ELSE "senderId" END AS partner_id,
          content,
          "createdAt",
          "senderId"
        FROM "Message"
        WHERE ("senderId" = ${userId} OR "receiverId" = ${userId})
          AND "receiverId" IS NOT NULL
      ) conversations
      ORDER BY partner_id, "createdAt" DESC
    `;

    if (rows.length === 0) return [];

    const partnerIds = rows.map((row) => row.partnerId);

    const [partners, unreadCounts] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: partnerIds } },
        select: { id: true, name: true, image: true },
      }),
      this.prisma.message.groupBy({
        by: ['senderId'],
        where: { receiverId: userId, senderId: { in: partnerIds }, readAt: null },
        _count: { _all: true },
      }),
    ]);

    const partnersById = new Map(partners.map((partner) => [partner.id, partner]));
    const unreadByPartnerId = new Map(unreadCounts.map((row) => [row.senderId, row._count._all]));

    return rows
      .map((row) => ({
        partner: partnersById.get(row.partnerId) ?? null,
        lastMessage: {
          content: row.content,
          createdAt: row.createdAt,
          senderId: row.senderId,
        },
        unreadCount: unreadByPartnerId.get(row.partnerId) ?? 0,
      }))
      .filter((conversation) => conversation.partner !== null)
      .sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime());
  }
}
