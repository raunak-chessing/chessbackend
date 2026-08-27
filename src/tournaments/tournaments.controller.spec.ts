import { Test, TestingModule } from '@nestjs/testing';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from '../admin/guards/admin.guard';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => jest.fn(),
}));

const mockTournamentsService = {
  listTournaments: jest.fn(),
  getTournament: jest.fn(),
  joinTournament: jest.fn(),
  createArena: jest.fn(),
  createSwiss: jest.fn(),
  getStandings: jest.fn(),
  getPairingsForRound: jest.fn(),
};

describe('TournamentsController', () => {
  let controller: TournamentsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TournamentsController],
      providers: [{ provide: TournamentsService, useValue: mockTournamentsService }],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TournamentsController>(TournamentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getTournaments', () => {
    it('should call listTournaments on service', async () => {
      mockTournamentsService.listTournaments.mockResolvedValueOnce([{ id: 't1' }]);
      const res = await controller.getTournaments();
      expect(mockTournamentsService.listTournaments).toHaveBeenCalled();
      expect(res).toEqual([{ id: 't1' }]);
    });
  });

  describe('getTournamentDetails', () => {
    it('should call getTournament on service', async () => {
      mockTournamentsService.getTournament.mockResolvedValueOnce({ id: 't1' });
      const res = await controller.getTournamentDetails('t1');
      expect(mockTournamentsService.getTournament).toHaveBeenCalledWith('t1');
      expect(res).toEqual({ id: 't1' });
    });
  });

  describe('joinTournament', () => {
    it('should throw UnauthorizedException if no user', async () => {
      await expect(controller.joinTournament('', 't1')).rejects.toThrow(UnauthorizedException);
    });

    it('should call joinTournament on service', async () => {
      mockTournamentsService.joinTournament.mockResolvedValueOnce({ id: 'p1' });
      const res = await controller.joinTournament('u1', 't1');
      expect(mockTournamentsService.joinTournament).toHaveBeenCalledWith('u1', 't1');
      expect(res).toEqual({ id: 'p1' });
    });
  });

  describe('createArena', () => {
    // Admin-only enforcement now lives in AdminGuard (see admin.guard.spec.ts),
    // not in the controller method itself.
    it('should call createArena on service with calculated startTime', async () => {
      mockTournamentsService.createArena.mockResolvedValueOnce({ id: 't1' });

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const res = await controller.createArena({
        name: 'Arena 1',
        timeControl: 'BULLET',
        startsInMinutes: 10,
        durationMinutes: 60,
      });

      const expectedTime = new Date(now + 10 * 60000);

      expect(mockTournamentsService.createArena).toHaveBeenCalledWith(
        'Arena 1', 'BULLET', expectedTime, 60
      );
      expect(res).toEqual({ id: 't1' });

      jest.spyOn(Date, 'now').mockRestore();
    });
  });

  describe('createSwiss', () => {
    it('should call createSwiss on service with calculated startTime', async () => {
      mockTournamentsService.createSwiss.mockResolvedValueOnce({ id: 't2' });

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const res = await controller.createSwiss({
        name: 'Swiss 1',
        timeControl: '10|0',
        maxRounds: 5,
        startsInMinutes: 15,
      });

      const expectedTime = new Date(now + 15 * 60000);

      expect(mockTournamentsService.createSwiss).toHaveBeenCalledWith(
        'Swiss 1', '10|0', 5, expectedTime
      );
      expect(res).toEqual({ id: 't2' });

      jest.spyOn(Date, 'now').mockRestore();
    });
  });

  describe('getStandings', () => {
    it('should call getStandings on service', async () => {
      mockTournamentsService.getStandings.mockResolvedValueOnce([{ id: 'p1' }]);
      const res = await controller.getStandings('t1');
      expect(mockTournamentsService.getStandings).toHaveBeenCalledWith('t1');
      expect(res).toEqual([{ id: 'p1' }]);
    });
  });

  describe('getPairings', () => {
    it('should call getPairingsForRound on service with a parsed round number', async () => {
      mockTournamentsService.getPairingsForRound.mockResolvedValueOnce([{ id: 'pr1' }]);
      const res = await controller.getPairings('t1', '2');
      expect(mockTournamentsService.getPairingsForRound).toHaveBeenCalledWith('t1', 2);
      expect(res).toEqual([{ id: 'pr1' }]);
    });
  });
});
