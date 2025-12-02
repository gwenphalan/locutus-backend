# AGENTS — locutus-backend

## Planning Conventions

- All plans should have code snippets for all code changes, and file references.

## Repository Conventions

- Use **yarn** for all package operations; backend is written in **TypeScript**.
- Main entrypoint: `locutus-backend/src/index.ts`.
- TypeScript settings: `locutus-backend/tsconfig.json`.
- Environment configuration: `src/lib/config.ts` (dotenv + zod).
    - **OPENROUTER_API_KEY** is required.
- Logging: `src/lib/logger.ts` (winston with child loggers per subsystem).
- Caching: `src/lib/cache.ts` (cache-manager, default TTL 60s).
- Lint/format: ESLint (flat config) + Prettier, 4-space indentation, Husky + lint-staged on commit.

## Development Workflow & Commands

We use **yarn** for all operations. Do not use `npm` or `npx` directly unless necessary.

### Core Commands

- **Build**: `yarn build`
    - Uses `tsup` to compile TypeScript to ESM in `dist/`.
    - Always run this to verify the build output, not `tsc`.
- **Typecheck**: `yarn typecheck`
    - Uses `tsc --noEmit` to check for type errors without emitting files.
    - Run this to ensure type safety.
- **Dev Server**: `yarn dev`
    - Uses `tsx` to watch and run `src/index.ts`.
- **Start Production**: `yarn start`
    - Runs the built code from `dist/index.js`.
- **Lint & Format**: `yarn lint` / `yarn format`
    - Standard linting and formatting.

### Workflow

1.  **Development**: Use `yarn dev` for fast feedback loop.
2.  **Verification**:
    - Run `yarn typecheck` to catch type errors.
    - Run `yarn build` to ensure the project builds correctly with `tsup`.
    - Run `yarn lint` to check for style issues.
3.  **Commit**: Husky will automatically run lint and format on staged files.

## Git Conventions

### Branching & PR Strategy

- Use short-lived feature branches: `feature/<name>` for features, `fix/<name>` for bug fixes, `chore/<name>` for maintenance.
- Keep branches focused on a single concern.
- Open a PR early if you want feedback; mark as draft until ready.
- Rebase onto `main` before merging; avoid merge commits unless required.
- Keep PRs small and coherent; large changes should be split.

### Commit Message Guidelines

- Follow the format:  
  **\<type\>: concise action statement**  
  Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`.
- First line ≤ 72 chars; use imperative mood (“add X”, “fix Y”).
- Optional body for context or rationale; wrap at ~80 chars.
- Reference issues or PRs when relevant.

### When and Why to Commit

- Commit when a logical unit of work is complete and tests pass.
- Avoid mixing unrelated changes in one commit.
- Commit frequently enough to preserve reasoning, but not so often that commits become noise.
- Don’t commit temporary debugging artifacts, commented-out code, or local-only experiments.

### Additional Git Guidelines

- Never commit secrets or `.env` content; ensure `.gitignore` is respected.
- Run lint/format before committing; Husky enforces this automatically.
- Prefer rebase for cleanup before PR submission; squash commits in PR if they’re not individually meaningful.
- Write commit messages with future maintainers in mind—explain intent, not just actions.

## Naming Conventions

- Private and protected class members must be prefixed with an underscore (`_`).

## Documentation Standards

### Core Philosophy

Use TypeScript types as the contract and comments to explain intent, architecture, and non-obvious reasoning.

### TSDoc Guidelines

- **No redundant types**: Do not repeat type info in `@param` or `@returns`; rely on signatures.
- **Responsibility-focused docs**:
    - Classes: what problem they solve.
    - Methods: what they do, why they exist, and any side effects.

### Required Tags

- `@throws`: List all exceptions callers must handle.
- `@remarks`: Architectural notes, design decisions, or constraints.
- `@internal`: Marks exports not intended for public API.
- `@example`: Minimal usage examples for complex utilities.

### Inline Commentary

- Use **single-line comments** (`//`) to convey _why_ a logic block exists, not to restate code.
- For complex algorithms or async flows, place a **block comment** (`/* ... */`) at the top summarizing the high-level strategy or state transitions.
