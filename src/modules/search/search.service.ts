import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { SearchUsersResult } from './dto/search-users-result.dto';

// Escapes LIKE wildcards so user input is matched literally: "50%" finds
// "50%", not "50" followed by anything. Pairs with ESCAPE '\' below.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async searchUsers(
    query: string,
    limit: number,
    offset: number,
  ): Promise<SearchUsersResult> {
    if (!query || !query.trim()) {
      throw new BadRequestException("Параметр query обов'язковий");
    }

    const pattern = `%${escapeLikePattern(query)}%`;

    const [items, total] = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.profile', 'profile')
      .where("user.username ILIKE :pattern ESCAPE '\\'", { pattern })
      .orWhere("profile.firstName ILIKE :pattern ESCAPE '\\'", { pattern })
      .orWhere("profile.lastName ILIKE :pattern ESCAPE '\\'", { pattern })
      // Deterministic order so limit/offset pages don't overlap or skip
      // rows between requests; id breaks ties (usernames are unique, but
      // keeps the order total even if that ever changes).
      .orderBy('user.username', 'ASC')
      .addOrderBy('user.id', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    return { items, total, limit, offset };
  }
}
