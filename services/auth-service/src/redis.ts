import Redis from "ioredis";

// Lazily constructed for the same reason as db.ts's pool(): avoid reading
// process.env before index.ts's dotenv.config() has run.
let _redis: Redis | undefined;
export function redis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  }
  return _redis;
}
