import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OWN_ACCOUNT_GROUP } from '../common/serialization/groups';
import { Profile } from './profile.entity';
import { Post } from './post.entity';
import { Comment } from './comment.entity';
import { Like } from './like.entity';
import { Follow } from './follow.entity';

@Entity()
export class User {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'johndoe' })
  @Column({ unique: true })
  username: string;

  @ApiPropertyOptional({
    example: 'john@example.com',
    description:
      "Only in the user's own account response (POST /auth/register)",
  })
  @Column({ unique: true })
  @Expose({ groups: [OWN_ACCOUNT_GROUP] })
  email: string;

  @ApiHideProperty()
  @Column()
  @Exclude()
  password: string;

  @ApiPropertyOptional({
    example: false,
    description:
      "Only in the user's own account response (POST /auth/register)",
  })
  @Column({ default: false })
  @Expose({ groups: [OWN_ACCOUNT_GROUP] })
  isEmailConfirmed: boolean;

  @ApiHideProperty()
  @Column({ type: 'varchar', nullable: true })
  @Exclude()
  emailConfirmationToken: string | null;

  @ApiPropertyOptional({ type: () => Profile })
  @OneToOne(() => Profile, (profile) => profile.user, { cascade: true })
  profile: Profile;

  @ApiHideProperty()
  @OneToMany(() => Post, (post) => post.author)
  posts: Post[];

  @ApiHideProperty()
  @OneToMany(() => Comment, (comment) => comment.author)
  comments: Comment[];

  @ApiHideProperty()
  @OneToMany(() => Like, (like) => like.user)
  likes: Like[];

  @ApiHideProperty()
  @OneToMany(() => Follow, (follow) => follow.follower)
  following: Follow[];

  @ApiHideProperty()
  @OneToMany(() => Follow, (follow) => follow.following)
  followers: Follow[];

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn()
  updatedAt: Date;
}
