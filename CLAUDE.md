# Clanki

An MCP (Model Context Protocol) server that integrates with Anki via AnkiConnect for flashcard creation, updating, and searching.

## After editing code
Always run `npm run check && npm run build && npm test` after completing edits to verify formatting/linting, compilation, and tests pass.

## Project structure
- `src/index.ts` — Main MCP server. Contains all tool definitions, handlers, validation logic, and Gemini API integration.
- `src/search-validation.test.ts` — Tests for search query validation and preparation (vitest).
- `biome.json` — Biome formatter/linter config (2-space indent, double quotes, 120 char line width).
- `.gemini-api-key` — Gemini API key file (gitignored). Read at startup by the server.

## Key concepts

### Card types
Four note types are supported: Basic (`1 Basic`), Cloze (`2 Cloze`), Programming (`7 Programming Language Function`), and Interview (`8 Interview Question`). Each has create and update tools. Cloze tools are defined but disabled in the tool listing.

### Gemini validation (basic cards only)
Before creating a basic card, the front/back/extra fields are sent to **Gemini 3 Flash Preview** for rule validation. If validation fails, the card is auto-fixed by **Gemini 3.1 Pro Preview** before creation. The validation rules are defined in the `RULES` and `EXTRA_RULES` constants. The auto-corrected response includes the details of what was wrong.

### Search behavior
- Search queries are validated by `validateSearchQuery()` — bare multi-word terms require AND/OR operators or quotes.
- Bare single-word search terms get a `w:` (whole-word) prefix via `prepareSearchQuery()` to avoid substring matches (e.g., "WAL" won't match "wallet").
- Results are sorted newest-first (descending note ID) and paginated via `SEARCH_PAGE_SIZE` (currently 100) with an `offset` parameter.

### AnkiConnect error handling
AnkiConnect application-level errors (e.g., "duplicate") are not retried and are returned as tool content with `isError: true` so the LLM can see and act on them. Only network/connection errors are retried (up to 3 times with exponential backoff).

### MCP resources
A single resource `anki://basic-card-creation-guidelines` serves the card creation rules. The rules are also embedded directly in the `create-basic-card` tool description for visibility.

## Testing
Tests use vitest. Run with `npm test`. Test file covers `validateSearchQuery` and `prepareSearchQuery` with 29 test cases.
