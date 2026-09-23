import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportSerializer } from '@nestjs/passport';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super();
  }

  serializeUser(user: User, done: (err: Error | null, id?: string) => void) {
    done(null, user.id);
  }

  async deserializeUser(
    id: string,
    done: (err: Error | null, user?: User | false) => void,
  ) {
    let user: User | null;
    try {
      user = await this.userRepository.findOne({ where: { id } });
    } catch (error) {
      // Without this a failed lookup (e.g. DB down) left every request with
      // a session cookie hanging, since passport waits for done() forever.
      done(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    // The user may have been deleted while their session lived on. `false`
    // is passport's "no user" signal: the request continues as anonymous
    // and clearOrphanedSession() then removes the session from the store.
    done(null, user ?? false);
  }
}
