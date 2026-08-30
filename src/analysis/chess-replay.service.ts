import { Injectable } from '@nestjs/common';
import { Chess } from 'chess.js';

export interface ReplayedPosition {
  fen: string;
  move: string | null;
  color?: 'w' | 'b';
}

/** Reconstructs the FEN at every ply of a game from its PGN. Pure — no I/O. */
@Injectable()
export class ChessReplayService {
  replay(pgn: string): ReplayedPosition[] {
    const chess = new Chess();
    if (pgn) {
      chess.loadPgn(pgn);
    }

    const history = chess.history({ verbose: true });

    // We must rebuild the game move by move to get each FEN.
    const tempChess = new Chess();
    const positions: ReplayedPosition[] = [{ fen: tempChess.fen(), move: null }];

    for (const move of history) {
      tempChess.move(move);
      positions.push({
        fen: tempChess.fen(),
        move: move.san,
        color: move.color,
      });
    }

    return positions;
  }
}
