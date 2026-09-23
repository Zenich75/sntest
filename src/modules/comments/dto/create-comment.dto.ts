import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const TEXT_MAX_LENGTH = 2000;

export class CreateCommentDto {
  @ApiProperty({ maxLength: TEXT_MAX_LENGTH, example: 'Nice post!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(TEXT_MAX_LENGTH)
  text: string;
}
