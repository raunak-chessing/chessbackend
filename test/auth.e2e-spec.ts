import { Test, TestingModule } from '@nestjs/testing';

import { INestApplication, ValidationPipe } from '@nestjs/common';

import request from 'supertest';

import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';

import { PrismaService } from './../src/prisma/prisma.service';

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;

  let prisma: PrismaService;

  const testUser = {
    email: `e2e-auth-${Date.now()}@chess-auth.test`,

    password: 'SecurePass123',

    name: 'E2E Test User',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });

    app.useGlobalPipes(new ValidationPipe());

    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { contains: '@chess-auth.test' } },
    });

    await app.close();
  });

  describe('POST /api/auth/sign-up/email', () => {
    it('should create a new user and return 200', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')

        .send(testUser)

        .expect(200);

      expect(res.body).toHaveProperty('user');
      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      expect(res.body.user.email).toBe(testUser.email);

      // Verify the user email in database so they can sign in in subsequent tests

      await prisma.user.update({
        where: { email: testUser.email },

        data: { emailVerified: true },
      });
    });

    it('should return 200 when email is already registered', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')

        .send(testUser)

        .expect(200);
    });
  });

  describe('POST /api/auth/sign-in/email', () => {
    it('should sign in with correct credentials and return a session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')

        .send({ email: testUser.email, password: testUser.password })

        .expect(200);

      expect(res.body).toHaveProperty('user');
      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      expect(res.body.user.email).toBe(testUser.email);
    });

    it('should return 401 with incorrect password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')

        .send({ email: testUser.email, password: 'wrong-password' })

        .expect(401);
    });

    it('should return 401 for a non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')

        .send({ email: 'nobody@chess-auth.test', password: 'anything' })

        .expect(401);
    });
  });

  describe('GET /api/auth/get-session', () => {
    it('should return null session for unauthenticated request', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/get-session')

        .expect(200);

      expect(res.body).toBeNull();
    });

    it('should return a valid session after sign-in', async () => {
      const signInRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')

        .send({ email: testUser.email, password: testUser.password });

      const cookie = signInRes.headers['set-cookie'];

      const sessionRes = await request(app.getHttpServer())
        .get('/api/auth/get-session')

        .set('Cookie', cookie)

        .expect(200);

      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      expect(sessionRes.body.user).not.toBeNull();
      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      expect(sessionRes.body.user.email).toBe(testUser.email);
    });
  });
});
