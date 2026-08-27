import { Test, TestingModule } from '@nestjs/testing';
import { DailyGamesController } from './daily-games.controller';
import { DailyGamesService } from './daily-games.service';
import { UnauthorizedException } from '@nestjs/common';
import { CreateDailyGameDto, MakeDailyMoveDto } from './dto/daily-games.dto';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => jest.fn(),
}));

const mockDailyGamesService = {
  createDailyGame: jest.fn(),
  getMyDailyGames: jest.fn(),
  getGameById: jest.fn(),
  makeMove: jest.fn(),
};

describe('DailyGamesController', () => {
  let controller: DailyGamesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DailyGamesController],
      providers: [{ provide: DailyGamesService, useValue: mockDailyGamesService }],
    }).compile();

    controller = module.get<DailyGamesController>(DailyGamesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createGame', () => {
    it('should throw UnauthorizedException if no user', async () => {
      await expect(controller.createGame('', {} as CreateDailyGameDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should call createDailyGame on service', async () => {
      mockDailyGamesService.createDailyGame.mockResolvedValueOnce({ id: 'g1' });
      const res = await controller.createGame('u1', { opponentId: 'u2', daysPerMove: 3 });
      expect(mockDailyGamesService.createDailyGame).toHaveBeenCalledWith('u1', 'u2', 3);
      expect(res).toEqual({ id: 'g1' });
    });
  });

  describe('getMyGames', () => {
    it('should throw UnauthorizedException if no user', async () => {
      await expect(controller.getMyGames('')).rejects.toThrow(UnauthorizedException);
    });

    it('should call getMyDailyGames on service', async () => {
      mockDailyGamesService.getMyDailyGames.mockResolvedValueOnce([{ id: 'g1' }]);
      const res = await controller.getMyGames('u1');
      expect(mockDailyGamesService.getMyDailyGames).toHaveBeenCalledWith('u1');
      expect(res).toEqual([{ id: 'g1' }]);
    });
  });

  describe('getGame', () => {
    it('should call getGameById on service', async () => {
      mockDailyGamesService.getGameById.mockResolvedValueOnce({ id: 'g1' });
      const res = await controller.getGame('g1');
      expect(mockDailyGamesService.getGameById).toHaveBeenCalledWith('g1');
      expect(res).toEqual({ id: 'g1' });
    });
  });

  describe('makeMove', () => {
    it('should throw UnauthorizedException if no user', async () => {
      await expect(controller.makeMove('', 'g1', {} as MakeDailyMoveDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should call makeMove on service', async () => {
      mockDailyGamesService.makeMove.mockResolvedValueOnce({ id: 'g1' });
      const res = await controller.makeMove('u1', 'g1', { from: 'e2', to: 'e4' });
      expect(mockDailyGamesService.makeMove).toHaveBeenCalledWith('u1', 'g1', 'e2', 'e4');
      expect(res).toEqual({ id: 'g1' });
    });
  });
});
