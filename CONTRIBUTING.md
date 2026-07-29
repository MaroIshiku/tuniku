# Contributing

## Principles

- Keep source, interface copy, comments, commits, and documentation in English.
- Preserve the Pixel Soft Utility design system and six shared themes.
- Do not add undocumented Gluetun API routes.
- Do not add Docker write operations, a raw Docker socket, host Compose writes,
  shell execution, or foreign-application management.
- Keep secret values out of logs, tests, fixtures, drafts, and screenshots.

## Workflow

1. Create a focused branch.
2. Install dependencies with `npm install`.
3. Add tests for behavior and security boundaries.
4. Run `npm run check`.
5. Verify the Docker build.
6. Open a pull request explaining the behavior and safety impact.

Use documentation-reserved example addresses and placeholder credentials in
tests and docs.
