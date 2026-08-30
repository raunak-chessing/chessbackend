import { Injectable } from '@nestjs/common';

export enum MoveClassification {
  Book = 'Book',
  Blunder = 'Blunder',
  Mistake = 'Mistake',
  Inaccuracy = 'Inaccuracy',
  Miss = 'Miss',
  BestMove = 'Best Move',
  Great = 'Great',
  Brilliant = 'Brilliant',
  Excellent = 'Excellent',
  Good = 'Good',
}

export interface ClassifiableMove {
  fen: string;
  move: string | null;
  color?: string;
  mate?: number | null;
  centipawns?: number;
  bestMove?: string | null;
}

export interface Classification {
  classification: MoveClassification;
  explanation: string;
}

// Every classification defaults to 100 accuracy unless listed here — this
// table and the classification logic below used to be two independently
// maintained if/else chains kept in sync only by matching string literals.
// One typo in either and they'd silently drift; now it's the compiler.
const ACCURACY_BY_CLASSIFICATION: Partial<Record<MoveClassification, number>> = {
  [MoveClassification.Blunder]: 20,
  [MoveClassification.Mistake]: 50,
  [MoveClassification.Inaccuracy]: 75,
  [MoveClassification.Good]: 85,
  [MoveClassification.Excellent]: 95,
};

@Injectable()
export class MoveClassifierService {
  accuracyFor(classification: MoveClassification): number {
    return ACCURACY_BY_CLASSIFICATION[classification] ?? 100;
  }

  /**
   * Classifies the move that transitions from `prev` to `curr`, given its
   * 1-based ply index. Ported as-is from the original inline logic —
   * thresholds and win-probability formula unchanged.
   */
  classify(prev: ClassifiableMove, curr: ClassifiableMove, index: number): Classification {
    if (index <= 10) {
      // Very rough heuristic: treat the first 10 plies as book theory.
      return { classification: MoveClassification.Book, explanation: '' };
    }

    const sign = curr.color === 'w' ? 1 : -1;
    const prevCp = prev.mate ? (prev.mate > 0 ? 10000 : -10000) : (prev.centipawns ?? 0);
    const currCp = curr.mate ? (curr.mate > 0 ? 10000 : -10000) : (curr.centipawns ?? 0);
    const evalChange = curr.color === 'w' ? currCp - prevCp : prevCp - currCp;

    // Win probability, Caps-like scale.
    const winProb = (cp: number) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
    const prevWinProb = winProb(prevCp * sign);
    const currWinProb = winProb(currCp * sign);
    const probLoss = prevWinProb - currWinProb;

    let result: Classification;

    if (probLoss > 20 || evalChange <= -300) {
      if (prev.mate && !curr.mate) {
        result = { classification: MoveClassification.Blunder, explanation: 'Missed a forced mate.' };
      } else if (!prev.mate && curr.mate && Math.abs(curr.mate) < 0) {
        // Math.abs(...) < 0 can never be true — this branch is unreachable
        // in the original code too. Preserved as-is rather than silently
        // "fixed" mid-refactor; flagging for a follow-up, not changing
        // classification behavior here.
        result = { classification: MoveClassification.Blunder, explanation: 'Allowed a forced mate.' };
      } else if (evalChange <= -300) {
        result = {
          classification: MoveClassification.Blunder,
          explanation: 'A grievous error! You have surrendered massive tactical advantage to the Void.',
        };
      } else {
        result = {
          classification: MoveClassification.Blunder,
          explanation: 'A catastrophic oversight, Commander! The enemy advances uncontested.',
        };
      }
    } else if (probLoss > 10 || evalChange <= -150) {
      result = { classification: MoveClassification.Mistake, explanation: 'A poor judgment. The front lines weaken.' };
    } else if (probLoss > 5 || evalChange <= -50) {
      result = {
        classification: MoveClassification.Inaccuracy,
        explanation: 'Suboptimal deployment. The Seer senses a better path existed.',
      };
    } else if (probLoss < -10 && currCp * sign < 0) {
      result = {
        classification: MoveClassification.Miss,
        explanation: 'You hesitated! A tactical opportunity slipped through your fingers.',
      };
    } else if (curr.move === prev.bestMove) {
      result = { classification: MoveClassification.BestMove, explanation: 'The Seer nods approvingly. The optimal strike.' };
    } else if (evalChange > 0 && currCp * sign > 300) {
      // Already winning big and found a move that increases the eval further.
      result = { classification: MoveClassification.Great, explanation: 'A powerful maneuver! The enemy crumbles before you.' };
    } else if (probLoss <= 0.5) {
      result = { classification: MoveClassification.Excellent, explanation: 'A masterful command decision.' };
    } else {
      result = { classification: MoveClassification.Good, explanation: 'A solid, reliable stance.' };
    }

    if (this.isMaterialSacrifice(prev, curr, evalChange)) {
      result = {
        classification: MoveClassification.Brilliant,
        explanation: 'A brilliant sacrifice! You gave up material for a decisive advantage.',
      };
    }

    return result;
  }

  private isMaterialSacrifice(prev: ClassifiableMove, curr: ClassifiableMove, evalChange: number): boolean {
    const color = curr.color as 'w' | 'b';
    const prevMaterial = this.materialOnBoard(prev.fen, color);
    const currMaterial = this.materialOnBoard(curr.fen, color);
    // Material was sacrificed (lost), but evaluation stayed stable or improved.
    return currMaterial < prevMaterial && evalChange >= -50;
  }

  private materialOnBoard(fen: string, color: 'w' | 'b'): number {
    const pieces = fen.split(' ')[0];
    const valueByChar: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, P: 1, N: 3, B: 3, R: 5, Q: 9 };
    let total = 0;
    for (const c of pieces) {
      if (color === 'w' && c === c.toUpperCase() && valueByChar[c]) total += valueByChar[c];
      if (color === 'b' && c === c.toLowerCase() && valueByChar[c]) total += valueByChar[c];
    }
    return total;
  }
}
