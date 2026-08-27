import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { SocialEventService } from './social-event.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('MessagesService', () => {
  let service: MessagesService;
  const socialEventServiceMock = { publish: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        getPrismaMockProvider(),
        { provide: SocialEventService, useValue: socialEventServiceMock },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    it('rejects messaging yourself', async () => {
      await expect(service.sendMessage('user-1', 'user-1', 'hi')).rejects.toThrow(BadRequestException);
    });

    it('rejects when the receiver does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.sendMessage('user-1', 'user-2', 'hi')).rejects.toThrow(NotFoundException);
    });

    it('rejects when either user has blocked the other', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user-2' } as any);
      prismaMock.block.findFirst.mockResolvedValueOnce({ id: 'block-1' } as any);

      await expect(service.sendMessage('user-1', 'user-2', 'hi')).rejects.toThrow(ForbiddenException);
      expect(prismaMock.message.create).not.toHaveBeenCalled();
    });

    it('creates the message and publishes a dmReceived event', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user-2' } as any);
      prismaMock.block.findFirst.mockResolvedValueOnce(null);
      const message = { id: 'msg-1', senderId: 'user-1', receiverId: 'user-2', content: 'hi' };
      prismaMock.message.create.mockResolvedValueOnce(message as any);

      const result = await service.sendMessage('user-1', 'user-2', 'hi');

      expect(result).toEqual(message);
      expect(socialEventServiceMock.publish).toHaveBeenCalledWith('user-2', 'dmReceived', message);
    });
  });

  describe('getConversation', () => {
    it('marks unread messages from the other user as read', async () => {
      prismaMock.message.findMany.mockResolvedValueOnce([]);
      prismaMock.message.updateMany.mockResolvedValueOnce({ count: 2 } as any);

      await service.getConversation('user-1', 'user-2');

      expect(prismaMock.message.updateMany).toHaveBeenCalledWith({
        where: { senderId: 'user-2', receiverId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('listConversations', () => {
    it('returns an empty list when there are no conversations', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([] as any);

      const result = await service.listConversations('user-1');

      expect(result).toEqual([]);
    });

    it('attaches partner info and unread counts to each conversation', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { partnerId: 'user-2', content: 'hey', createdAt: new Date('2026-08-27T00:00:00Z'), senderId: 'user-2' },
      ] as any);
      prismaMock.user.findMany.mockResolvedValueOnce([
        { id: 'user-2', name: 'Bob', image: null },
      ] as any);
      prismaMock.message.groupBy.mockResolvedValueOnce([
        { senderId: 'user-2', _count: { _all: 3 } },
      ] as any);

      const result = await service.listConversations('user-1');

      expect(result).toEqual([
        {
          partner: { id: 'user-2', name: 'Bob', image: null },
          lastMessage: { content: 'hey', createdAt: new Date('2026-08-27T00:00:00Z'), senderId: 'user-2' },
          unreadCount: 3,
        },
      ]);
    });
  });
});
