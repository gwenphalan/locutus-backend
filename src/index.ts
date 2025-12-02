import { ModelDispatcher } from "./core/dispatcher/ModelDispatcher.js";
import { env } from "./lib/config.js";
import { makeChildLogger, createFastifyLogger } from "./lib/logger.js";
import { OpenRouter } from "./providers/OpenRouter.js";
import Fastify from "fastify";

export const dispatcher = new ModelDispatcher();

if (env.OPENROUTER_API_KEY !== "") {
    dispatcher.registerProvider(new OpenRouter(env.OPENROUTER_API_KEY));
}

export const fastify = Fastify({
    logger: createFastifyLogger(makeChildLogger("Server")),
});
