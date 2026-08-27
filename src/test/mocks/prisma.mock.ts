import { PrismaClient } from '@prisma/client';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaReadService } from '../../prisma/prisma-read.service';

export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaService>;

export const getPrismaMockProvider = () => ({
  provide: PrismaService,
  useValue: prismaMock,
});

export const prismaReadMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaReadService>;

export const getPrismaReadMockProvider = () => ({
  provide: PrismaReadService,
  useValue: prismaReadMock,
});
