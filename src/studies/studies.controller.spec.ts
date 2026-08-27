import { Test, TestingModule } from '@nestjs/testing';
import { StudiesController } from './studies.controller';
import { StudiesService } from './studies.service';
import { AuthenticatedRequest } from '../types';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateStudyDto, AddChapterDto, UpdateChapterDto } from './dto/studies.dto';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => jest.fn(),
}));

const mockStudiesService = {
  getStudies: jest.fn(),
  getMyStudies: jest.fn(),
  getStudy: jest.fn(),
  createStudy: jest.fn(),
  addChapter: jest.fn(),
  updateChapter: jest.fn(),
};

describe('StudiesController', () => {
  let controller: StudiesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StudiesController],
      providers: [{ provide: StudiesService, useValue: mockStudiesService }],
    }).compile();

    controller = module.get<StudiesController>(StudiesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStudies', () => {
    it('should call getStudies on service', async () => {
      mockStudiesService.getStudies.mockResolvedValueOnce([{ id: 's1' }]);
      const res = await controller.getStudies();
      expect(mockStudiesService.getStudies).toHaveBeenCalled();
      expect(res).toEqual([{ id: 's1' }]);
    });
  });

  describe('getMyStudies', () => {
    it('should throw UnauthorizedException if user not present', async () => {
      await expect(controller.getMyStudies('')).rejects.toThrow(UnauthorizedException);
    });

    it('should call getMyStudies on service', async () => {
      mockStudiesService.getMyStudies.mockResolvedValueOnce([{ id: 's1' }]);
      const res = await controller.getMyStudies('u1');
      expect(mockStudiesService.getMyStudies).toHaveBeenCalledWith('u1');
      expect(res).toEqual([{ id: 's1' }]);
    });
  });

  describe('getStudy', () => {
    it('should call getStudy on service', async () => {
      mockStudiesService.getStudy.mockResolvedValueOnce({ id: 's1' });
      const res = await controller.getStudy('s1');
      expect(mockStudiesService.getStudy).toHaveBeenCalledWith('s1');
      expect(res).toEqual({ id: 's1' });
    });
  });

  describe('createStudy', () => {
    it('should throw UnauthorizedException if user not present', async () => {
      await expect(controller.createStudy('', {} as CreateStudyDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should call createStudy on service', async () => {
      mockStudiesService.createStudy.mockResolvedValueOnce({ id: 's1' });
      const dto: CreateStudyDto = { title: 'T', description: 'D', isPublic: true };
      const res = await controller.createStudy('u1', dto);
      expect(mockStudiesService.createStudy).toHaveBeenCalledWith('u1', 'T', 'D', true);
      expect(res).toEqual({ id: 's1' });
    });
  });

  describe('addChapter', () => {
    it('should throw UnauthorizedException if user not present', async () => {
      await expect(controller.addChapter('', 's1', {} as AddChapterDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should call addChapter on service', async () => {
      mockStudiesService.addChapter.mockResolvedValueOnce({ id: 'c1' });
      const dto: AddChapterDto = { title: 'C' };
      const res = await controller.addChapter('u1', 's1', dto);
      expect(mockStudiesService.addChapter).toHaveBeenCalledWith('u1', 's1', 'C');
      expect(res).toEqual({ id: 'c1' });
    });
  });

  describe('updateChapter', () => {
    it('should throw UnauthorizedException if user not present', async () => {
      await expect(controller.updateChapter('', 'c1', {} as UpdateChapterDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should call updateChapter on service', async () => {
      mockStudiesService.updateChapter.mockResolvedValueOnce({ id: 'c1' });
      const dto: UpdateChapterDto = { fen: 'f', pgn: 'p', orientation: 'white', title: 'C2' };
      const res = await controller.updateChapter('u1', 'c1', dto);
      expect(mockStudiesService.updateChapter).toHaveBeenCalledWith('u1', 'c1', dto);
      expect(res).toEqual({ id: 'c1' });
    });
  });
});
