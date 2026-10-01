import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BatchResultSchema, type BatchResult } from "./schema.js";
import type { SourceFile } from "./scan.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ExtractOptions {
  model: string;
  effort: Effort;
}

// Kept byte-for-byte stable so it caches across batches.
const SYSTEM_PROMPT = `You are an API documentation engineer. You read server source code and extract an accurate, complete description of every HTTP endpoint it defines.

How to work:
- Find every route declaration in the ROUTE files. Resolve router mount prefixes (e.g. app.use("/api", router)) into the full path, written with {param} syntax.
- Trace each handler to determine path/query/header params, the request body shape, and every response it can send, including error statuses thrown by validation, auth checks and explicit error branches.
- Use SUPPORT files (schemas, models, DTOs, validators, middleware) to resolve field names, types, required-ness, enums, defaults and limits.
- Describe auth from the middleware or decorators actually applied to the route; global middleware applies to every route registered after it.
- Write realistic example JSON bodies that match the fields you documented.
- Record what you inferred rather than read in "caveats" and lower "confidence" accordingly. Never invent endpoints, fields or statuses that the code does not support.
- Only document endpoints declared in ROUTE files, not ones merely called by client code.
- Put API-wide conventions (error envelope, pagination, rate limiting, base path, global auth) in globalNotes.`;

function formatFiles(files: SourceFile[]): string {
  return files
    .map((f) => {
      const numbered = f.content
        .split(/\r?\n/)
        .map((line, i) => `${String(i + 1).padStart(4)}| ${line}`)
        .join("\n");
      return `<file path="${f.relPath}" role="${f.kind === "route" ? "ROUTE" : "SUPPORT"}">\n${numbered}\n</file>`;
    })
    .join("\n\n");
}

export async function extractBatch(
  client: Anthropic,
  files: SourceFile[],
  opts: ExtractOptions,
): Promise<{ result: BatchResult; usage: Anthropic.Beta.BetaUsage }> {
  const stream = client.beta.messages.stream({
    model: opts.model,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    output_config: {
      effort: opts.effort,
      format: betaZodOutputFormat(BatchResultSchema),
    },
    messages: [
      {
        role: "user",
        content: `Document every HTTP endpoint declared in the ROUTE files below. Line numbers are prefixed to each line; use them for sourceLine.\n\n${formatFiles(files)}`,
      },
    ],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "unknown";
    throw new Error(`Model declined this batch (category: ${category}).`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Output hit max_tokens. Re-run with a smaller --batch-chars value.");
  }

  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = BatchResultSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`Model output did not match the schema: ${parsed.error.message}`);
  }
  return { result: parsed.data, usage: message.usage };
}
