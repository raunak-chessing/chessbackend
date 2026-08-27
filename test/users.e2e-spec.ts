import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('UsersService (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const seedEmail = `e2e-users-${Date.now()}@chess-users.test`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({
      email: seedEmail,
      password: 'TestPass123',
      name: 'E2E Seed User',
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { contains: '@chess-users.test' } },
    });
    await app.close();
  });

  describe('UsersService.findByEmail via DB', () => {
    it('should find the seeded user by email in Prisma directly', async () => {
      const user = await prisma.user.findUnique({
        where: { email: seedEmail },
      });

      expect(user).not.toBeNull();
      expect(user?.email).toBe(seedEmail);
      expect(user?.name).toBe('E2E Seed User');
    });

    it('should return null for an email that does not exist', async () => {
      const user = await prisma.user.findUnique({
        where: { email: 'nobody-at-all@chess-users.test' },
      });

      expect(user).toBeNull();
    });

    it('should persist the correct initial rating of 100', async () => {
      const user = await prisma.user.findUnique({
        where: { email: seedEmail },
      });

      expect(user?.rating).toBe(100);
    });
  });
});
