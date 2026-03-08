import Fastify from "fastify";
import fastifyWinston from "fastify-winston";
import { ModelDispatcher } from "./core/dispatcher/ModelDispatcher.js";
import { env } from "./lib/config.js";
import { disconnectRedis } from "./lib/database.js";
import { toAppError } from "./lib/errors.js";
import { makeChildLogger } from "./lib/logger.js";
import { OpenRouter } from "./providers/OpenRouter.js";
import healthRoute from "./routes/health.js";

declare module "fastify" {
    interface FastifyInstance {
        dispatcher: ModelDispatcher;
    }
}

/**
 * Builds a fully configured Fastify application without opening a network port.
 *
 * @remarks
 * The factory owns process-local infrastructure wiring for providers, route
 * registration, and shutdown hooks so tests can use `app.inject()` against the
 * same setup as production.
 *
 * @throws {Error} When Fastify plugin registration fails.
 */
export const buildApp = async () => {
    const dispatcher = new ModelDispatcher();
    if (env.OPENROUTER_API_KEY !== "") {
        dispatcher.registerProvider(new OpenRouter(env.OPENROUTER_API_KEY));
    }

    const app = Fastify({
        loggerInstance: fastifyWinston(makeChildLogger("server")),
    });

    app.decorate("dispatcher", dispatcher);

    app.setErrorHandler((error, request, reply) => {
        const appError = toAppError(error);
        request.log.error({ error: appError }, "Unhandled request error");

        void reply.status(appError.statusCode).send({
            error: appError.code,
            message: appError.message,
        });
    });

    // Close shared infrastructure when the app shuts down so tests and the
    // production entrypoint use the same cleanup path.
    app.addHook("onClose", async () => {
        await disconnectRedis();
    });

    app.register(healthRoute);

    await app.ready();

    return app;
};

/**
 * Concrete Fastify instance type returned by `buildApp()`.
 */
export type AppInstance = Awaited<ReturnType<typeof buildApp>>;
