import { Injectable } from '@nestjs/common';

export interface SwissPlayerInput {
  userId: string;
  score: number;
}

export interface SwissPairingHistoryEntry {
  whitePlayerId: string;
  blackPlayerId: string | null;
  isBye: boolean;
}

export interface SwissPairingResult {
  whitePlayerId: string;
  blackPlayerId: string | null;
  isBye: boolean;
}

@Injectable()
export class SwissPairingService {
  generatePairings(
    players: SwissPlayerInput[],
    history: SwissPairingHistoryEntry[],
  ): SwissPairingResult[] {
    const playedPairs = new Set<string>();
    const byeRecipients = new Set<string>();

    for (const entry of history) {
      if (entry.isBye || !entry.blackPlayerId) {
        byeRecipients.add(entry.whitePlayerId);
        continue;
      }
      playedPairs.add(this.pairKey(entry.whitePlayerId, entry.blackPlayerId));
    }

    const standings = [...players].sort((a, b) => b.score - a.score);
    const pairings: SwissPairingResult[] = [];
    const pool = standings.map((p) => p.userId);

    if (pool.length % 2 !== 0) {
      const byeIndex = this.findByeRecipient(pool, byeRecipients);
      const [byePlayerId] = pool.splice(byeIndex, 1);
      pairings.push({ whitePlayerId: byePlayerId, blackPlayerId: null, isBye: true });
    }

    const remaining = [...pool];
    while (remaining.length > 0) {
      const player = remaining.shift()!;
      const opponentIndex = this.findOpponent(player, remaining, playedPairs);
      const [opponent] = remaining.splice(opponentIndex, 1);
      pairings.push({ whitePlayerId: player, blackPlayerId: opponent, isBye: false });
    }

    return pairings;
  }

  private findByeRecipient(pool: string[], byeRecipients: Set<string>): number {
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!byeRecipients.has(pool[i])) return i;
    }
    return pool.length - 1;
  }

  private findOpponent(player: string, candidates: string[], playedPairs: Set<string>): number {
    for (let i = 0; i < candidates.length; i++) {
      if (!playedPairs.has(this.pairKey(player, candidates[i]))) return i;
    }
    return 0;
  }

  private pairKey(a: string, b: string): string {
    return [a, b].sort().join('|');
  }
}
