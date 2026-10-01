import { z } from "zod";

// Shape Claude must return for each batch of source files. Every field is
// required (nullable where unknown) so structured outputs can enforce it.

export const FieldSchema = z.object({
  name: z.string().describe("Field name. Use dot notation for nesting, e.g. user.address.city; use [] for arrays, e.g. items[].id"),
  type: z.string().describe("Type, e.g. string, integer, boolean, string (uuid), string (ISO 8601 date), enum: a | b, object, array<string>"),
  required: z.boolean(),
  description: z.string().describe("What the field means, including defaults, limits and validation rules found in code"),
});

export const ParamSchema = z.object({
  name: z.string(),
  in: z.enum(["path", "query", "header", "cookie"]),
  type: z.string(),
  required: z.boolean(),
  description: z.string(),
  example: z.string().nullable(),
});

export const ResponseSchema = z.object({
  status: z.number().int().describe("HTTP status code"),
  description: z.string().describe("When this response is returned"),
  contentType: z.string().nullable(),
  fields: z.array(FieldSchema),
  example: z.string().nullable().describe("Example body as a JSON string, or null"),
});

export const EndpointSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"]),
  path: z.string().describe("Full path including router mount prefixes, using {param} syntax, e.g. /api/users/{id}"),
  operationId: z.string().describe("camelCase identifier, e.g. getUserById"),
  tag: z.string().describe("Resource group, e.g. Users"),
  summary: z.string().describe("One line, imperative, e.g. Get a user by ID"),
  description: z.string().describe("What the endpoint does, side effects, and notable behavior"),
  auth: z.object({
    required: z.boolean(),
    scheme: z.string().nullable().describe("e.g. Bearer JWT, API key header X-API-Key, session cookie"),
    notes: z.string().nullable().describe("Roles, scopes or ownership checks"),
  }),
  parameters: z.array(ParamSchema),
  requestBody: z
    .object({
      contentType: z.string(),
      fields: z.array(FieldSchema),
      example: z.string().nullable().describe("Example body as a JSON string"),
    })
    .nullable(),
  responses: z.array(ResponseSchema),
  sideEffects: z.array(z.string()).describe("e.g. sends email, writes to orders table, emits event"),
  sourceFile: z.string(),
  sourceLine: z.number().int().nullable(),
  confidence: z.enum(["high", "medium", "low"]).describe("How certain the extraction is from the code shown"),
  caveats: z.array(z.string()).describe("Anything inferred rather than read directly from code"),
});

export const BatchResultSchema = z.object({
  endpoints: z.array(EndpointSchema),
  globalNotes: z
    .array(z.string())
    .describe("API-wide facts seen in this batch: base path, global auth middleware, error format, rate limits, pagination conventions"),
});

export type Field = z.infer<typeof FieldSchema>;
export type Param = z.infer<typeof ParamSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type BatchResult = z.infer<typeof BatchResultSchema>;

export interface ApiDoc {
  title: string;
  generatedAt: string;
  sourceRoot: string;
  model: string;
  globalNotes: string[];
  endpoints: Endpoint[];
}
