import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { SearchUsersResult } from './dto/search-users-result.dto';
import { SearchService } from './search.service';

const DEFAULT_LIMIT = 10;
const DEFAULT_OFFSET = 0;

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('users')
  @ApiOperation({
    summary: 'Search users by username or profile name',
    description:
      'Case-insensitive substring match on username, firstName and lastName.',
  })
  @ApiQuery({ name: 'query', required: true, type: String, example: 'john' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: DEFAULT_LIMIT,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    example: DEFAULT_OFFSET,
  })
  @ApiOkResponse({ type: SearchUsersResult })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST)
  searchUsers(
    @Query('query') query: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<SearchUsersResult> {
    const limitNum = Number(limit) || DEFAULT_LIMIT;
    const offsetNum = Number(offset) || DEFAULT_OFFSET;

    return this.searchService.searchUsers(query, limitNum, offsetNum);
  }
}
