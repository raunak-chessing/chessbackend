import { PrismaService } from './prisma.service';
import pg from 'pg';

jest.mock('pg', () => {
  const mPool = {
    end: jest.fn().mockResolvedValue(undefined),
  };
  return {
    Pool: jest.fn(() => mPool),
  };
});

jest.mock('@prisma/adapter-pg', () => {
  return {
    PrismaPg: jest.fn(),
  };
});

jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn().mockResolvedValue(undefined);
    $disconnect = jest.fn().mockResolvedValue(undefined);
  }
  return {
    PrismaClient: MockPrismaClient,
  };
});

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PrismaService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('onModuleInit should call $connect', async () => {
    await service.onModuleInit();
    expect(service.$connect).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy should call $disconnect and pool.end', async () => {
    await service.onModuleDestroy();
    expect(service.$disconnect).toHaveBeenCalledTimes(1);
    // Since service['pool'] is private, we can access the mocked pool's end method directly 
    // by creating a new Pool instance since it returns the same mock object properties in our basic mock
    const pool = new pg.Pool();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
