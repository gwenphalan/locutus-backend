# AGENTS.md

## Project overview

Backend for the Locutus personal AI agent. Provides an intelligent model routing layer (ModelDispatcher) that orchestrates LLM requests across multiple providers with rate-limit awareness, cost optimization, and quota tracking. Currently exposing an OpenAI-compatible API for downstream consumers. The project is undergoing a modernization effort tracked in the [Linear project (Locutus Backend)](https://linear.app) under team **LOC**.

**Target Stack:** Fastify 5, TypeScript (strict, ESM), Pino logging, ioredis, SQLite + SQLCipher (via Drizzle ORM), Keycloak OIDC/JWT auth, Zod type provider, pnpm, Docker Compose (app + Redis + Keycloak + Postgres).

## Migration status

The codebase is being modernized from a legacy setup to the target stack above. The integration branch `refactor/fastify-modernization` tracks this work. Key changes:

| Area            | Legacy (being replaced)      | Target                                               |
| --------------- | ---------------------------- | ---------------------------------------------------- |
| Package manager | yarn                         | pnpm                                                 |
| Logging         | Winston + `makeChildLogger`  | Pino (built-in Fastify logger)                       |
| Redis           | `redis` package (raw client) | ioredis with Fastify plugin                          |
| Cache           | cache-manager (in-memory)    | Redis-backed cache middleware                        |
| Routing         | `@fastify/autoload`          | Explicit domain module registration                  |
| Database        | None (Redis only)            | SQLite + SQLCipher via Drizzle ORM                   |
| Auth            | None                         | Keycloak OIDC / JWT                                  |
| App structure   | Monolithic `src/index.ts`    | App factory pattern (`src/app.ts` + `src/server.ts`) |
| Build           | tsup                         | tsc                                                  |
| API docs        | None                         | `@fastify/swagger` + `@fastify/swagger-ui`           |

If a module still uses the legacy pattern, migrate it to the target when touching it. Do not introduce new code using legacy patterns.

## Build and run

> **Note:** Until LOC-28 (yarn → pnpm migration) is complete, use `yarn` for all commands. After that issue merges, switch to `pnpm`.

```bash
# Current (pre-migration)
yarn install              # Install dependencies
yarn dev                  # Start dev server (tsx watch src/index.ts)
yarn build                # Compile via tsup
yarn start                # Run compiled output
yarn typecheck            # Type-check without emitting
yarn lint                 # ESLint (flat config)
yarn lint:fix             # Auto-fix lint issues
yarn format               # Prettier format
yarn format:check         # Prettier check (CI)

# Target (post-migration)
pnpm install              # Install dependencies
pnpm dev                  # Start dev server (tsx watch src/server.ts)
pnpm build                # Compile TypeScript (tsc)
pnpm start                # Run compiled output
docker compose up -d      # Start full stack (app, Redis, Keycloak)
```

## Verification

Before committing, run all three in order:

```bash
yarn typecheck            # Catches type errors tsx ignores
yarn build                # Ensures build compatibility
yarn lint                 # Ensures style compliance
```

All three must pass. Husky pre-commit hooks enforce lint-staged (prettier + eslint) and commitlint automatically.

## Testing

```bash
yarn test                 # Run all tests (Vitest)
yarn test -- --watch      # Watch mode
```

Always run tests before committing. One unit test exists: `src/core/dispatcher/ModelDispatcher.test.ts`. Integration test infrastructure is planned (LOC-27).

## Database

> **Not yet implemented.** Tracked by LOC-17 (DB overhaul).

Target setup once LOC-17 merges:

```bash
pnpm db:generate          # Generate migrations from schema changes
pnpm db:migrate           # Apply pending migrations
pnpm db:studio            # Open Drizzle Studio (visual DB browser)
```

- Primary DB: SQLite with SQLCipher encryption at `./data/app.db`
- ORM: Drizzle with `@silencelaboratories/better-sqlite3`
- Schema files: `src/db/schema/`
- Migrations: `src/db/migrations/`
- Encryption key set via `DB_ENCRYPTION_KEY` env var and `PRAGMA key` on open
- Never modify migration files after they have been committed

## Target project structure

```
src/
├── app.ts                            # Fastify app factory (buildApp)
├── server.ts                         # Entry point — starts the server
├── config/
│   └── env.ts                        # Typed env config (@fastify/env or envalid)
├── plugins/
│   ├── redis.ts                      # ioredis Fastify plugin
│   ├── keycloak.ts                   # Keycloak OIDC/JWT plugin
│   ├── cors.ts                       # CORS configuration
│   └── swagger.ts                    # @fastify/swagger + swagger-ui
├── modules/
│   ├── health/
│   │   └── routes.ts                 # GET /health
│   ├── chat/
│   │   ├── routes.ts                 # OpenAI-compatible /v1/chat/completions
│   │   ├── handlers.ts
│   │   ├── schemas.ts                # Zod request/response schemas
│   │   └── service.ts                # Business logic (delegates to dispatcher)
│   └── <domain>/
│       ├── routes.ts
│       ├── handlers.ts
│       ├── schemas.ts
│       └── service.ts
├── core/
│   └── dispatcher/
│       ├── ModelDispatcher.ts        # Intelligent LLM routing across providers
│       ├── ModelDispatcher.test.ts
│       ├── ModelProvider.ts          # Abstract provider base class
│       └── ModelRoutingTypes.ts      # Routing types (snapshots, pricing, quotas)
├── db/
│   ├── client.ts                     # Drizzle client + SQLCipher setup
│   ├── schema/                       # Drizzle table definitions
│   └── migrations/                   # Generated migrations
├── middleware/
│   ├── auth.ts                       # requireAuth / requireRole guards
│   └── cache.ts                      # Redis cache middleware
├── lib/
│   ├── errors.ts                     # AppError, NotFoundError, etc.
│   ├── logger.ts                     # Pino logger config (if custom config needed)
│   └── redis.ts                      # Redis helper utilities
├── providers/
│   └── OpenRouter.ts                 # OpenRouter LLM provider
└── types/
    └── index.ts                      # Shared type declarations
```

### Current structure (legacy)

The codebase currently uses a flatter layout. Key differences from target:

- `src/index.ts` — monolithic entrypoint (will become `app.ts` + `server.ts`)
- `src/lib/logger.ts` — Winston (will become Pino)
- `src/lib/database.ts` — raw `redis` client (will become ioredis plugin)
- `src/lib/cache.ts` — in-memory cache-manager (will become Redis-backed)
- `src/routes/health.ts` — autoloaded (will become explicit module registration)

### Key existing files

| File                                       | Purpose                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `src/core/dispatcher/ModelDispatcher.ts`   | Orchestrates LLM requests across providers with cost and rate-limit awareness   |
| `src/core/dispatcher/ModelProvider.ts`     | Abstract base class all LLM providers extend                                    |
| `src/core/dispatcher/ModelRoutingTypes.ts` | Type defs for routing snapshots, pricing tiers, quotas                          |
| `src/providers/OpenRouter.ts`              | OpenRouter provider implementation                                              |
| `src/lib/config.ts`                        | Env validation via Zod (`PORT`, `LOG_LEVEL`, `OPENROUTER_API_KEY`, `REDIS_URL`) |
| `src/lib/errors.ts`                        | `AppError` (base), `ProviderError` (provider-specific), converter helpers       |

## Environment variables

Current (defined in `src/lib/config.ts`):

| Variable             | Required | Default                               | Description          |
| -------------------- | -------- | ------------------------------------- | -------------------- |
| `PORT`               | No       | `3000`                                | Server port          |
| `LOG_LEVEL`          | No       | `info`                                | Log level            |
| `OPENROUTER_API_KEY` | No       | `""`                                  | OpenRouter API key   |
| `REDIS_URL`          | No       | `redis://:devpassword@localhost:6379` | Redis connection URL |

Target additions (post-migration):

| Variable                 | Required | Default         | Description              |
| ------------------------ | -------- | --------------- | ------------------------ |
| `HOST`                   | No       | `0.0.0.0`       | Server bind address      |
| `NODE_ENV`               | No       | `development`   | Runtime environment      |
| `DB_PATH`                | No       | `./data/app.db` | SQLite database path     |
| `DB_ENCRYPTION_KEY`      | Yes      | —               | SQLCipher encryption key |
| `REDIS_HOST`             | No       | `localhost`     | Redis host               |
| `REDIS_PORT`             | No       | `6379`          | Redis port               |
| `REDIS_PASSWORD`         | No       | —               | Redis password           |
| `KEYCLOAK_REALM_URL`     | Yes      | —               | Keycloak realm URL       |
| `KEYCLOAK_CLIENT_ID`     | Yes      | —               | Keycloak client ID       |
| `KEYCLOAK_CLIENT_SECRET` | Yes      | —               | Keycloak client secret   |

## Code style

### Formatting

Enforced by Prettier (`.prettierrc`):

- **Indentation:** 4 spaces
- **Print width:** 100 characters
- **Quotes:** Double quotes
- **Semicolons:** Always
- **Trailing commas:** All

### Naming

| Context                     | Convention               | Example                         |
| --------------------------- | ------------------------ | ------------------------------- |
| Files                       | kebab-case               | `model-dispatcher.ts`           |
| Functions / variables       | camelCase                | `getRedisClient`                |
| Types / interfaces          | PascalCase               | `ModelRoutingSnapshot`          |
| Classes                     | PascalCase               | `ModelDispatcher`               |
| Private / protected members | Underscore prefix        | `private _providers`            |
| Constants                   | camelCase or UPPER_SNAKE | `DEFAULT_TTL_SECONDS`           |
| DB columns                  | snake_case               | `created_at`                    |
| Endpoints                   | kebab-case, plural nouns | `/api/user-profiles`            |
| Route params                | camelCase                | `/api/users/:userId`            |
| Query params                | camelCase                | `?pageSize=20&sortBy=createdAt` |

### Patterns

- **Logging:** Use Pino (Fastify's built-in logger) — never `console.log`. Legacy code uses Winston `makeChildLogger`; migrate to `request.log` / `app.log` when touching those files.
- **Errors:** Use `AppError` subclasses (`NotFoundError`, `ConflictError`, `ForbiddenError`) — never raw `throw new Error()`.
- **Validation:** Every route must have Zod schemas for request validation and typed responses via `fastify-type-provider-zod`.
- **Auth:** Apply `requireAuth` or `requireRole` preHandler to all non-public routes.
- **Env access:** Always go through the typed config — never raw `process.env`.
- **Route handlers:** Keep thin — business logic belongs in `service.ts` files.
- **Response envelope:** `{ data: ... }` for success, `{ data: [...], meta: { total, page, pageSize } }` for collections, `{ error: { code, message } }` for errors.

**Example — target route definition:**

```typescript
app.get("/:id", {
    preHandler: [requireAuth],
    schema: {
        params: userParamsSchema,
        response: { 200: userResponseSchema },
    },
    handler: handlers.getUser,
});
```

### TSDoc

- No redundant types in `@param` or `@returns` — rely on TypeScript signatures
- Classes: document what problem they solve
- Methods: document what they do, why they exist, and side effects
- Required tags: `@throws`, `@remarks`, `@internal`, `@example` (for complex utilities)
- Inline comments explain _why_, not _what_

### Planning

All generated plans must include **code snippets** for all proposed changes and specific **file references**.

## Git workflow

### Branching

| Prefix      | When                      | Example                         |
| ----------- | ------------------------- | ------------------------------- |
| `feature/`  | New functionality         | `feature/LOC-15-openai-api`     |
| `fix/`      | Bug fixes                 | `fix/LOC-32-auth-token-expiry`  |
| `chore/`    | Maintenance, deps, config | `chore/LOC-28-yarn-to-pnpm`     |
| `refactor/` | Code restructuring        | `refactor/LOC-18-app-factory`   |
| `docs/`     | Documentation only        | `docs/LOC-29-agents-md-rewrite` |

Always include the Linear issue ID in the branch name.

### Integration branch

The modernization uses an integration branch: `refactor/fastify-modernization` (branched from `feature/fastify-routing-setup`). All migration work branches from and merges back into this integration branch. Once stable, it merges to `main`.

**Tier ordering:**

1. **Tier 1 (sequential):** LOC-28 → LOC-18 → LOC-20 → LOC-22 → LOC-25
2. **Tier 2 (parallel after T1):** LOC-21, LOC-19, LOC-17, LOC-16, LOC-23, LOC-26
3. **Tier 3 (depends on T2):** LOC-15, LOC-24, LOC-27, LOC-29

### Commits

Format: `<type>(<scope>): concise action statement`

Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`, `perf`

Rules (enforced by commitlint + `@commitlint/config-conventional`):

- Imperative mood ("add X", not "added X")
- First line ≤ 72 characters
- No trailing period on the first line
- Optional body for context or rationale, wrapped at ~80 characters
- Reference Linear issues: `Resolves LOC-123`

**Good:** `feat(dispatcher): add cost-aware provider selection`
**Bad:** `Updated the dispatcher to add cost selection.`

### PR workflow

1. Branch from the integration branch (`refactor/fastify-modernization`)
2. Make focused commits — one logical unit per commit
3. Run verification (`typecheck` → `build` → `lint`) before committing
4. Husky runs `lint-staged` (prettier + eslint) and `commitlint` on commit
5. Open a PR targeting the integration branch
6. Reference Linear issues in PR body: `Resolves LOC-123`
7. Rebase onto target before merging; avoid merge commits

### What to commit

- ✅ Commit when a logical unit of work is complete and tests pass
- ✅ Commit frequently enough to preserve reasoning
- 🚫 Never commit `.env`, secrets, or database files (`data/*.db`)
- 🚫 Never commit commented-out code or local-only experiments
- 🚫 Never commit with an empty or non-conventional message

## Docker

Current:

```bash
docker compose up -d redis   # Start Redis only
docker compose down           # Stop all services
```

Target (after LOC-23):

```bash
docker compose up -d          # Start full stack (app, Redis, Keycloak, Postgres)
docker compose down            # Stop everything
```

Target services: app (Fastify), Redis 7 (ioredis), Keycloak 26 (OIDC provider), Postgres 16 (Keycloak backing store). SQLite runs embedded in the app container with a volume mount for `data/`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) on push to `main` and PRs against `main`:

1. Install dependencies (frozen lockfile)
2. Lint
3. Format check
4. Typecheck
5. Run tests
6. Build

## Linear

Team **Locutus-of-borg** (key: `LOC`). Project: **Locutus Backend**.

All work must be tracked as Linear issues. Branch names include the issue ID (`feature/LOC-15-openai-api`). PRs reference the issue (`Resolves LOC-15`).

## Boundaries

- ✅ **Always do:** Run verification before committing. Use Zod schemas on all routes. Use conventional commits with Linear issue IDs. Use `AppError` subclasses for errors. Use Pino for logging (or `request.log` / `app.log`). Keep route handlers thin — business logic in service files. Write TSDoc on all exports. Follow the target patterns, not legacy patterns, for new code.
- ⚠️ **Ask first:** Adding new dependencies. Changing the env schema. Modifying `tsconfig.json` compiler options. Changing Docker Compose services. Altering the CI pipeline. Changing the ModelDispatcher routing logic. Modifying Keycloak realm configuration. Changing DB schema.
- 🚫 **Never do:** Commit `.env`, secrets, or `data/*.db`. Use `console.log` instead of Pino. Use raw `process.env` instead of typed config. Push directly to `main`. Skip verification steps. Use `npm` or `npx`. Commit with empty or non-conventional messages. Introduce legacy patterns (`winston`, `cache-manager`, `@fastify/autoload`, raw `redis`) in new code. Modify migration files after commit.
