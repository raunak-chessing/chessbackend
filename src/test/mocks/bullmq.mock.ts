import { getQueueToken } from '@nestjs/bullmq';

export const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-id' }),
  pause: jest.fn(),
  resume: jest.fn(),
  getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
};

export const getQueueMockProvider = (queueName: string) => ({
  provide: getQueueToken(queueName),
  useValue: mockQueue,
});
