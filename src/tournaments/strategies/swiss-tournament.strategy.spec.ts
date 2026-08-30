import { Test, TestingModule } from '@nestjs/testing';
import { TournamentType, GameWinner } from '@prisma/client';
import { SwissTournamentStrategy } from './swiss-tournament.strategy';
import { getPrismaMockProvider, prismaMock } from '../../test/mocks/prisma.mock';
import { SwissRoundService } from '../swiss-round.service';

describe('SwissTournamentStrategy', () => {
  let strategy: SwissTournamentStrategy;
  let swissRoundService: jest.Mocked<Pick<SwissRoundService, 'startNextRound' | 'maybeAdvanceSwissRound'>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    swissRoundService = { startNextRound: jest.fn(), maybeAdvanceSwissRound: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwissTournamentStrategy,
        getPrismaMockProvider(),
        { provide: SwissRoundService, useValue: swissRoundService },
      ],
    }).compile();

    strategy = module.get<SwissTournamentStrategy>(SwissTournamentStrategy);
  });

  it('declares its type as SWISS', () => {
    expect(strategy.type).toBe(TournamentType.SWISS);
  });

  it('onStarted kicks off the first round', async () => {
    await strategy.onStarted('t1');
    expect(swissRoundService.startNextRound).toHaveBeenCalledWith('t1');
  });

  it('onGameEnded records the pairing result and checks for round advancement', async () => {
    await strategy.onGameEnded('t1', 'g1', GameWinner.WHITE);

    expect(prismaMock.tournamentPairing.updateMany).toHaveBeenCalledWith({
      where: { gameId: 'g1' },
      data: { result: GameWinner.WHITE },
    });
    expect(swissRoundService.maybeAdvanceSwissRound).toHaveBeenCalledWith('t1');
  });

  it('records a draw when the winner is null', async () => {
    await strategy.onGameEnded('t1', 'g1', null);

    expect(prismaMock.tournamentPairing.updateMany).toHaveBeenCalledWith({
      where: { gameId: 'g1' },
      data: { result: 'DRAW' },
    });
  });
});
