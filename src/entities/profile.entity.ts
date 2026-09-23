import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { PublicFile } from './public-file.entity';

@Entity()
export class Profile {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiHideProperty()
  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @ApiProperty({ type: String, nullable: true, example: 'John' })
  @Column({ type: 'varchar', nullable: true })
  firstName: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Doe' })
  @Column({ type: 'varchar', nullable: true })
  lastName: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Backend developer' })
  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @ApiProperty({ type: () => PublicFile, nullable: true })
  // Deleting the file clears the avatar instead of being blocked by the FK.
  @ManyToOne(() => PublicFile, {
    nullable: true,
    eager: true,
    onDelete: 'SET NULL',
  })
  avatar: PublicFile | null;
}
