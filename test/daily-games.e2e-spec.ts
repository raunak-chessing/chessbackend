import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Daily Games (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  
  let player1Cookie: string[];
  let player2Cookie: string[];
  let p1Id: string;
  let p2Id: string;

  const p1Email = `p1-daily-${Date.now()}@chess.test`;
  const p2Email = `p2-daily-${Date.now()}@chess.test`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Create Player 1
    await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({
      email: p1Email,
      password: 'Password123',
      name: 'P1 Daily',
    });
    await prisma.user.update({ where: { email: p1Email }, data: { emailVerified: true } });
    const res1 = await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({
      email: p1Email,
      password: 'Password123',
    });
    player1Cookie = res1.headers['set-cookie'];
    p1Id = res1.body.user.id;

    // Create Player 2
    await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({
      email: p2Email,
      password: 'Password123',
      name: 'P2 Daily',
    });
    await prisma.user.update({ where: { email: p2Email }, data: { emailVerified: true } });
    const res2 = await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({
      email: p2Email,
      password: 'Password123',
    });
    player2Cookie = res2.headers['set-cookie'];
    p2Id = res2.body.user.id;
  });

  afterAll(async () => {
    await prisma.game.deleteMany({
      where: {
        OR: [
          { whitePlayerId: p1Id },
          { blackPlayerId: p1Id },
          { whitePlayerId: p2Id },
          { blackPlayerId: p2Id },
        ]
      }
    });
    await prisma.user.deleteMany({
      where: { email: { in: [p1Email, p2Email] } },
    });
    await app.close();
  });

  describe('Daily Games API', () => {
    let gameId: string;

    it('should create a new daily game (POST /api/games/daily)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/games/daily')
        .set('Cookie', player1Cookie)
        .send({
          opponentId: p2Id,
          daysPerMove: 3
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.whitePlayerId).toBeDefined(); // Assigned randomly by default in service
      expect(res.body.blackPlayerId).toBeDefined();
      expect(res.body.timeControlCategory).toBe('DAILY');
      expect(res.body.daysPerMove).toBe(3);
      
      gameId = res.body.id;
    });

    it('should paginate active daily games (GET /api/games/daily/my-games)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/games/daily/my-games')
        .set('Cookie', player1Cookie)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find((g: any) => g.id === gameId);
      expect(found).toBeDefined();
      expect(found.id).toBe(gameId);
    });

    it('should submit a valid move (POST /api/games/daily/:id/move)', async () => {
      // First, find out who is White
      const resGame = await request(app.getHttpServer())
        .get(`/api/games/daily/${gameId}`)
        .set('Cookie', player1Cookie)
        .expect(200);
      
      const isP1White = resGame.body.whitePlayerId === p1Id;
      const whiteCookie = isP1White ? player1Cookie : player2Cookie;
      const blackCookie = isP1White ? player2Cookie : player1Cookie;

      // White plays e2e4
      const res = await request(app.getHttpServer())
        .post(`/api/games/daily/${gameId}/move`)
        .set('Cookie', whiteCookie)
        .send({ from: 'e2', to: 'e4' })
        .expect(201);

      expect(res.body.id).toBe(gameId);
      expect(res.body.fen).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');

      // Now it's Black's turn, if White tries to move again, should reject
      await request(app.getHttpServer())
        .post(`/api/games/daily/${gameId}/move`)
        .set('Cookie', whiteCookie)
        .send({ from: 'g1', to: 'f3' })
        .expect(400); // Bad Request

      // Black plays illegal move
      await request(app.getHttpServer())
        .post(`/api/games/daily/${gameId}/move`)
        .set('Cookie', blackCookie)
        .send({ from: 'e8', to: 'e5' }) // Illegal king jump
        .expect(400);
    });
  });
});
