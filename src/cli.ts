#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { scanSource, makeBatches } from "./scan.js";
import { extractBatch, type Effort } from "./extract.js";
import { renderHuman } from "./render/human.js";
import { renderJson, renderLlmsTxt } from "./render/ai.js";
import type { ApiDoc, Endpoint } from "./schema.js";

const HELP = `api-doc-ai — generate API documentation from source code with Claude

Usage:
  api-doc-ai <source-dir> [options]
  api-doc-ai --from-json <docs/ai/endpoints.json> [options]   re-render without calling the API

Options:
  -o, --out <dir>          Output directory (default: ./docs)
  -t, --title <title>      API title (default: "<folder name> API")
  -b, --base-url <url>     Base URL used in examples (default: http://localhost:3000)
  -m, --model <id>         Claude model (default: claude-opus-5-5)
  -e, --effort <level>     low | medium | high | xhigh | max (default: high)
      --batch-chars <n>    Max source characters per request (default: 200000)
      --concurrency <n>    Parallel requests (default: 3)
      --dry-run            List detected files and batches, make no API calls
  -h, --help               Show this help

Outputs:
  <out>/human/API.md        Human-readable reference with tables and curl examples
  <out>/ai/llms.txt         Dense, uniformly structured reference for LLM agents
  <out>/ai/endpoints.json   Full structured data for tools and RAG indexes
`;

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

// The same route can show up in two batches when support files overlap; keep the more confident one.
function dedupe(endpoints: Endpoint[]): Endpoint[] {
  const byKey = new Map<string, Endpoint>();
  for (const e of endpoints) {
    const key = `${e.method} ${e.path}`;
    const existing = byKey.get(key);
    if (!existing || CONFIDENCE_RANK[e.confidence] > CONFIDENCE_RANK[existing.confidence]) byKey.set(key, e);
  }
  return [...byKey.values()];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function writeOutputs(doc: ApiDoc, outDir: string, baseUrl: string): Promise<void> {
  await fs.mkdir(path.join(outDir, "human"), { recursive: true });
  await fs.mkdir(path.join(outDir, "ai"), { recursive: true });
  await fs.writeFile(path.join(outDir, "human", "API.md"), renderHuman(doc, baseUrl));
  await fs.writeFile(path.join(outDir, "ai", "llms.txt"), renderLlmsTxt(doc, baseUrl));
  await fs.writeFile(path.join(outDir, "ai", "endpoints.json"), renderJson(doc, baseUrl));
  console.log(`\nWrote ${doc.endpoints.length} endpoints to:`);
  console.log(`  ${path.join(outDir, "human", "API.md")}`);
  console.log(`  ${path.join(outDir, "ai", "llms.txt")}`);
  console.log(`  ${path.join(outDir, "ai", "endpoints.json")}`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o", default: "docs" },
      title: { type: "string", short: "t" },
      "base-url": { type: "string", short: "b", default: "http://localhost:3000" },
      model: { type: "string", short: "m", default: "claude-opus-5-5" },
      effort: { type: "string", short: "e", default: "high" },
      "batch-chars": { type: "string", default: "200000" },
      concurrency: { type: "string", default: "3" },
      "dry-run": { type: "boolean", default: false },
      "from-json": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const outDir = path.resolve(values.out!);
  const baseUrl = values["base-url"]!.replace(/\/$/, "");

  if (values.help || (positionals.length === 0 && !values["from-json"])) {
    console.log(HELP);
    return;
  }

  if (values["from-json"]) {
    const doc = JSON.parse(await fs.readFile(values["from-json"], "utf8")) as ApiDoc;
    if (values.title) doc.title = values.title;
    await writeOutputs(doc, outDir, baseUrl);
    return;
  }

  const efforts: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  if (!efforts.includes(values.effort as Effort)) throw new Error(`--effort must be one of ${efforts.join(", ")}`);

  const sourceRoot = path.resolve(positionals[0]);
  const files = await scanSource(sourceRoot);
  const routeFiles = files.filter((f) => f.kind === "route");
  if (routeFiles.length === 0) {
    console.error(`No route files detected under ${sourceRoot}.`);
    process.exit(1);
  }

  const batches = makeBatches(files, Number(values["batch-chars"]));
  console.log(`Found ${routeFiles.length} route file(s) and ${files.length - routeFiles.length} support file(s) in ${batches.length} batch(es).`);
  batches.forEach((b, i) => {
    const chars = b.reduce((n, f) => n + f.content.length, 0);
    console.log(`  batch ${i + 1}: ${b.filter((f) => f.kind === "route").map((f) => f.relPath).join(", ")} (~${Math.round(chars / 4).toLocaleString()} tokens)`);
  });
  if (values["dry-run"]) return;

  const client = new Anthropic();
  let inputTokens = 0;
  let outputTokens = 0;
  let failures = 0;

  const results = await mapLimit(batches, Number(values.concurrency), async (batch, i) => {
    const label = `batch ${i + 1}/${batches.length}`;
    console.log(`→ ${label}: extracting...`);
    try {
      const { result, usage } = await extractBatch(client, batch, { model: values.model!, effort: values.effort as Effort });
      inputTokens += usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      outputTokens += usage.output_tokens;
      console.log(`✓ ${label}: ${result.endpoints.length} endpoint(s)`);
      return result;
    } catch (err) {
      failures++;
      if (err instanceof Anthropic.AuthenticationError) {
        console.error(`✗ ${label}: authentication failed. Set ANTHROPIC_API_KEY or run \`ant auth login\`.`);
      } else if (err instanceof Anthropic.RateLimitError) {
        console.error(`✗ ${label}: rate limited even after retries. Try --concurrency 1.`);
      } else if (err instanceof Anthropic.APIError) {
        console.error(`✗ ${label}: API error ${err.status}: ${err.message}`);
      } else {
        console.error(`✗ ${label}: ${(err as Error).message}`);
      }
      return null;
    }
  });

  const ok = results.filter((r) => r !== null);
  if (ok.length === 0) {
    console.error("\nNo batches succeeded; nothing written.");
    process.exit(1);
  }

  const doc: ApiDoc = {
    title: values.title ?? `${path.basename(sourceRoot)} API`,
    generatedAt: new Date().toISOString(),
    sourceRoot: path.basename(sourceRoot),
    model: values.model!,
    globalNotes: [...new Set(ok.flatMap((r) => r.globalNotes))],
    endpoints: dedupe(ok.flatMap((r) => r.endpoints)),
  };

  await writeOutputs(doc, outDir, baseUrl);
  console.log(`\nTokens: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out`);
  if (failures > 0) {
    console.warn(`Warning: ${failures} batch(es) failed; their endpoints are missing from the output.`);
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
