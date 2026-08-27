import { SwissPairingService } from './swiss-pairing.service';

describe('SwissPairingService', () => {
  let service: SwissPairingService;

  beforeEach(() => {
    service = new SwissPairingService();
  });

  it('pairs an even field with no history', () => {
    const players = [
      { userId: 'a', score: 3 },
      { userId: 'b', score: 3 },
      { userId: 'c', score: 1 },
      { userId: 'd', score: 0 },
    ];
    const pairings = service.generatePairings(players, []);

    expect(pairings).toHaveLength(2);
    expect(pairings.every((p) => !p.isBye && p.blackPlayerId !== null)).toBe(true);

    const pairedIds = pairings.flatMap((p) => [p.whitePlayerId, p.blackPlayerId]);
    expect(pairedIds.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('assigns a bye to the lowest-scoring player on an odd field', () => {
    const players = [
      { userId: 'a', score: 5 },
      { userId: 'b', score: 3 },
      { userId: 'c', score: 1 },
    ];
    const pairings = service.generatePairings(players, []);

    const bye = pairings.find((p) => p.isBye);
    expect(bye).toBeDefined();
    expect(bye!.whitePlayerId).toBe('c');
    expect(bye!.blackPlayerId).toBeNull();

    const remaining = pairings.filter((p) => !p.isBye);
    expect(remaining).toHaveLength(1);
    expect([remaining[0].whitePlayerId, remaining[0].blackPlayerId].sort()).toEqual(['a', 'b']);
  });

  it('does not give a second bye to a player who already had one when an alternative exists', () => {
    const players = [
      { userId: 'a', score: 5 },
      { userId: 'b', score: 3 },
      { userId: 'c', score: 1 },
    ];
    const history = [{ whitePlayerId: 'c', blackPlayerId: null, isBye: true }];
    const pairings = service.generatePairings(players, history);

    const bye = pairings.find((p) => p.isBye);
    expect(bye).toBeDefined();
    expect(bye!.whitePlayerId).not.toBe('c');
  });

  it('avoids a rematch when a non-rematch pairing is available', () => {
    const players = [
      { userId: 'a', score: 2 },
      { userId: 'b', score: 2 },
      { userId: 'c', score: 0 },
      { userId: 'd', score: 0 },
    ];
    const history = [{ whitePlayerId: 'a', blackPlayerId: 'b', isBye: false }];
    const pairings = service.generatePairings(players, history);

    const hasRematch = pairings.some(
      (p) =>
        !p.isBye &&
        ((p.whitePlayerId === 'a' && p.blackPlayerId === 'b') ||
          (p.whitePlayerId === 'b' && p.blackPlayerId === 'a')),
    );
    expect(hasRematch).toBe(false);
  });

  it('falls back to a rematch rather than leaving a player unpaired', () => {
    const players = [
      { userId: 'a', score: 2 },
      { userId: 'b', score: 0 },
    ];
    const history = [{ whitePlayerId: 'a', blackPlayerId: 'b', isBye: false }];
    const pairings = service.generatePairings(players, history);

    expect(pairings).toHaveLength(1);
    expect(pairings[0].isBye).toBe(false);
    expect([pairings[0].whitePlayerId, pairings[0].blackPlayerId].sort()).toEqual(['a', 'b']);
  });
});
