import { ApiProperty } from '@nestjs/swagger';
import { PublicFile } from '../../../entities/public-file.entity';

export class PublicProfileDetails {
  @ApiProperty({ type: String, nullable: true, example: 'John' })
  firstName: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Doe' })
  lastName: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Backend developer' })
  bio: string | null;

  @ApiProperty({ type: () => PublicFile, nullable: true })
  avatar: PublicFile | null;
}

export class PublicProfile {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'johndoe' })
  username: string;

  @ApiProperty({ type: () => PublicProfileDetails })
  profile: PublicProfileDetails;

  @ApiProperty({ example: 10 })
  followersCount: number;

  @ApiProperty({ example: 3 })
  followingCount: number;

  @ApiProperty({
    example: false,
    description: 'Always false for anonymous viewers',
  })
  isFollowedByMe: boolean;
}
