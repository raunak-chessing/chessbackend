import { Injectable } from '@nestjs/common';

export interface Lesson {
  id: string;
  title: string;
  description: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
  fen: string;
}

@Injectable()
export class AcademyService {
  private lessons: Lesson[] = [
    {
      id: 'basics',
      title: 'Chess Basics',
      description: 'Learn how the pieces move and the rules of the game.',
      difficulty: 'Beginner',
      chapters: [
        {
          id: 'board',
          title: 'The Chess Board',
          content: 'The chess board consists of 64 squares, alternating between light and dark.',
          fen: '8/8/8/8/8/8/8/8 w - - 0 1'
        },
        {
          id: 'pawn',
          title: 'The Pawn',
          content: 'Pawns move forward one square, but capture diagonally. On their first move, they can move two squares.',
          fen: '8/8/8/8/8/8/PPPPPPPP/8 w - - 0 1'
        }
      ]
    },
    {
      id: 'opening',
      title: 'Opening Principles',
      description: 'Control the center, develop your pieces, and get your king to safety.',
      difficulty: 'Intermediate',
      chapters: [
        {
          id: 'center',
          title: 'Control the Center',
          content: 'The center squares (e4, d4, e5, d5) are the most important part of the board.',
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
        }
      ]
    }
  ];

  getLessons(): Lesson[] {
    return this.lessons;
  }

  getLesson(id: string): Lesson | undefined {
    return this.lessons.find((l) => l.id === id);
  }
}
