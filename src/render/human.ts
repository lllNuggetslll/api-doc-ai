import type { ApiDoc, Endpoint, Field } from "../schema.js";
import { groupByTag, prettyJson } from "./util.js";

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function anchor(e: Endpoint): string {
  return `${e.method}-${e.path}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fieldTable(fields: Field[]): string {
  if (fields.length === 0) return "_No documented fields._\n";
  const rows = fields.map(
    (f) => `| \`${esc(f.name)}\` | ${esc(f.type)} | ${f.required ? "Yes" : "No"} | ${esc(f.description)} |`,
  );
  return ["| Field | Type | Required | Description |", "|---|---|---|---|", ...rows].join("\n") + "\n";
}

function curlExample(e: Endpoint, baseUrl: string): string {
  let url = baseUrl + e.path.replace(/\{(\w+)\}/g, (_, name) => {
    const p = e.parameters.find((x) => x.in === "path" && x.name === name);
    return p?.example ?? `<${name}>`;
  });
  const query = e.parameters.filter((p) => p.in === "query" && p.required);
  if (query.length > 0) {
    url += "?" + query.map((p) => `${p.name}=${encodeURIComponent(p.example ?? `<${p.name}>`)}`).join("&");
  }

  const lines = [`curl -X ${e.method === "ALL" ? "GET" : e.method} "${url}"`];
  if (e.auth.required) {
    const scheme = (e.auth.scheme ?? "").toLowerCase();
    if (scheme.includes("bearer") || scheme.includes("jwt")) lines.push(`  -H "Authorization: Bearer <token>"`);
    else if (scheme.includes("key")) lines.push(`  -H "X-API-Key: <api-key>"`);
  }
  for (const h of e.parameters.filter((p) => p.in === "header" && p.required)) {
    lines.push(`  -H "${h.name}: ${h.example ?? `<${h.name}>`}"`);
  }
  if (e.requestBody) {
    lines.push(`  -H "Content-Type: ${e.requestBody.contentType}"`);
    if (e.requestBody.example) {
      const compact = (() => {
        try { return JSON.stringify(JSON.parse(e.requestBody.example)); } catch { return e.requestBody.example; }
      })();
      lines.push(`  -d '${compact.replace(/'/g, "'\\''")}'`);
    }
  }
  return "```bash\n" + lines.join(" \\\n") + "\n```\n";
}

function renderEndpoint(e: Endpoint, baseUrl: string): string {
  const out: string[] = [];
  out.push(`### <a id="${anchor(e)}"></a>${e.summary}\n`);
  out.push(`\`${e.method} ${e.path}\`\n`);
  out.push(`${e.description}\n`);

  const auth = e.auth.required
    ? `**Authentication:** Required${e.auth.scheme ? ` (${e.auth.scheme})` : ""}${e.auth.notes ? ` — ${e.auth.notes}` : ""}`
    : "**Authentication:** None";
  out.push(auth + "\n");

  if (e.parameters.length > 0) {
    out.push("#### Parameters\n");
    out.push("| Name | In | Type | Required | Description |");
    out.push("|---|---|---|---|---|");
    for (const p of e.parameters) {
      const ex = p.example ? ` Example: \`${esc(p.example)}\`` : "";
      out.push(`| \`${esc(p.name)}\` | ${p.in} | ${esc(p.type)} | ${p.required ? "Yes" : "No"} | ${esc(p.description)}${ex} |`);
    }
    out.push("");
  }

  if (e.requestBody) {
    out.push(`#### Request body (\`${e.requestBody.contentType}\`)\n`);
    out.push(fieldTable(e.requestBody.fields));
    if (e.requestBody.example) out.push("```json\n" + prettyJson(e.requestBody.example) + "\n```\n");
  }

  if (e.responses.length > 0) {
    out.push("#### Responses\n");
    for (const r of [...e.responses].sort((a, b) => a.status - b.status)) {
      out.push(`**${r.status}** — ${r.description}\n`);
      if (r.fields.length > 0) out.push(fieldTable(r.fields));
      if (r.example) out.push("```json\n" + prettyJson(r.example) + "\n```\n");
    }
  }

  if (e.sideEffects.length > 0) {
    out.push("#### Side effects\n");
    out.push(e.sideEffects.map((s) => `- ${s}`).join("\n") + "\n");
  }

  out.push("#### Example\n");
  out.push(curlExample(e, baseUrl));

  const notes = [...e.caveats];
  if (e.confidence !== "high") notes.unshift(`Extraction confidence: ${e.confidence}. Verify against the source.`);
  if (notes.length > 0) out.push(`> **Notes**\n${notes.map((n) => `> - ${n}`).join("\n")}\n`);

  out.push(`<sub>Source: \`${e.sourceFile}${e.sourceLine ? `:${e.sourceLine}` : ""}\`</sub>\n`);
  return out.join("\n");
}

export function renderHuman(doc: ApiDoc, baseUrl: string): string {
  const groups = groupByTag(doc.endpoints);
  const out: string[] = [];

  out.push(`# ${doc.title}\n`);
  out.push(`_Generated ${doc.generatedAt.slice(0, 10)} from source code by ${doc.model}. Review before publishing._\n`);

  if (doc.globalNotes.length > 0) {
    out.push("## Overview\n");
    out.push(doc.globalNotes.map((n) => `- ${n}`).join("\n") + "\n");
  }

  out.push("## Endpoints\n");
  for (const [tag, eps] of groups) {
    out.push(`**${tag}**\n`);
    out.push("| Method | Path | Summary |");
    out.push("|---|---|---|");
    for (const e of eps) out.push(`| \`${e.method}\` | [\`${esc(e.path)}\`](#${anchor(e)}) | ${esc(e.summary)} |`);
    out.push("");
  }

  for (const [tag, eps] of groups) {
    out.push(`## ${tag}\n`);
    for (const e of eps) out.push(renderEndpoint(e, baseUrl) + "\n---\n");
  }

  return out.join("\n");
}
