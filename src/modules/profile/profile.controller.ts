import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { User } from '../../entities/user.entity';
import { FindPostsResult } from '../posts/dto/find-posts-result.dto';
import { PaginationQueryDto } from '../posts/dto/pagination-query.dto';
import { PublicProfile } from './dto/public-profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('profile')
@Controller('users')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // Declared before ':id' routes. Also see the ProfileModule/FollowModule
  // order note in app.module.ts.
  @Get('by-username/:username')
  @ApiOperation({
    summary: 'Public user profile view, looked up by username',
    description:
      'Same response as GET /users/:id. Username match is exact and case-sensitive.',
  })
  @ApiOkResponse({ type: PublicProfile })
  @ApiErrorResponses(HttpStatus.NOT_FOUND)
  async getProfileByUsername(
    @Param('username') username: string,
    @Req() req: Request,
  ): Promise<PublicProfile> {
    const user = await this.profileService.getProfile({ username });
    return this.toPublicProfile(user, req);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Public user profile view',
    description:
      'isFollowedByMe reflects the logged-in viewer, false for anonymous requests.',
  })
  @ApiOkResponse({ type: PublicProfile })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async getProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<PublicProfile> {
    const user = await this.profileService.getProfile({ id });
    return this.toPublicProfile(user, req);
  }

  @Get(':id/posts')
  @ApiOperation({ summary: "List a user's posts, newest first" })
  @ApiOkResponse({ type: FindPostsResult })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  getUserPosts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() { limit, offset }: PaginationQueryDto,
  ): Promise<FindPostsResult> {
    return this.profileService.getUserPosts(id, limit, offset);
  }

  private async toPublicProfile(
    user: User,
    req: Request,
  ): Promise<PublicProfile> {
    const currentUserId = (req.user as User | undefined)?.id;

    const [followCounts, isFollowedByMe] = await Promise.all([
      this.profileService.getFollowCounts(user.id),
      this.profileService.isFollowedByCurrentUser(user.id, currentUserId),
    ]);

    return {
      id: user.id,
      username: user.username,
      profile: {
        firstName: user.profile?.firstName ?? null,
        lastName: user.profile?.lastName ?? null,
        bio: user.profile?.bio ?? null,
        avatar: user.profile?.avatar ?? null,
      },
      followersCount: followCounts.followersCount,
      followingCount: followCounts.followingCount,
      isFollowedByMe,
    };
  }
}
