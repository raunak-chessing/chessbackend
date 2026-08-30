import { Test, TestingModule } from '@nestjs/testing';
import { FactionsController } from './factions.controller';
import { FactionsService } from './factions.service';
import { DivisionPromotionService } from './division-promotion.service';
import { UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest } from '../types';

const mockFactionsService = {
  getAllFactions: jest.fn(),
  joinFaction: jest.fn(),
};

const mockDivisionPromotionService = {
  getCurrentDivisions: jest.fn(),
};

describe('FactionsController', () => {
  let controller: FactionsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FactionsController],
      providers: [
        { provide: FactionsService, useValue: mockFactionsService },
        { provide: DivisionPromotionService, useValue: mockDivisionPromotionService },
      ],
    }).compile();

    controller = module.get<FactionsController>(FactionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFactions', () => {
    it('should call getAllFactions on the service', async () => {
      mockFactionsService.getAllFactions.mockResolvedValueOnce([{ id: 'faction-1' }]);
      const res = await controller.getFactions();
      expect(mockFactionsService.getAllFactions).toHaveBeenCalled();
      expect(res).toEqual([{ id: 'faction-1' }]);
    });
  });

  describe('getDivisions', () => {
    it('should call getCurrentDivisions on the division promotion service', async () => {
      mockDivisionPromotionService.getCurrentDivisions.mockResolvedValueOnce([{ tier: 'WOOD' }]);
      const res = await controller.getDivisions();
      expect(mockDivisionPromotionService.getCurrentDivisions).toHaveBeenCalled();
      expect(res).toEqual([{ tier: 'WOOD' }]);
    });
  });

  describe('joinFaction', () => {
    it('should throw UnauthorizedException if user is not present', async () => {
      const req = { user: null } as unknown as AuthenticatedRequest;
      await expect(controller.joinFaction(req, 'faction-1')).rejects.toThrow(UnauthorizedException);
    });

    it('should call joinFaction on the service if user is present', async () => {
      const req = { user: { id: 'user-1' } } as unknown as AuthenticatedRequest;
      mockFactionsService.joinFaction.mockResolvedValueOnce({ id: 'user-1', factionId: 'faction-1' });
      const res = await controller.joinFaction(req, 'faction-1');
      expect(mockFactionsService.joinFaction).toHaveBeenCalledWith('user-1', 'faction-1');
      expect(res).toEqual({ id: 'user-1', factionId: 'faction-1' });
    });
  });
});
