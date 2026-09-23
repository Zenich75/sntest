import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { PublicFile } from './public-file.entity';
import { Comment } from './comment.entity';
import { Like } from './like.entity';

@Entity()
export class Post {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiPropertyOptional({
    type: () => User,
    description: 'Omitted in GET /users/:id/posts and GET /posts/user/:userId',
  })
  @ManyToOne(() => User, (user) => user.posts, { onDelete: 'CASCADE' })
  author: User;

  @ApiProperty({ type: String, nullable: true, example: 'Hello, world!' })
  @Column({ type: 'text', nullable: true })
  text: string | null;

  @ApiProperty({ type: () => [PublicFile] })
  @OneToMany(() => PublicFile, (file) => file.post, {
    cascade: true,
    eager: true,
  })
  files: PublicFile[];

  @ApiPropertyOptional({ type: () => [Comment] })
  @OneToMany(() => Comment, (comment) => comment.post)
  comments: Comment[];

  @ApiPropertyOptional({ type: () => [Like] })
  @OneToMany(() => Like, (like) => like.post)
  likes: Like[];

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn()
  updatedAt: Date;
}
