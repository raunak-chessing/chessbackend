import { IsString, IsNotEmpty, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class FlagUserDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}

export class PauseMatchmakingDto {
  @IsBoolean()
  paused: boolean;
}
