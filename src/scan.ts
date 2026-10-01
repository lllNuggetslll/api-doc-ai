import fs from "node:fs/promises";
import path from "node:path";

export interface SourceFile {
  relPath: string;
  content: string;
  kind: "route" | "support";
}

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".go", ".java", ".kt", ".rb", ".php", ".cs",
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "coverage",
  "venv", ".venv", "env", "__pycache__", "vendor", "target", "bin", "obj", ".turbo",
]);

const IGNORED_FILE = /(\.test\.|\.spec\.|\.d\.ts$|\.min\.js$|_test\.go$)/;

// Patterns that suggest a file declares HTTP routes, across common frameworks.
const ROUTE_PATTERNS: RegExp[] = [
  /\b\w*(app|router|server|api|routes?)\s*\.\s*(get|post|put|patch|delete|all|route|use)\s*\(/i, // Express, Koa, Fastify, Hono (incl. usersRouter)
  /\bfastify\s*\.\s*(get|post|put|patch|delete|route)\s*\(/i,
  /@(app|router|bp|blueprint|api)\s*\.\s*(get|post|put|patch|delete|route|api_route)\s*\(/i, // FastAPI, Flask
  /@(Get|Post|Put|Patch|Delete|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\b/, // NestJS, Spring
  /\bexport\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/, // Next.js route handlers
  /\b(urlpatterns|path\(|re_path\()/, // Django
  /\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE)\s*\(\s*"/, // Go net/http, gin, echo
  /\b(get|post|put|patch|delete)\s+['"]\//, // Rails routes, Sinatra
  /Route::(get|post|put|patch|delete)/, // Laravel
  /\[(Http(Get|Post|Put|Patch|Delete)|Route)\b/, // ASP.NET
];

// Files that often hold request/response shapes the routes refer to.
const SUPPORT_PATH = /(schema|model|dto|type|validator|validation|serializer|entity|interface|middleware|auth)/i;

export function isRouteFile(content: string): boolean {
  return ROUTE_PATTERNS.some((re) => re.test(content));
}

export async function scanSource(root: string, maxFileBytes = 200_000): Promise<SourceFile[]> {
  const files: SourceFile[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) await walk(full);
        continue;
      }
      if (!CODE_EXTENSIONS.has(path.extname(entry.name)) || IGNORED_FILE.test(entry.name)) continue;
      const stat = await fs.stat(full);
      if (stat.size > maxFileBytes) continue;

      const content = await fs.readFile(full, "utf8");
      const relPath = path.relative(root, full).split(path.sep).join("/");
      if (isRouteFile(content)) files.push({ relPath, content, kind: "route" });
      else if (SUPPORT_PATH.test(relPath)) files.push({ relPath, content, kind: "support" });
    }
  }

  await walk(root);
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * Groups files into batches under a character budget. Every batch gets all
 * route files it can hold; support files are shared context appended to
 * every batch (truncated to the budget) so shapes can be resolved.
 */
export function makeBatches(files: SourceFile[], maxChars: number): SourceFile[][] {
  const routes = files.filter((f) => f.kind === "route");
  const support = files.filter((f) => f.kind === "support");

  const supportBudget = Math.floor(maxChars * 0.35);
  const sharedSupport: SourceFile[] = [];
  let used = 0;
  for (const f of support) {
    if (used + f.content.length > supportBudget) continue;
    sharedSupport.push(f);
    used += f.content.length;
  }

  const routeBudget = maxChars - used;
  const batches: SourceFile[][] = [];
  let current: SourceFile[] = [];
  let size = 0;
  for (const f of routes) {
    if (current.length > 0 && size + f.content.length > routeBudget) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(f);
    size += f.content.length;
  }
  if (current.length > 0) batches.push(current);

  return batches.map((b) => [...b, ...sharedSupport]);
}
