import { pathToFileURL } from "url";
import { buildApp, type AppInstance } from "./app.js";
import { env } from "./lib/config.js";
import { toAppError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";

/**
 * Attaches signal handlers that close the Fastify instance gracefully.
 *
 * @remarks
 * Shutdown is idempotent so repeated signals do not race `app.close()` and
 * resource cleanup.
 */
const registerShutdownHandlers = (app: AppInstance): void => {
    let _isShuttingDown = false;

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (_isShuttingDown) {
            return;
        }

        _isShuttingDown = true;
        app.log.info({ signal }, "Received shutdown signal");

        try {
            await app.close();
            app.log.info("Server shutdown complete");
            process.exit(0);
        } catch (error) {
            app.log.error({ error: toAppError(error), signal }, "Failed to shut down server");
            process.exit(1);
        }
    };

    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
};

/**
 * Builds the Fastify app, registers lifecycle hooks, and starts listening.
 *
 * @remarks
 * This is the only runtime path that calls `listen()`. Importing `buildApp()`
 * from tests does not open a socket.
 *
 * @throws {Error} When startup fails before or during `listen()`.
 */
export const startServer = async () => {
    const app = await buildApp();

    registerShutdownHandlers(app);

    await app.listen({ port: env.PORT });
    app.log.info(`Server listening on port ${env.PORT}`);

    return app;
};

const isEntrypoint =
    typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
    try {
        await startServer();
    } catch (error) {
        logger.error("Failed to start server", { error: toAppError(error) });
        process.exit(1);
    }
}
