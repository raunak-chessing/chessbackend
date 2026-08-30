import { MoveClassifierService, MoveClassification, ClassifiableMove } from './move-classifier.service';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function move(overrides: Partial<ClassifiableMove> = {}): ClassifiableMove {
  return { fen: START_FEN, move: 'e4', color: 'w', centipawns: 0, mate: null, bestMove: null, ...overrides };
}

describe('MoveClassifierService', () => {
  const service = new MoveClassifierService();

  // This logic previously had ZERO real coverage: the pre-existing
  // AnalysisService spec only ever exercised PGNs short enough that every
  // move fell into the "index <= 10 => Book" early return.

  it('treats the first 10 plies as Book regardless of eval swing', () => {
    const result = service.classify(move({ centipawns: 500 }), move({ centipawns: -900 }), 10);
    expect(result.classification).toBe(MoveClassification.Book);
  });

  it('classifies a large eval swing as a Blunder', () => {
    const result = service.classify(move({ centipawns: 100 }), move({ centipawns: -300 }), 11);
    expect(result.classification).toBe(MoveClassification.Blunder);
    expect(result.explanation).toContain('grievous error');
  });

  it('classifies a mate-to-no-mate transition as "Missed a forced mate"', () => {
    const prev = move({ mate: 3 });
    const curr = move({ mate: null, centipawns: 0 });
    const result = service.classify(prev, curr, 11);
    expect(result.classification).toBe(MoveClassification.Blunder);
    expect(result.explanation).toBe('Missed a forced mate.');
  });

  it('recognizes the engine\'s recommended move as Best Move', () => {
    const prev = move({ centipawns: 20, bestMove: 'Nf3' });
    const curr = move({ centipawns: 20, move: 'Nf3' });
    const result = service.classify(prev, curr, 11);
    expect(result.classification).toBe(MoveClassification.BestMove);
  });

  it('classifies a move that holds the position steady as Excellent', () => {
    const prev = move({ centipawns: 10, bestMove: 'Nf3' });
    const curr = move({ centipawns: 10, move: 'Bc4' });
    const result = service.classify(prev, curr, 11);
    expect(result.classification).toBe(MoveClassification.Excellent);
  });

  it('overrides to Brilliant when material is sacrificed without losing the evaluation', () => {
    // White queen disappears between prev and curr, eval barely moves.
    const prevFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1'; // has no queen already for a clean diff
    const withQueenFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; // has the queen
    const prev = move({ fen: withQueenFen, centipawns: 10, bestMove: 'Nf3' });
    const curr = move({ fen: prevFen, centipawns: 5, move: 'Qxh8' });

    const result = service.classify(prev, curr, 11);
    expect(result.classification).toBe(MoveClassification.Brilliant);
  });

  describe('accuracyFor', () => {
    it.each([
      [MoveClassification.Blunder, 20],
      [MoveClassification.Mistake, 50],
      [MoveClassification.Inaccuracy, 75],
      [MoveClassification.Good, 85],
      [MoveClassification.Excellent, 95],
      [MoveClassification.BestMove, 100],
      [MoveClassification.Great, 100],
      [MoveClassification.Brilliant, 100],
      [MoveClassification.Book, 100],
      [MoveClassification.Miss, 100],
    ])('%s maps to %i', (classification, expected) => {
      expect(service.accuracyFor(classification)).toBe(expected);
    });
  });
});
