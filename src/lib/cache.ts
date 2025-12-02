import { createCache, type Cache } from "cache-manager";
import { makeChildLogger } from "./logger.js";

const log = makeChildLogger("cache");

/**
 * Represents types that can be stored in the cache.
 * Includes primitives and JSON-serializable objects/arrays.
 */
export type Cacheable = string | number | boolean | Record<string, unknown> | Array<unknown>;

/**
 * Interface for a cache client wrapper.
 * Provides standard methods for getting, setting, deleting, and wrapping cache operations.
 */
export interface CacheClient {
    /**
     * Retrieves a value from the cache.
     * @param key - Unique identifier for the item.
     * @returns The cached value or undefined if missing.
     */
    get<T = Cacheable>(key: string): Promise<T | undefined>;

    /**
     * Sets a value in the cache.
     * @param key - Unique identifier for the item.
     * @param value - Data to store.
     * @param ttlSeconds - Time-to-live in seconds (optional).
     * @returns The stored value.
     */
    set<T = Cacheable>(key: string, value: T, ttlSeconds?: number): Promise<T>;

    /**
     * Deletes a value from the cache.
     * @param key - Unique identifier for the item.
     * @returns True if deleted, false if not found.
     */
    del(key: string): Promise<boolean>;

    /**
     * Wraps a function call with caching logic.
     * If the key exists, returns the cached value.
     * Otherwise, executes the function, caches the result, and returns it.
     *
     * @param key - Unique identifier for the item.
     * @param fn - Factory function to generate value on miss.
     * @param ttlSeconds - Time-to-live in seconds (optional).
     * @returns The cached or generated value.
     * @throws If the factory function `fn` throws.
     */
    wrap<T = Cacheable>(key: string, fn: () => T | Promise<T>, ttlSeconds?: number): Promise<T>;

    /**
     * Resets the entire cache.
     */
    reset(): Promise<void>;
}

const DEFAULT_TTL_SECONDS = 60;

const cache: Cache = createCache({
    ttl: DEFAULT_TTL_SECONDS,
});

/**
 * Singleton instance of the cache client.
 * Uses `cache-manager` with a default in-memory store.
 *
 * @remarks
 * The default TTL is 60 seconds.
 */
export const cacheClient: CacheClient = {
    get: async <T = Cacheable>(key: string) => {
        const val = await cache.get(key);
        if (val) {
            log.debug("Cache hit", { key });
        } else {
            log.debug("Cache miss", { key });
        }
        return val as T | undefined;
    },
    set: async (key, value, ttlSeconds = DEFAULT_TTL_SECONDS) => {
        log.debug("Cache set", { key, ttlSeconds });
        return cache.set(key, value, ttlSeconds);
    },
    del: (key) => cache.del(key),
    wrap: async (key, fn, ttlSeconds = DEFAULT_TTL_SECONDS) => {
        return cache.wrap(
            key,
            async () => {
                log.debug("Cache wrap miss - executing factory", { key });
                return fn();
            },
            ttlSeconds,
        );
    },
    reset: async () => {
        await cache.clear();
    },
};

export default cacheClient;
