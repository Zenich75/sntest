import { ApiProperty } from '@nestjs/swagger';
import { Comment } from '../../../entities/comment.entity';

export class FindCommentsResult {
  @ApiProperty({ type: () => [Comment] })
  items: Comment[];

  @ApiProperty({ example: 3 })
  total: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}
