import { env } from "./lib/config.js";
import { makeChildLogger } from "./lib/logger.js";

const log = makeChildLogger("bootstrap");

log.info(`Locutus backend starting on port ${env.PORT}`);
