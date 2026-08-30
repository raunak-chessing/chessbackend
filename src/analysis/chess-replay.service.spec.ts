import { ChessReplayService } from './chess-replay.service';

describe('ChessReplayService', () => {
  const service = new ChessReplayService();

  it('returns just the starting position for an empty PGN', () => {
    const positions = service.replay('');
    expect(positions).toHaveLength(1);
    expect(positions[0].move).toBeNull();
    expect(positions[0].fen).toContain('rnbqkbnr/pppppppp');
  });

  it('returns one entry per ply plus the starting position', () => {
    const positions = service.replay('1. e4 e5 2. Nf3');
    expect(positions).toHaveLength(4);
    expect(positions[1]).toMatchObject({ move: 'e4', color: 'w' });
    expect(positions[2]).toMatchObject({ move: 'e5', color: 'b' });
    expect(positions[3]).toMatchObject({ move: 'Nf3', color: 'w' });
  });

  it('produces the correct FEN after the first move', () => {
    const positions = service.replay('1. e4');
    expect(positions[1].fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  });
});
