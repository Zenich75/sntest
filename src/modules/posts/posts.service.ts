import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, Repository } from 'typeorm';
import { Post } from '../../entities/post.entity';
import { User } from '../../entities/user.entity';
import { FilesService } from '../files/files.service';
import { CreatePostDto } from './dto/create-post.dto';
import { FindPostsResult } from './dto/find-posts-result.dto';

// TODO: at large comment counts, drop `comments` from this relation and
// have clients pair GET /posts/:id with the paginated
// GET /posts/:id/comments instead — loading every comment via relations
// is fine for MVP but doesn't scale.
const POST_DETAIL_RELATIONS: FindOptionsRelations<Post> = {
  author: { profile: true },
  files: true,
  comments: { author: true },
  likes: true,
};

const FEED_RELATIONS: FindOptionsRelations<Post> = {
  author: { profile: true },
  files: true,
  likes: true,
  comments: true,
};

const USER_POSTS_RELATIONS: FindOptionsRelations<Post> = {
  files: true,
  likes: true,
  comments: true,
};

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    private readonly filesService: FilesService,
  ) {}

  async create(
    author: User,
    dto: CreatePostDto,
    files: Express.Multer.File[] | undefined,
  ): Promise<Post> {
    const uploadedFiles = await this.filesService.uploadManyPublicFiles(files);

    const post = this.postRepository.create({
      author,
      text: dto.text ?? null,
      files: uploadedFiles,
    });

    return this.postRepository.save(post);
  }

  async findOne(id: string): Promise<Post> {
    const post = await this.postRepository.findOne({
      where: { id },
      relations: POST_DETAIL_RELATIONS,
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  async findByUser(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<FindPostsResult> {
    const [items, total] = await this.postRepository.findAndCount({
      where: { author: { id: userId } },
      relations: USER_POSTS_RELATIONS,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total, limit, offset };
  }

  findFeed(limit: number, offset: number): Promise<Post[]> {
    return this.postRepository.find({
      relations: FEED_RELATIONS,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async remove(postId: string, userId: string): Promise<void> {
    const post = await this.postRepository.findOne({
      where: { id: postId },
      relations: { author: true, files: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.author.id !== userId) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    await Promise.all(
      post.files.map((file) => this.filesService.deletePublicFile(file.id)),
    );

    // comments/likes/any remaining public_file rows are cleaned up by the
    // DB's ON DELETE CASCADE foreign keys.
    await this.postRepository.remove(post);
  }
}
