import { createCache, type Cache } from "cache-manager";

export type Cacheable = string | number | boolean | Record<string, unknown> | Array<unknown>;

export interface CacheClient {
    get<T = Cacheable>(key: string): Promise<T | undefined>;
    set<T = Cacheable>(key: string, value: T, ttlSeconds?: number): Promise<T>;
    del(key: string): Promise<boolean>;
    wrap<T = Cacheable>(key: string, fn: () => T | Promise<T>, ttlSeconds?: number): Promise<T>;
    reset(): Promise<void>;
}

const DEFAULT_TTL_SECONDS = 60;

const cache: Cache = createCache({
    ttl: DEFAULT_TTL_SECONDS,
});

export const cacheClient: CacheClient = {
    get: (key) => cache.get(key),
    set: (key, value, ttlSeconds = DEFAULT_TTL_SECONDS) => cache.set(key, value, ttlSeconds),
    del: (key) => cache.del(key),
    wrap: (key, fn, ttlSeconds = DEFAULT_TTL_SECONDS) => cache.wrap(key, fn, ttlSeconds),
    reset: () => cache.clear(),
};

export default cacheClient;
