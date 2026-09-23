import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Follow } from '../../entities/follow.entity';
import { User } from '../../entities/user.entity';

@Injectable()
export class FollowService {
  constructor(
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async follow(currentUser: User, targetUserId: string): Promise<Follow> {
    if (currentUser.id === targetUserId) {
      throw new BadRequestException('Не можна підписатися на самого себе');
    }

    const targetUser = await this.userRepository.findOne({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const existingFollow = await this.followRepository.findOne({
      where: {
        follower: { id: currentUser.id },
        following: { id: targetUserId },
      },
    });

    if (existingFollow) {
      return existingFollow;
    }

    const follow = this.followRepository.create({
      follower: currentUser,
      following: targetUser,
    });

    return this.followRepository.save(follow);
  }

  async unfollow(currentUserId: string, targetUserId: string): Promise<void> {
    const follow = await this.followRepository.findOne({
      where: {
        follower: { id: currentUserId },
        following: { id: targetUserId },
      },
    });

    if (!follow) {
      throw new NotFoundException('Follow relationship not found');
    }

    await this.followRepository.remove(follow);
  }

  async getFollowers(userId: string): Promise<User[]> {
    const follows = await this.followRepository.find({
      where: { following: { id: userId } },
      relations: { follower: { profile: true } },
    });

    return follows.map((follow) => follow.follower);
  }

  async getFollowing(userId: string): Promise<User[]> {
    const follows = await this.followRepository.find({
      where: { follower: { id: userId } },
      relations: { following: { profile: true } },
    });

    return follows.map((follow) => follow.following);
  }
}
