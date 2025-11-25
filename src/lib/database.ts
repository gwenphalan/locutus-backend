import { createClient, type RedisClientType } from "redis";
import { env } from "./config.js";
import { makeChildLogger } from "./logger.js";
import { toAppError } from "./errors.js";

const log = makeChildLogger("redis");

let client: RedisClientType | undefined;
let connectPromise: Promise<RedisClientType> | undefined;

const createRedisClient = (): RedisClientType => {
    const redisUrl = env.REDIS_URL;

    const redisClient: RedisClientType = createClient({
        url: redisUrl,
    });

    redisClient.on("error", (error) => {
        const appError = toAppError(error);
        log.error("Redis client error", { error: appError });
    });

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

export const getRedisClient = async (): Promise<RedisClientType> => {
    if (client) {
        return client;
    }

    if (connectPromise) {
        return connectPromise;
    }

    client = createRedisClient();

    connectPromise = client
        .connect()
        .then(() => {
            return client as RedisClientType;
        })
        .catch((error) => {
            const appError = toAppError(error);
            log.error("Failed to connect to Redis", { error: appError });
            client = undefined;
            connectPromise = undefined;
            throw error;
        });

    return connectPromise;
};

export const disconnectRedis = async (): Promise<void> => {
    if (!client) {
        return;
    }

    try {
        await client.quit();
        log.info("Redis connection closed via disconnectRedis");
    } catch (error) {
        log.error("Error while closing Redis connection", { error });
    } finally {
        client = undefined;
        connectPromise = undefined;
    }
};
