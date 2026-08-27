import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Tournaments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  
  let adminCookie: string[];
  let playerCookie: string[];
  let adminId: string;
  let playerId: string;

  const adminEmail = `admin@chessing.local`;
  const playerEmail = `player-tourney-${Date.now()}@chess.test`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    
    await prisma.user.deleteMany({ where: { email: adminEmail } });

    // Create Admin
    await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({
      email: adminEmail,
      password: 'Password123',
      name: 'Admin',
    });
    await prisma.user.update({ where: { email: adminEmail }, data: { emailVerified: true } });
    const resAdmin = await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({
      email: adminEmail,
      password: 'Password123',
    });
    adminCookie = resAdmin.headers['set-cookie'];
    adminId = resAdmin.body.user.id;

    // Create Player
    await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({
      email: playerEmail,
      password: 'Password123',
      name: 'Player',
    });
    await prisma.user.update({ where: { email: playerEmail }, data: { emailVerified: true } });
    const resPlayer = await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({
      email: playerEmail,
      password: 'Password123',
    });
    playerCookie = resPlayer.headers['set-cookie'];
    playerId = resPlayer.body.user.id;
  });

  afterAll(async () => {
    await prisma.tournamentPlayer.deleteMany({
      where: { userId: { in: [adminId, playerId] } }
    });
    await prisma.tournament.deleteMany({
      where: { name: 'E2E Arena' }
    });
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, playerEmail] } },
    });
    await app.close();
  });

  describe('Tournaments API', () => {
    let tournamentId: string;

    it('should prevent non-admin from creating an arena', async () => {
      await request(app.getHttpServer())
        .post('/api/tournaments/create-arena')
        .set('Cookie', playerCookie)
        .send({
          name: 'E2E Arena',
          timeControl: '3|0',
          startsInMinutes: 5,
          durationMinutes: 60,
        })
        .expect(401);
    });

    it('should allow admin to create an arena', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tournaments/create-arena')
        .set('Cookie', adminCookie)
        .send({
          name: 'E2E Arena',
          timeControl: '3|0',
          startsInMinutes: 5,
          durationMinutes: 60,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('E2E Arena');
      expect(res.body.type).toBe('ARENA');
      expect(res.body.status).toBe('UPCOMING');
      
      tournamentId = res.body.id;
    });

    it('should list tournaments', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tournaments')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find((t: any) => t.id === tournamentId);
      expect(found).toBeDefined();
      expect(found.name).toBe('E2E Arena');
    });

    it('should get tournament details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tournaments/${tournamentId}`)
        .expect(200);

      expect(res.body.id).toBe(tournamentId);
      expect(res.body.name).toBe('E2E Arena');
      expect(Array.isArray(res.body.players)).toBe(true);
    });

    it('should join tournament', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tournaments/${tournamentId}/join`)
        .set('Cookie', playerCookie)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.userId).toBe(playerId);
      expect(res.body.tournamentId).toBe(tournamentId);
      expect(res.body.score).toBe(0);
    });
  });
});
