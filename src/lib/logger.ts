import winston from "winston";

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
    level: process.env.LOG_LEVEL || "info",
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
