import { ApiProperty } from '@nestjs/swagger';

export class LikesInfo {
  @ApiProperty({ example: 5 })
  count: number;

  @ApiProperty({
    example: false,
    description: 'Always false for anonymous viewers',
  })
  likedByMe: boolean;
}
