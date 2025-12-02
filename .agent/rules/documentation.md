---
trigger: always_on
globs: **/*.ts
---

## Documentation Standards

### Core Philosophy

Use TypeScript types as the strict contract. Use comments to explain intent, architecture, and "why".

### TSDoc Requirements

- **No Redundancy**: Do not repeat type info in `@param` or `@returns`.
- **Classes**: Explain what problem they solve.
- **Methods**: Explain what they do and side effects.
- **Required Tags**:
    - `@throws`: List all exceptions.
    - `@remarks`: Architectural notes/constraints.
    - `@internal`: For non-public exports.
    - `@example`: For complex utilities.

### Inline Comments

- Use `//` single-line comments to explain _why_ a logic block exists.
- Use `/* ... */` block comments for complex algorithms or async flow summaries.
