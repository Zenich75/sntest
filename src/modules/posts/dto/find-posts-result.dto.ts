import { ApiProperty } from '@nestjs/swagger';
import { Post } from '../../../entities/post.entity';

export class FindPostsResult {
  @ApiProperty({ type: () => [Post] })
  items: Post[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}
