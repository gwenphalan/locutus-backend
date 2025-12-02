import winston from "winston";
import { env } from "./config.js";

const dim = (text: string) => `\x1b[90m${text}\x1b[0m`;

/**
 * Custom log format combining timestamp, level, label, and message.
 * Handles both string and object messages, and properly formats metadata.
 */
const baseFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(({ level, message, timestamp, label, ...meta }) => {
        const ts = typeof timestamp === "string" ? timestamp : "";
        const lvl = typeof level === "string" ? level : "";
        const scope = typeof label === "string" && label.length ? ` [${label}]` : "";
        const msg = typeof message === "string" ? message : JSON.stringify(message, null, 2);
        const metaJson = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";

        const tsPart = ts ? dim(ts) : "";
        const scopePart = scope ? dim(scope) : "";
        const metaPart = metaJson ? dim(metaJson) : "";

        return `${tsPart} ${lvl}${scopePart}: ${msg}${metaPart}`;
    }),
);

/**
 * Global logger instance configured with console transport.
 * Log level is determined by the LOG_LEVEL environment variable.
 */
export const logger = winston.createLogger({
    level: env.LOG_LEVEL,
    format: baseFormat,
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({ level: true, message: false }),
                baseFormat,
            ),
        }),
    ],
});

/**
 * Creates a child logger with a specific label.
 * Useful for namespacing logs by module or component.
 *
 * @param label - The label to identify the logger (e.g., "http", "db").
 * @returns A child logger instance.
 *
 * @example
 * ```ts
 * const log = makeChildLogger("http");
 * log.info("Request received");
 * // Output: 2023-10-27 10:00:00 info [http]: Request received
 * ```
 */
export const makeChildLogger = (label: string) => logger.child({ label });

import type { FastifyBaseLogger, FastifyLogFn } from "fastify";

/**
 * Adapter to make Winston compatible with Fastify's logger interface.
 * Maps Fastify's log levels to Winston's levels and handles child logger creation.
 */
/**
 * Adapter to make Winston compatible with Fastify's logger interface.
 * Maps Fastify's log levels to Winston's levels and handles child logger creation.
 */
export class FastifyWinstonAdapter implements FastifyBaseLogger {
    constructor(private logger: winston.Logger) {}

    get level(): string {
        return this.logger.level;
    }

    set level(value: string) {
        this.logger.level = value;
    }

    // Fastify expects a 'silent' method.
    silent: FastifyLogFn = () => {
        // No-op
    };

    info: FastifyLogFn = (msgOrObj: unknown, ...args: unknown[]) => {
        this.logToWinston("info", msgOrObj, ...args);
    };

    error: FastifyLogFn = (msgOrObj: unknown, ...args: unknown[]) => {
        this.logToWinston("error", msgOrObj, ...args);
    };

    debug: FastifyLogFn = (msgOrObj: unknown, ...args: unknown[]) => {
        this.logToWinston("debug", msgOrObj, ...args);
    };

    fatal: FastifyLogFn = (msgOrObj: unknown, ...args: unknown[]) => {
        // Map fatal to error
        this.logToWinston("error", msgOrObj, ...args);
    };

    warn: FastifyLogFn = (msgOrObj: unknown, ...args: unknown[]) => {
        this.logToWinston("warn", msgOrObj, ...args);
    };

    trace: FastifyLogFn = (msgOrObj: unknown, ...args: unknown[]) => {
        // Map trace to silly
        this.logToWinston("silly", msgOrObj, ...args);
    };

    child(bindings: unknown): FastifyBaseLogger {
        // Winston child expects object
        return new FastifyWinstonAdapter(this.logger.child(bindings as object));
    }

    private logToWinston(level: string, msgOrObj: unknown, ...args: unknown[]) {
        // Handle Fastify's (obj, msg, ...args) signature vs (msg, ...args)
        if (typeof msgOrObj === "object" && msgOrObj !== null) {
            // If first arg is object, treat as metadata.
            // Fastify: log.info({ properties }, 'message')
            // Winston: log.info('message', { properties })
            const msg = args[0];
            const remainingArgs = args.slice(1);
            if (typeof msg === "string") {
                this.logger.log(level, msg, {
                    ...msgOrObj,
                    args: remainingArgs,
                });
            } else {
                // Just object, no message string?
                this.logger.log(level, "", {
                    ...msgOrObj,
                    args: args,
                });
            }
        } else if (typeof msgOrObj === "string") {
            // Standard (msg, ...args)
            this.logger.log(level, msgOrObj, ...args);
        } else {
            // Fallback
            this.logger.log(level, String(msgOrObj), ...args);
        }
    }
}

export const createFastifyLogger = (logger: winston.Logger): FastifyBaseLogger => {
    return new FastifyWinstonAdapter(logger);
};
