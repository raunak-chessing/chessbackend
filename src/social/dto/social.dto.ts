import { IsString, IsNotEmpty, IsEnum, IsOptional, Matches, MaxLength } from 'class-validator';

export class SendChallengeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,3}\|\d{0,2}$/, { message: 'timeControl must be formatted as "minutes|increment", e.g. "10|0"' })
  timeControl!: string;

  @IsEnum(['random', 'w', 'b'])
  @IsOptional()
  colorPref?: 'random' | 'w' | 'b';
}

export const REPORT_REASONS = ['CHEATING', 'HARASSMENT', 'SPAM', 'OFFENSIVE_NAME', 'OTHER'] as const;

export class ReportUserDto {
  @IsEnum(REPORT_REASONS)
  reason!: (typeof REPORT_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
