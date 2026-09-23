import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Like } from '../../entities/like.entity';
import { Post } from '../../entities/post.entity';
import { User } from '../../entities/user.entity';
import { LikesInfo } from './dto/likes-info.dto';

const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class LikesService {
  constructor(
    @InjectRepository(Like)
    private readonly likeRepository: Repository<Like>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
  ) {}

  async like(currentUser: User, postId: string): Promise<Like> {
    const post = await this.postRepository.findOne({ where: { id: postId } });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const existing = await this.findLike(currentUser.id, postId);

    if (existing) {
      return existing;
    }

    const like = this.likeRepository.create({ user: currentUser, post });

    try {
      return await this.likeRepository.save(like);
    } catch (error) {
      // Two concurrent requests can both pass the existence check above
      // before either INSERT commits. The DB's UNIQUE(user, post)
      // constraint is the real guard here — on a race we just return the
      // row the other request created instead of surfacing a 500.
      if (this.isUniqueViolation(error)) {
        const winner = await this.findLike(currentUser.id, postId);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  async unlike(userId: string, postId: string): Promise<void> {
    const like = await this.findLike(userId, postId);

    if (!like) {
      throw new NotFoundException('Like not found');
    }

    await this.likeRepository.remove(like);
  }

  async getLikesInfo(
    postId: string,
    currentUserId?: string,
  ): Promise<LikesInfo> {
    const post = await this.postRepository.findOne({ where: { id: postId } });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const count = await this.likeRepository.count({
      where: { post: { id: postId } },
    });

    const likedByMe = currentUserId
      ? Boolean(await this.findLike(currentUserId, postId))
      : false;

    return { count, likedByMe };
  }

  private findLike(userId: string, postId: string): Promise<Like | null> {
    return this.likeRepository.findOne({
      where: { user: { id: userId }, post: { id: postId } },
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as unknown as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
    );
  }
}
