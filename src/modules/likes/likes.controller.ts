import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { ApiCsrfProtected } from '../../common/swagger/api-csrf-protected.decorator';
import { THROTTLE_LIMITS } from '../../common/throttling/throttle-limits';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { Like } from '../../entities/like.entity';
import { User } from '../../entities/user.entity';
import { LikesInfo } from './dto/likes-info.dto';
import { LikesService } from './likes.service';

@ApiTags('likes')
@Controller('posts/:postId/likes')
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Post()
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: THROTTLE_LIMITS.likes })
  @ApiCsrfProtected()
  @ApiOperation({
    summary: 'Like a post',
    description: 'Idempotent: liking twice returns the existing like.',
  })
  @ApiCreatedResponse({ type: Like })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.FORBIDDEN,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  like(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: User,
  ): Promise<Like> {
    return this.likesService.like(user, postId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: THROTTLE_LIMITS.likes })
  @ApiCsrfProtected()
  @ApiOperation({ summary: 'Unlike a post' })
  @ApiNoContentResponse({ description: 'Like removed' })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.FORBIDDEN,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  unlike(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.likesService.unlike(user.id, postId);
  }

  @Get()
  @ApiOperation({
    summary: 'Like count for a post, plus whether the current viewer liked it',
  })
  @ApiOkResponse({ type: LikesInfo })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  getLikesInfo(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Req() req: Request,
  ): Promise<LikesInfo> {
    const currentUserId = (req.user as User | undefined)?.id;
    return this.likesService.getLikesInfo(postId, currentUserId);
  }
}
