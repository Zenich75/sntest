import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Follow } from '../../entities/follow.entity';
import { User } from '../../entities/user.entity';
import { FindPostsResult } from '../posts/dto/find-posts-result.dto';
import { PostsService } from '../posts/posts.service';

export interface FollowCounts {
  followersCount: number;
  followingCount: number;
}

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    private readonly postsService: PostsService,
  ) {}

  async getProfile(
    where: Pick<FindOptionsWhere<User>, 'id' | 'username'>,
  ): Promise<User> {
    const user = await this.userRepository.findOne({
      where,
      relations: { profile: { avatar: true } },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getUserPosts(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<FindPostsResult> {
    const exists = await this.userRepository.exists({ where: { id: userId } });

    if (!exists) {
      throw new NotFoundException('User not found');
    }

    return this.postsService.findByUser(userId, limit, offset);
  }

  async getFollowCounts(userId: string): Promise<FollowCounts> {
    const [followersCount, followingCount] = await Promise.all([
      this.followRepository.count({ where: { following: { id: userId } } }),
      this.followRepository.count({ where: { follower: { id: userId } } }),
    ]);

    return { followersCount, followingCount };
  }

  async isFollowedByCurrentUser(
    userId: string,
    currentUserId?: string,
  ): Promise<boolean> {
    if (!currentUserId) {
      return false;
    }

    const follow = await this.followRepository.findOne({
      where: {
        follower: { id: currentUserId },
        following: { id: userId },
      },
    });

    return Boolean(follow);
  }
}
