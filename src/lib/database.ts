import { createClient, type RedisClientType } from "redis";
import { env } from "./config.js";
import { makeChildLogger } from "./logger.js";
import { toAppError } from "./errors.js";

const log = makeChildLogger("redis");

let client: RedisClientType | undefined;
let connectPromise: Promise<RedisClientType> | undefined;

/**
 * Creates and configures a new Redis client instance.
 * Sets up event listeners for logging connection status and errors.
 *
 * @returns The configured Redis client.
 */
const createRedisClient = (): RedisClientType => {
    const redisUrl = env.REDIS_URL;

    const redisClient: RedisClientType = createClient({
        url: redisUrl,
    });

    // Log errors to track connection issues or runtime failures
    redisClient.on("error", (error) => {
        const appError = toAppError(error);
        log.error("Redis client error", { error: appError });
    });

    // Log successful connection for monitoring
    redisClient.on("connect", () => {
        log.info(`Connected to Redis at ${redisUrl}`);
    });

    redisClient.on("reconnecting", () => {
        log.warn("Reconnecting to Redis...");
    });

    redisClient.on("end", () => {
        log.warn("Redis connection closed");
    });

    return redisClient;
};

/**
 * Retrieves the singleton Redis client.
 * Handles lazy initialization and connection management.
 *
 * @returns A promise that resolves to the connected Redis client.
 */
export const getRedisClient = async (): Promise<RedisClientType> => {
    // Return existing client if already connected
    if (client) {
        log.debug("Reusing existing Redis client");
        return client;
    }

    // Return pending connection promise if initialization is in progress
    if (connectPromise) {
        return connectPromise;
    }

    // Initialize new client and connection promise
    client = createRedisClient();

    connectPromise = client
        .connect()
        .then(() => {
            return client as RedisClientType;
        })
        .catch((error) => {
            // Cleanup on connection failure to allow retries
            const appError = toAppError(error);
            log.error("Failed to connect to Redis", { error: appError });
            client = undefined;
            connectPromise = undefined;
            throw error;
        });

    return connectPromise;
};

/**
 * Gracefully disconnects the Redis client.
 * Ensures the connection is closed and resources are released.
 */
export const disconnectRedis = async (): Promise<void> => {
    // Wait for any pending connection to complete before disconnecting
    if (connectPromise) {
        try {
            await connectPromise;
        } catch {
            // Connection failed, nothing to disconnect
            return;
        }
    }

    if (!client) {
        return;
    }

    try {
        await client.quit();
        log.info("Redis connection closed via disconnectRedis");
    } catch (error) {
        log.error("Error while closing Redis connection", { error });
    } finally {
        // Reset singleton state to allow reconnection later
        client = undefined;
        connectPromise = undefined;
    }
};
