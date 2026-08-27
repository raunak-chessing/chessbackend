import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from '../types';
import { AcademyService } from './academy.service';

@Controller('academy')
export class AcademyController {
  constructor(
    private prisma: PrismaService,
    private academyService: AcademyService,
  ) {}

  @Get('lessons')
  getLessons() {
    return this.academyService.getLessons();
  }

  @Get('lessons/:id')
  getLesson(@Param('id') id: string) {
    const lesson = this.academyService.getLesson(id);
    if (!lesson) {
      throw new UnauthorizedException('Lesson not found');
    }
    return lesson;
  }

  @Get('progress')
  async getProgress(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id || (req.session?.userId as string);
    if (!userId) {
      return [];
    }

    const progress = await this.prisma.lessonProgress.findMany({
      where: { userId },
      select: { lessonId: true },
    });

    return progress.map((p) => p.lessonId);
  }

  @Post('complete/:lessonId')
  async completeLesson(
    @Param('lessonId') lessonId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id || (req.session?.userId as string);
    if (!userId) {
      throw new UnauthorizedException(
        'You must be logged in to track progress.',
      );
    }

    const record = await this.prisma.lessonProgress.upsert({
      where: {
        userId_lessonId: { userId, lessonId },
      },
      update: {},
      create: { userId, lessonId },
    });

    return { success: true, record };
  }
}
