import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Follow } from '../../entities/follow.entity';
import { User } from '../../entities/user.entity';
import { PostsModule } from '../posts/posts.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Follow]), PostsModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
