import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../../entities/user.entity';

export class SearchUsersResult {
  @ApiProperty({ type: () => [User] })
  items: User[];

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}
