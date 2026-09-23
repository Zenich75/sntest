import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { ApiCsrfProtected } from '../../common/swagger/api-csrf-protected.decorator';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { Comment } from '../../entities/comment.entity';
import { User } from '../../entities/user.entity';
import { PaginationQueryDto } from '../posts/dto/pagination-query.dto';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { FindCommentsResult } from './dto/find-comments-result.dto';

@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post('posts/:postId/comments')
  @UseGuards(SessionAuthGuard)
  @ApiCsrfProtected()
  @ApiOperation({ summary: 'Add a comment to a post' })
  @ApiCreatedResponse({ type: Comment })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.FORBIDDEN,
  )
  create(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateCommentDto,
  ): Promise<Comment> {
    return this.commentsService.create(postId, user, dto);
  }

  @Get('posts/:postId/comments')
  @ApiOperation({ summary: "List a post's comments, oldest first" })
  @ApiOkResponse({ type: FindCommentsResult })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  findByPost(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() { limit, offset }: PaginationQueryDto,
  ): Promise<FindCommentsResult> {
    return this.commentsService.findByPost(postId, limit, offset);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  @ApiCsrfProtected()
  @ApiOperation({ summary: 'Delete own comment' })
  @ApiNoContentResponse({ description: 'Comment deleted' })
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
    return this.commentsService.remove(id, user.id);
  }
}
