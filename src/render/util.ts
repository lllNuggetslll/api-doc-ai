import type { Endpoint } from "../schema.js";

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"];

export function sortEndpoints(endpoints: Endpoint[]): Endpoint[] {
  return [...endpoints].sort(
    (a, b) =>
      a.tag.localeCompare(b.tag) ||
      a.path.localeCompare(b.path) ||
      METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method),
  );
}

export function groupByTag(endpoints: Endpoint[]): Map<string, Endpoint[]> {
  const groups = new Map<string, Endpoint[]>();
  for (const e of sortEndpoints(endpoints)) {
    const list = groups.get(e.tag) ?? [];
    list.push(e);
    groups.set(e.tag, list);
  }
  return groups;
}

export function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function compactJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s));
  } catch {
    return s.replace(/\s*\n\s*/g, " ");
  }
}
