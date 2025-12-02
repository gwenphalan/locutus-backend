import { ProviderRouter } from "./core/router/ProviderRouter.js";
import { env } from "./lib/config.js";
import { makeChildLogger } from "./lib/logger.js";
import { OpenRouter } from "./router/providers/OpenRouter.js";

const log = makeChildLogger("bootstrap");

const router = new ProviderRouter();

if (env.OPENROUTER_API_KEY !== "") router.registerProvider(new OpenRouter(env.OPENROUTER_API_KEY));

log.info(`Locutus backend starting on port ${env.PORT}`);
