# api-to-docs

Point it at a backend codebase and it uses Claude to write API documentation in two forms:

| Output | Audience | What it is |
|---|---|---|
| `docs/human/API.md` | People | Overview, endpoint index, parameter/field tables, pretty JSON examples, and a `curl` command for every endpoint |
| `docs/ai/llms.txt` | LLM agents | Dense, uniformly structured text. One line per field, and each endpoint block is self-contained, so it can be chunked for RAG or pasted into a prompt |
| `docs/ai/endpoints.json` | Tools | Full structured data (the source of truth both docs are rendered from) |

## How it works

1. **Scan** walks the source tree and picks out route files (Express, Fastify, Koa, Hono, NestJS, Next.js route handlers, FastAPI, Flask, Django, Spring, Go, Rails, Laravel, ASP.NET), plus support files such as schemas, models, DTOs, validators and middleware.
2. **Extract** sends route files in batches, with support files included in every batch as shared context, to Claude (`claude-opus-5-5`). Structured outputs force each response to match a Zod schema. Claude resolves mount prefixes, auth middleware, validation rules and error branches. It also marks anything it inferred with a confidence level and caveats.
3. **Render** turns the merged JSON into the human and AI docs. No further API calls are needed for this step.

## Setup

```bash
npm install
```

Set your API key from [console.anthropic.com](https://console.anthropic.com):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

(PowerShell: `$env:ANTHROPIC_API_KEY = "sk-ant-..."`)

## Usage

```bash
# Preview which files will be sent (no API calls, no cost)
npm run dev -- ../my-backend --dry-run

# Generate docs
npm run dev -- ../my-backend -o ../my-backend/docs -t "My API" -b https://api.example.com

# Try it on the bundled sample Express app
npm run example

# Re-render after editing endpoints.json by hand (no API calls)
npm run dev -- --from-json docs/ai/endpoints.json -o docs
```

| Option | Default | |
|---|---|---|
| `-o, --out` | `./docs` | Output directory |
| `-t, --title` | `<folder> API` | Doc title |
| `-b, --base-url` | `http://localhost:3000` | Used in curl examples |
| `-m, --model` | `claude-opus-5-5` | Claude model ID |
| `-e, --effort` | `high` | `low` / `medium` / `high` / `xhigh` / `max`. Higher is more thorough and costs more |
| `--batch-chars` | `200000` | Max source characters per request. Lower it if a batch hits `max_tokens` |
| `--concurrency` | `3` | Parallel requests |
| `--dry-run` | | List files and batches only |

Build a standalone CLI with `npm run build`, then run `node dist/cli.js <dir>` or `npm link` and run `api-doc-ai <dir>`.

## Notes

- The system prompt is cached, so batches after the first are cheaper.
- Server-side refusal fallback (`fallbacks: "default"`) is enabled. If the model declines a batch, another model retries it automatically.
- Generated docs are a draft. Review endpoints marked `medium`/`low` confidence before publishing.

## Project layout

```
src/
  cli.ts          argument parsing, batching, concurrency, merge + dedupe
  scan.ts         file discovery and route detection heuristics
  extract.ts      Claude call (streaming + structured output)
  schema.ts       Zod schema for endpoints; the contract between extract and render
  render/human.ts Markdown reference for people
  render/ai.ts    llms.txt + endpoints.json for agents
examples/express-shop  sample API to test against
```
