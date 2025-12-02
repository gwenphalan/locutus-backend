---
trigger: always_on
---

## Repository Architecture & Stack

- **Package Manager**: Use **yarn** for all operations. Do not use `npm` or `npx`.
- **Language**: Backend is written in **TypeScript**.
- **Entrypoint**: `locutus-backend/src/index.ts`.
- **Settings**: TypeScript config is at `locutus-backend/tsconfig.json`.

## Core Libraries

- **Configuration**: `src/lib/config.ts` using `dotenv` + `zod`.
    - **Note**: `OPENROUTER_API_KEY` is required.
- **Logging**: `src/lib/logger.ts` (winston with child loggers per subsystem).
- **Caching**: `src/lib/cache.ts` (cache-manager, default TTL 60s).
- **Linting**: ESLint (flat config) + Prettier, 4-space indentation.
