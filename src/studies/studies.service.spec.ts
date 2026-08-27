import { Test, TestingModule } from '@nestjs/testing';
import { StudiesService } from './studies.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';

describe('StudiesService', () => {
  let service: StudiesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [StudiesService, getPrismaMockProvider()],
    }).compile();

    service = module.get<StudiesService>(StudiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStudies', () => {
    it('should return public studies', async () => {
      prismaMock.study.findMany.mockResolvedValueOnce([{ id: 's1' }] as any);
      const res = await service.getStudies();
      expect(prismaMock.study.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isPublic: true } })
      );
      expect(res).toEqual([{ id: 's1' }]);
    });
  });

  describe('getMyStudies', () => {
    it('should return user studies', async () => {
      prismaMock.study.findMany.mockResolvedValueOnce([{ id: 's1' }] as any);
      const res = await service.getMyStudies('u1');
      expect(prismaMock.study.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'u1' } })
      );
      expect(res).toEqual([{ id: 's1' }]);
    });
  });

  describe('getStudy', () => {
    it('should throw NotFoundException if study not found', async () => {
      prismaMock.study.findUnique.mockResolvedValueOnce(null);
      await expect(service.getStudy('s1')).rejects.toThrow(NotFoundException);
    });

    it('should return study if found', async () => {
      prismaMock.study.findUnique.mockResolvedValueOnce({ id: 's1' } as any);
      const res = await service.getStudy('s1');
      expect(prismaMock.study.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1' } })
      );
      expect(res).toEqual({ id: 's1' });
    });
  });

  describe('createStudy', () => {
    it('should create a study with default chapter 1', async () => {
      prismaMock.study.create.mockResolvedValueOnce({ id: 's1' } as any);
      const res = await service.createStudy('u1', 'Title', 'Desc', false);
      expect(prismaMock.study.create).toHaveBeenCalledWith({
        data: {
          title: 'Title',
          description: 'Desc',
          isPublic: false,
          ownerId: 'u1',
          chapters: { create: [{ title: 'Chapter 1' }] }
        }
      });
      expect(res).toEqual({ id: 's1' });
    });

    it('should create a study with public default true', async () => {
      prismaMock.study.create.mockResolvedValueOnce({ id: 's1' } as any);
      const res = await service.createStudy('u1', 'Title', 'Desc');
      expect(prismaMock.study.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isPublic: true })
      });
    });
  });

  describe('addChapter', () => {
    it('should throw NotFoundException if study not found', async () => {
      prismaMock.study.findUnique.mockResolvedValueOnce(null);
      await expect(service.addChapter('u1', 's1', 'Chap 2')).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException if user is not owner', async () => {
      prismaMock.study.findUnique.mockResolvedValueOnce({ id: 's1', ownerId: 'u2', chapters: [] } as any);
      await expect(service.addChapter('u1', 's1', 'Chap 2')).rejects.toThrow(UnauthorizedException);
    });

    it('should create a chapter with correct sort order', async () => {
      prismaMock.study.findUnique.mockResolvedValueOnce({
        id: 's1', ownerId: 'u1', chapters: [{}, {}]
      } as any);
      prismaMock.studyChapter.create.mockResolvedValueOnce({ id: 'c3' } as any);
      
      const res = await service.addChapter('u1', 's1', 'Chap 3');
      expect(prismaMock.studyChapter.create).toHaveBeenCalledWith({
        data: { studyId: 's1', title: 'Chap 3', sortOrder: 2 }
      });
      expect(res).toEqual({ id: 'c3' });
    });
  });

  describe('updateChapter', () => {
    it('should throw NotFoundException if chapter not found', async () => {
      prismaMock.studyChapter.findUnique.mockResolvedValueOnce(null);
      await expect(service.updateChapter('u1', 'c1', {})).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException if user is not study owner', async () => {
      prismaMock.studyChapter.findUnique.mockResolvedValueOnce({
        id: 'c1', study: { ownerId: 'u2' }
      } as any);
      await expect(service.updateChapter('u1', 'c1', {})).rejects.toThrow(UnauthorizedException);
    });

    it('should update the chapter if valid', async () => {
      prismaMock.studyChapter.findUnique.mockResolvedValueOnce({
        id: 'c1', study: { ownerId: 'u1' }
      } as any);
      prismaMock.studyChapter.update.mockResolvedValueOnce({ id: 'c1', title: 'New' } as any);

      const res = await service.updateChapter('u1', 'c1', { title: 'New' });
      expect(prismaMock.studyChapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { title: 'New' }
      });
      expect(res).toEqual({ id: 'c1', title: 'New' });
    });
  });
});
