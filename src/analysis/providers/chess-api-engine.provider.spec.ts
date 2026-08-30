import { ChessApiEngineProvider } from './chess-api-engine.provider';

describe('ChessApiEngineProvider', () => {
  let provider: ChessApiEngineProvider;

  beforeEach(() => {
    provider = new ChessApiEngineProvider();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps a successful response to an EngineEvaluation', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: jest.fn().mockResolvedValue({ eval: 0.5, mate: null, move: 'e4', centipawns: 50 }),
    });

    const result = await provider.evaluate('fen-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://chess-api.com/v1',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({ eval: 0.5, mate: null, bestMove: 'e4', centipawns: 50, depth: 15 });
  });

  it('parses a string centipawns value', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: jest.fn().mockResolvedValue({ eval: 0.3, mate: null, move: 'e5', centipawns: '30' }),
    });

    const result = await provider.evaluate('fen-1');
    expect(result.centipawns).toBe(30);
  });

  it('propagates a network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    await expect(provider.evaluate('fen-1')).rejects.toThrow('network down');
  });
});
