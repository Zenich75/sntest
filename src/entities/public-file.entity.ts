import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Post } from './post.entity';

@Entity()
export class PublicFile {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: '0b5e1c7a-8f1d-4c1e-9a55-1d2f3e4a5b6c-photo.jpg' })
  @Column()
  key: string;

  @ApiProperty({
    example: 'https://d111111abcdef8.cloudfront.net/0b5e1c7a-...-photo.jpg',
  })
  @Column()
  url: string;

  @ApiProperty({ example: 'image/jpeg' })
  @Column()
  mimeType: string;

  @ApiProperty({ example: 204800, description: 'Size in bytes' })
  @Column('int')
  size: number;

  @ApiHideProperty()
  @ManyToOne(() => Post, (post) => post.files, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  post: Post | null;
}
