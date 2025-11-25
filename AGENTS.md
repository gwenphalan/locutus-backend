# AGENTS – locutus-backend

## Repo Conventions

- Use yarn to install new packages.
- TypeScript backend; scripts in `package.json` use yarn.
- Primary entrypoint: `locutus-backend/src/index.ts`.
- Type configuration: `locutus-backend/tsconfig.json`.
- Environment config and validation live in `locutus-backend/src/lib/config.ts` (dotenv + zod, `OPENROUTER_API_KEY` required).
- Logging is centralized in `locutus-backend/src/lib/logger.ts` (winston, child loggers per subsystem).
- Caching is centralized in `locutus-backend/src/lib/cache.ts` (cache-manager, default TTL 60s).
- Lint/format: ESLint flat config + Prettier, 4-space indentation, Husky + lint-staged on commit.

## Naming Conventions

- Private/Protected properties and functions within classes must be prefixed with an underscore (\_)
