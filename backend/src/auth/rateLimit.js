// Tiny in-memory fixed-window limiter for the auth endpoints. Fine for a single
// server process; use a shared store (e.g. Redis) if you run several instances.
const buckets = new Map();

/** Counts a hit for `key`; returns true while it's within `max` per `windowMs`. */
export function hit(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

export function reset(key) {
  buckets.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, 10 * 60 * 1000).unref();
