import { Test, TestingModule } from '@nestjs/testing';
import { LogCleanupService } from './log-cleanup.service';
import { getPrismaMockProvider, prismaMock } from '../../test/mocks/prisma.mock';
import { Logger } from '@nestjs/common';

describe('LogCleanupService', () => {
  let service: LogCleanupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [LogCleanupService, getPrismaMockProvider()],
    }).compile();

    service = module.get<LogCleanupService>(LogCleanupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('handleCron should delete info, warn, and error logs past their own retention window', async () => {
    const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    prismaMock.systemLog.deleteMany
      .mockResolvedValueOnce({ count: 5 })
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    await service.handleCron();

    expect(prismaMock.systemLog.deleteMany).toHaveBeenCalledTimes(3);
    expect(prismaMock.systemLog.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ level: 'info', createdAt: expect.objectContaining({ lt: expect.any(Date) }) }),
      })
    );
    expect(prismaMock.systemLog.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ level: 'warn', createdAt: expect.objectContaining({ lt: expect.any(Date) }) }),
      })
    );
    expect(prismaMock.systemLog.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ level: 'error', createdAt: expect.objectContaining({ lt: expect.any(Date) }) }),
      })
    );

    expect(loggerSpy).toHaveBeenCalledWith('Starting daily log cleanup...');
    expect(loggerSpy).toHaveBeenCalledWith('Cleaned up 5 old info logs.');
    expect(loggerSpy).toHaveBeenCalledWith('Cleaned up 2 old warn logs.');
    expect(loggerSpy).toHaveBeenCalledWith('Cleaned up 1 old error logs.');
  });

  it('uses a longer retention window for warn and error than for info', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    prismaMock.systemLog.deleteMany.mockResolvedValue({ count: 0 });

    await service.handleCron();

    const calls = prismaMock.systemLog.deleteMany.mock.calls as any[];
    const cutoffFor = (level: string) =>
      calls.find((c) => c[0].where.level === level)[0].where.createdAt.lt as Date;

    const infoCutoff = cutoffFor('info');
    const warnCutoff = cutoffFor('warn');
    const errorCutoff = cutoffFor('error');

    // A longer retention window means an OLDER (smaller) cutoff timestamp.
    expect(warnCutoff.getTime()).toBeLessThan(infoCutoff.getTime());
    expect(errorCutoff.getTime()).toBeLessThan(warnCutoff.getTime());
  });

  it('handleCron should catch a failure for one level without skipping the others', async () => {
    const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const error = new Error('DB Error');
    prismaMock.systemLog.deleteMany
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 4 });

    await service.handleCron();

    expect(prismaMock.systemLog.deleteMany).toHaveBeenCalledTimes(3);
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to clean up info logs', error);
  });
});
