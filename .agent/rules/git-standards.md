---
trigger: always_on
description: When generating git commit messages, creating branches, or managing pull requests.
---

## Git Conventions

### Branching & PRs

- **Branches**: Short-lived. Format: `feature/<name>`, `fix/<name>`, `chore/<name>`.
- **Strategy**: Rebase onto `main` before merging. Avoid merge commits.
- **Safety**: Never commit `.env` content or secrets.

### Commit Messages

- **Format**: `<type>: concise action statement`
- **Types**: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`.
- **Style**:
    - Imperative mood ("add" not "added").
    - First line ≤ 72 chars.
    - No trailing periods.
- **Automation**: Husky will run lint/format on staged files automatically.

### When to Commit

- Commit when a logical unit is complete and tests pass.
- Do not commit debugging artifacts or commented-out code.
- Write messages explaining _intent_, not just action.
