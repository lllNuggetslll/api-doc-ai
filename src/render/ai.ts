import type { ApiDoc, Endpoint, Field } from "../schema.js";
import { compactJson, groupByTag, sortEndpoints } from "./util.js";

/*
 * AI-facing output, tuned for an LLM agent that has to call the API:
 *  - llms.txt: dense, uniformly structured plain text. No prose padding,
 *    one line per field, every endpoint self-contained so it can be
 *    retrieved as a chunk without losing context.
 *  - endpoints.json: the full structured data for tools and RAG indexes.
 */

function fieldLine(f: Field, indent = "  "): string {
  return `${indent}- ${f.name}${f.required ? "" : "?"}: ${f.type}${f.description ? ` — ${f.description}` : ""}`;
}

function renderEndpoint(e: Endpoint): string {
  const out: string[] = [];
  out.push(`## ${e.method} ${e.path}`);
  out.push(`id: ${e.operationId}`);
  out.push(`tag: ${e.tag}`);
  out.push(`does: ${e.summary}. ${e.description}`.trim());
  out.push(
    `auth: ${e.auth.required ? `required${e.auth.scheme ? ` (${e.auth.scheme})` : ""}${e.auth.notes ? `; ${e.auth.notes}` : ""}` : "none"}`,
  );

  for (const loc of ["path", "query", "header", "cookie"] as const) {
    const params = e.parameters.filter((p) => p.in === loc);
    if (params.length === 0) continue;
    out.push(`${loc}:`);
    for (const p of params) {
      out.push(`  - ${p.name}${p.required ? "" : "?"}: ${p.type}${p.description ? ` — ${p.description}` : ""}${p.example ? ` (e.g. ${p.example})` : ""}`);
    }
  }

  if (e.requestBody) {
    out.push(`body (${e.requestBody.contentType}):`);
    for (const f of e.requestBody.fields) out.push(fieldLine(f));
    if (e.requestBody.example) out.push(`body_example: ${compactJson(e.requestBody.example)}`);
  } else {
    out.push("body: none");
  }

  out.push("responses:");
  for (const r of [...e.responses].sort((a, b) => a.status - b.status)) {
    out.push(`  ${r.status}: ${r.description}`);
    for (const f of r.fields) out.push(fieldLine(f, "    "));
    if (r.example) out.push(`    example: ${compactJson(r.example)}`);
  }

  if (e.sideEffects.length > 0) out.push(`side_effects: ${e.sideEffects.join("; ")}`);
  if (e.caveats.length > 0 || e.confidence !== "high") {
    out.push(`confidence: ${e.confidence}${e.caveats.length ? `; ${e.caveats.join("; ")}` : ""}`);
  }
  out.push(`source: ${e.sourceFile}${e.sourceLine ? `:${e.sourceLine}` : ""}`);
  return out.join("\n");
}

export function renderLlmsTxt(doc: ApiDoc, baseUrl: string): string {
  const out: string[] = [];
  out.push(`# ${doc.title}`);
  out.push("");
  out.push(`> HTTP API reference for AI agents. ${doc.endpoints.length} endpoints. Base URL: ${baseUrl}. Field suffix "?" = optional. Paths use {param} placeholders.`);
  out.push("");

  if (doc.globalNotes.length > 0) {
    out.push("## Conventions");
    for (const n of doc.globalNotes) out.push(`- ${n}`);
    out.push("");
  }

  out.push("## Index");
  for (const [tag, eps] of groupByTag(doc.endpoints)) {
    out.push(`${tag}:`);
    for (const e of eps) out.push(`- ${e.method} ${e.path} — ${e.summary} [${e.operationId}]`);
  }
  out.push("");

  for (const e of sortEndpoints(doc.endpoints)) {
    out.push(renderEndpoint(e));
    out.push("");
  }
  return out.join("\n");
}

export function renderJson(doc: ApiDoc, baseUrl: string): string {
  return JSON.stringify({ ...doc, baseUrl, endpoints: sortEndpoints(doc.endpoints) }, null, 2) + "\n";
}
