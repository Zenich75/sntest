import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { Follow } from '../../entities/follow.entity';
import { User } from '../../entities/user.entity';
import { FollowService } from './follow.service';

@ApiTags('follow')
@Controller('users')
export class FollowController {
  constructor(private readonly followService: FollowService) {}

  @Post(':id/follow')
  @UseGuards(SessionAuthGuard)
  @ApiCsrfProtected()
  @ApiOperation({
    summary: 'Follow a user',
    description: 'Idempotent: following twice returns the existing relation.',
  })
  @ApiCreatedResponse({ type: Follow })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.FORBIDDEN,
  )
  follow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Follow> {
    return this.followService.follow(user, id);
  }

  @Delete(':id/follow')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  @ApiCsrfProtected()
  @ApiOperation({ summary: 'Unfollow a user' })
  @ApiNoContentResponse({ description: 'Unfollowed' })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.FORBIDDEN,
  )
  unfollow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.followService.unfollow(user.id, id);
  }

  @Get(':id/followers')
  @ApiOperation({ summary: "List a user's followers" })
  @ApiOkResponse({ type: [User] })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST)
  getFollowers(@Param('id', ParseUUIDPipe) id: string): Promise<User[]> {
    return this.followService.getFollowers(id);
  }

  @Get(':id/following')
  @ApiOperation({ summary: 'List who a user is following' })
  @ApiOkResponse({ type: [User] })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST)
  getFollowing(@Param('id', ParseUUIDPipe) id: string): Promise<User[]> {
    return this.followService.getFollowing(id);
  }
}
