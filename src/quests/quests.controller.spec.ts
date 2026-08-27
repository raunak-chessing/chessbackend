import { Test, TestingModule } from '@nestjs/testing';
import { QuestsController } from './quests.controller';
import { QuestsService } from './quests.service';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthenticatedRequest } from '../types';

const mockQuestsService = {
  getActiveQuests: jest.fn(),
  claimQuestReward: jest.fn(),
};

describe('QuestsController', () => {
  let controller: QuestsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuestsController],
      providers: [{ provide: QuestsService, useValue: mockQuestsService }],
    }).compile();

    controller = module.get<QuestsController>(QuestsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getActiveQuests', () => {
    it('should return empty array if user is not authenticated', async () => {
      const req = { user: null } as unknown as AuthenticatedRequest;
      const res = await controller.getActiveQuests(req);
      expect(res).toEqual([]);
      expect(mockQuestsService.getActiveQuests).not.toHaveBeenCalled();
    });

    it('should call getActiveQuests on service if authenticated', async () => {
      const req = { user: { id: 'u1' } } as unknown as AuthenticatedRequest;
      mockQuestsService.getActiveQuests.mockResolvedValueOnce([{ id: 'q1' }]);
      const res = await controller.getActiveQuests(req);
      expect(mockQuestsService.getActiveQuests).toHaveBeenCalledWith('u1');
      expect(res).toEqual([{ id: 'q1' }]);
    });
  });

  describe('claimQuestReward', () => {
    it('should throw UnauthorizedException if not authenticated', async () => {
      const req = { user: null } as unknown as AuthenticatedRequest;
      await expect(controller.claimQuestReward(req, 'q1')).rejects.toThrow(UnauthorizedException);
    });

    it('should call claimQuestReward on service and return result', async () => {
      const req = { user: { id: 'u1' } } as unknown as AuthenticatedRequest;
      mockQuestsService.claimQuestReward.mockResolvedValueOnce({ id: 'inv' });
      const res = await controller.claimQuestReward(req, 'q1');
      expect(mockQuestsService.claimQuestReward).toHaveBeenCalledWith('u1', 'q1');
      expect(res).toEqual({ id: 'inv' });
    });

    it('should catch errors and throw BadRequestException', async () => {
      const req = { user: { id: 'u1' } } as unknown as AuthenticatedRequest;
      mockQuestsService.claimQuestReward.mockRejectedValueOnce(new BadRequestException('Quest not completed'));
      
      await expect(controller.claimQuestReward(req, 'q1')).rejects.toThrow(BadRequestException);
    });
  });
});
