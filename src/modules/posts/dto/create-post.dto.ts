import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const TEXT_MAX_LENGTH = 5000;

export class CreatePostDto {
  @ApiPropertyOptional({ maxLength: TEXT_MAX_LENGTH, example: 'Hello, world!' })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX_LENGTH)
  text?: string;
}
