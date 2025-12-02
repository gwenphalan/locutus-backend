import { ModelDispatcher } from "./core/dispatcher/ModelDispatcher.js";
import { env } from "./lib/config.js";
import { makeChildLogger } from "./lib/logger.js";
import { OpenRouter } from "./providers/OpenRouter.js";
import Fastify from "fastify";
import autoload from "@fastify/autoload";
import fastifyWinston from "fastify-winston";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const dispatcher = new ModelDispatcher();

if (env.OPENROUTER_API_KEY !== "") {
    dispatcher.registerProvider(new OpenRouter(env.OPENROUTER_API_KEY));
}

export const fastify = Fastify({
    loggerInstance: fastifyWinston(makeChildLogger("server")),
});

fastify.register(autoload, {
    dir: join(__dirname, "routes"),
});

try {
    await fastify.listen({ port: env.PORT });
    fastify.log.info(`Server listening on port ${env.PORT}`);
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}
