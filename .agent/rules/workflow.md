---
trigger: always_on
description: When running terminal commands, building the project, or debugging errors.
---

## Development Workflow & Commands

### Core Commands

- **Build**: `yarn build` (Uses `tsup` to compile to `dist/`). Always run to verify build output.
- **Typecheck**: `yarn typecheck` (Uses `tsc --noEmit`). Run to ensure type safety.
- **Dev Server**: `yarn dev` (Uses `tsx` to watch `src/index.ts`).
- **Start Prod**: `yarn start` (Runs `dist/index.js`).
- **Lint/Format**: `yarn lint` / `yarn format`.

### Verification Workflow

1.  **Dev**: Use `yarn dev` for the feedback loop.
2.  **Verify**: Before finishing a task, you MUST run:
    - `yarn typecheck` (to catch errors `tsx` ignores).
    - `yarn build` (to ensure `tsup` compatibility).
    - `yarn lint` (to ensure style compliance).
