import type { Request } from 'express';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// Per-IP limits. `default` applies to every route; the rest replace it on
// the routes they decorate via @Throttle({ default: THROTTLE_LIMITS.x }).
export const THROTTLE_LIMITS = {
  default: { limit: 60, ttl: MINUTE },
  login: { limit: 5, ttl: MINUTE },
  register: { limit: 3, ttl: MINUTE },
  confirmEmail: { limit: 10, ttl: MINUTE },
  likes: { limit: 20, ttl: 10 * SECOND },
};

export const THROTTLE_ERROR_MESSAGE = 'Забагато запитів, спробуйте пізніше';

// With TRUST_PROXY=true, setupApp() sets Express' `trust proxy` to 1 hop, so
// req.ips is the X-Forwarded-For chain as seen by that one proxy and ips[0]
// is the address it received the request from (the real client). Without
// it req.ips is empty and the socket address is used, and a client can't
// dodge the limit by sending its own X-Forwarded-For.
export function getClientTracker(req: Request): Promise<string> {
  return Promise.resolve(req.ips.length > 0 ? req.ips[0] : (req.ip ?? ''));
}
