import { createCache, type Cache } from "cache-manager";

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
    get: (key) => cache.get(key),
    set: (key, value, ttlSeconds = DEFAULT_TTL_SECONDS) => cache.set(key, value, ttlSeconds),
    del: (key) => cache.del(key),
    wrap: (key, fn, ttlSeconds = DEFAULT_TTL_SECONDS) => cache.wrap(key, fn, ttlSeconds),
    reset: async () => {
        await cache.clear();
    },
};

export default cacheClient;
