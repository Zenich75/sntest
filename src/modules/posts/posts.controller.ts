import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post as HttpPost,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { FilesUploadInterceptor } from '../../common/interceptors/files-upload.interceptor';
import { FileSizeValidationPipe } from '../../common/pipes/file-size-validation.pipe';
import { ApiCsrfProtected } from '../../common/swagger/api-csrf-protected.decorator';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { Post as PostEntity } from '../../entities/post.entity';
import { User } from '../../entities/user.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { FindPostsResult } from './dto/find-posts-result.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { PostsService } from './posts.service';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @HttpPost()
  @UseGuards(SessionAuthGuard)
  @UseInterceptors(FilesUploadInterceptor)
  @ApiCsrfProtected()
  @ApiOperation({
    summary: 'Create a post',
    description:
      'Text and/or up to 10 attached images/videos. Also accepts plain JSON `{ text }`.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', maxLength: 5000, example: 'Hello, world!' },
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Up to 10 images (≤2 MB) or videos (≤16 MB)',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: PostEntity })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
  )
  create(
    @CurrentUser() user: User,
    @Body() dto: CreatePostDto,
    @UploadedFiles(FileSizeValidationPipe) files: Express.Multer.File[],
  ): Promise<PostEntity> {
    return this.postsService.create(user, dto, files);
  }

  @Get()
  @ApiOperation({ summary: 'Global feed, newest first' })
  @ApiOkResponse({ type: [PostEntity] })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST)
  findFeed(
    @Query() { limit, offset }: PaginationQueryDto,
  ): Promise<PostEntity[]> {
    return this.postsService.findFeed(limit, offset);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: "List a user's posts, newest first" })
  @ApiOkResponse({ type: FindPostsResult })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST)
  findByUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() { limit, offset }: PaginationQueryDto,
  ): Promise<FindPostsResult> {
    return this.postsService.findByUser(userId, limit, offset);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single post with author, files, comments and likes',
  })
  @ApiOkResponse({ type: PostEntity })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PostEntity> {
    return this.postsService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  @ApiCsrfProtected()
  @ApiOperation({ summary: 'Delete own post (and its files, comments, likes)' })
  @ApiNoContentResponse({ description: 'Post deleted' })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
  )
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.postsService.remove(id, user.id);
  }
}
