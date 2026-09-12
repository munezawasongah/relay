import Redis from "ioredis";

// Lazily constructed — see the auth-service's redis.ts for why.
let _redis: Redis | undefined;
function redis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  }
  return _redis;
}

// Tracks how many live sockets each user currently has open (a user can have
// several: multiple tabs/devices). Presence flips online->offline only when
// the count returns to zero, and this is what lets any messaging-service
// instance answer "is this user online?" without holding the socket itself —
// the piece that matters once this scales past one process behind the
// Redis-backed socket.io adapter.
export async function incrementPresence(userId: string): Promise<number> {
  return redis().incr(`presence:count:${userId}`);
}

export async function decrementPresence(userId: string): Promise<number> {
  const count = await redis().decr(`presence:count:${userId}`);
  if (count <= 0) {
    await redis().del(`presence:count:${userId}`);
    return 0;
  }
  return count;
}

export async function isUserOnline(userId: string): Promise<boolean> {
  const count = await redis().get(`presence:count:${userId}`);
  return Number(count) > 0;
}
