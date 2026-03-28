// Notion Query MCP server. Exposes structured query tools over the Notion API.
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  NOTION_API_KEY: string;
  MCP_OBJECT: DurableObjectNamespace;
  MCP_LIMITER: RateLimit;
}


interface NotionListResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionPage {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, NotionProperty>;
}

interface NotionProperty {
  type: string;
  [key: string]: unknown;
}

interface NotionDatabase {
  id: string;
  title?: Array<{ plain_text: string }>;
  properties: Record<string, NotionProperty>;
}

interface NotionSearchResponse {
  results: NotionDatabase[];
}

async function notionFetch(
  env: Env,
  endpoint: string,
  method: string = "GET",
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Notion API ${res.status}: ${errorText}`);

    // Don't forward raw Notion error details to clients
    let code = "unknown";
    try {
      const parsed = JSON.parse(errorText) as { code?: string };
      code = parsed.code ?? "unknown";
    } catch {
      // raw text error, code stays "unknown"
    }

    throw new Error(`Notion API error (${res.status}/${code})`);
  }

  return res.json();
}

// Notion IDs are UUIDs, optionally without dashes
const notionId = z.string().regex(
  /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i,
  "Must be a valid Notion ID (UUID format)",
);

const textCondition = z.object({
  equals: z.string().optional(),
  does_not_equal: z.string().optional(),
  contains: z.string().optional(),
  does_not_contain: z.string().optional(),
  starts_with: z.string().optional(),
  ends_with: z.string().optional(),
  is_empty: z.literal(true).optional(),
  is_not_empty: z.literal(true).optional(),
}).strict();

const numberCondition = z.object({
  equals: z.number().optional(),
  does_not_equal: z.number().optional(),
  greater_than: z.number().optional(),
  less_than: z.number().optional(),
  greater_than_or_equal_to: z.number().optional(),
  less_than_or_equal_to: z.number().optional(),
  is_empty: z.literal(true).optional(),
  is_not_empty: z.literal(true).optional(),
}).strict();

const checkboxCondition = z.object({
  equals: z.boolean().optional(),
  does_not_equal: z.boolean().optional(),
}).strict();

const selectCondition = z.object({
  equals: z.string().optional(),
  does_not_equal: z.string().optional(),
  is_empty: z.literal(true).optional(),
  is_not_empty: z.literal(true).optional(),
}).strict();

const multiSelectCondition = z.object({
  contains: z.string().optional(),
  does_not_contain: z.string().optional(),
  is_empty: z.literal(true).optional(),
  is_not_empty: z.literal(true).optional(),
}).strict();

const dateCondition = z.object({
  equals: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  on_or_before: z.string().optional(),
  on_or_after: z.string().optional(),
  past_week: z.object({}).optional(),
  past_month: z.object({}).optional(),
  past_year: z.object({}).optional(),
  next_week: z.object({}).optional(),
  next_month: z.object({}).optional(),
  next_year: z.object({}).optional(),
  is_empty: z.literal(true).optional(),
  is_not_empty: z.literal(true).optional(),
}).strict();

const relationCondition = z.object({
  contains: z.string().optional(),
  does_not_contain: z.string().optional(),
  is_empty: z.literal(true).optional(),
  is_not_empty: z.literal(true).optional(),
}).strict();

const formulaCondition = z.object({
  string: textCondition.optional(),
  checkbox: checkboxCondition.optional(),
  number: numberCondition.optional(),
  date: dateCondition.optional(),
}).strict();

// Explicit types needed — z.lazy circular inference can't infer these
interface PropertyFilterShape {
  property: string;
  rich_text?: z.infer<typeof textCondition>;
  title?: z.infer<typeof textCondition>;
  url?: z.infer<typeof textCondition>;
  email?: z.infer<typeof textCondition>;
  phone_number?: z.infer<typeof textCondition>;
  number?: z.infer<typeof numberCondition>;
  checkbox?: z.infer<typeof checkboxCondition>;
  select?: z.infer<typeof selectCondition>;
  multi_select?: z.infer<typeof multiSelectCondition>;
  status?: z.infer<typeof selectCondition>;
  date?: z.infer<typeof dateCondition>;
  created_time?: z.infer<typeof dateCondition>;
  last_edited_time?: z.infer<typeof dateCondition>;
  people?: z.infer<typeof relationCondition>;
  created_by?: z.infer<typeof relationCondition>;
  last_edited_by?: z.infer<typeof relationCondition>;
  files?: { is_empty?: true; is_not_empty?: true };
  relation?: z.infer<typeof relationCondition>;
  formula?: z.infer<typeof formulaCondition>;
  rollup?: RollupConditionShape;
}

interface RollupConditionShape {
  any?: PropertyFilterShape;
  none?: PropertyFilterShape;
  every?: PropertyFilterShape;
  date?: z.infer<typeof dateCondition>;
  number?: z.infer<typeof numberCondition>;
}

const rollupCondition: z.ZodType<RollupConditionShape> = z.lazy(() =>
  z.object({
    any: propertyFilter.optional(),
    none: propertyFilter.optional(),
    every: propertyFilter.optional(),
    date: dateCondition.optional(),
    number: numberCondition.optional(),
  }).strict(),
);

const propertyFilter: z.ZodType<PropertyFilterShape> = z.lazy(() =>
  z.object({
    property: z.string(),
    rich_text: textCondition.optional(),
    title: textCondition.optional(),
    url: textCondition.optional(),
    email: textCondition.optional(),
    phone_number: textCondition.optional(),
    number: numberCondition.optional(),
    checkbox: checkboxCondition.optional(),
    select: selectCondition.optional(),
    multi_select: multiSelectCondition.optional(),
    status: selectCondition.optional(),
    date: dateCondition.optional(),
    created_time: dateCondition.optional(),
    last_edited_time: dateCondition.optional(),
    people: relationCondition.optional(),
    created_by: relationCondition.optional(),
    last_edited_by: relationCondition.optional(),
    files: z.object({ is_empty: z.literal(true).optional(), is_not_empty: z.literal(true).optional() }).strict().optional(),
    relation: relationCondition.optional(),
    formula: formulaCondition.optional(),
    rollup: rollupCondition.optional(),
  }),
);

type NotionFilter =
  | PropertyFilterShape
  | { and: NotionFilter[] }
  | { or: NotionFilter[] };

const notionFilter: z.ZodType<NotionFilter> = z.lazy(() =>
  z.union([
    propertyFilter,
    z.object({ and: z.array(notionFilter) }).strict(),
    z.object({ or: z.array(notionFilter) }).strict(),
  ]),
);

// Columnar format — columns listed once, rows are value arrays. Saves tokens.
interface CompactResult {
  columns: string[];
  rows: unknown[][];
  has_more: boolean;
  next_cursor: string | null;
  total_results: number;
}

interface FlatPage {
  id: string;
  url: string;
  properties: Record<string, unknown>;
}

function formatCompact(
  results: FlatPage[],
  hasMore: boolean,
  nextCursor: string | null,
): CompactResult {
  const propKeys = new Set<string>();
  for (const r of results) {
    for (const key of Object.keys(r.properties)) {
      propKeys.add(key);
    }
  }

  const columns = ["id", "url", ...propKeys];
  const rows = results.map((r) =>
    columns.map((col) => {
      if (col === "id") return r.id;
      if (col === "url") return r.url;
      return r.properties[col] ?? null;
    }),
  );

  return {
    columns,
    rows,
    has_more: hasMore,
    next_cursor: nextCursor,
    total_results: results.length,
  };
}

function flattenProperties(
  properties: Record<string, NotionProperty>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(properties)) {
    flat[name] = flattenSingleProperty(prop);
  }
  return flat;
}

function flattenSingleProperty(prop: NotionProperty): unknown {
  switch (prop.type) {
    case "title":
      return (prop.title as Array<{ plain_text: string }> | undefined)
        ?.map((t) => t.plain_text).join("") ?? "";
    case "rich_text":
      return (prop.rich_text as Array<{ plain_text: string }> | undefined)
        ?.map((t) => t.plain_text).join("") ?? "";
    case "number":
      return prop.number as number | null;
    case "select":
      return (prop.select as { name: string } | null)?.name ?? null;
    case "multi_select":
      return (prop.multi_select as Array<{ name: string }> | undefined)
        ?.map((s) => s.name) ?? [];
    case "status":
      return (prop.status as { name: string } | null)?.name ?? null;
    case "date": {
      const d = prop.date as { start: string; end: string | null } | null;
      return d ? { start: d.start, end: d.end } : null;
    }
    case "checkbox":
      return prop.checkbox as boolean;
    case "url":
      return prop.url as string | null;
    case "email":
      return prop.email as string | null;
    case "phone_number":
      return prop.phone_number as string | null;
    case "formula": {
      const formula = prop.formula as { type: string; [k: string]: unknown } | undefined;
      return formula ? formula[formula.type] : null;
    }
    case "relation":
      return (prop.relation as Array<{ id: string }> | undefined)
        ?.map((r) => r.id) ?? [];
    case "rollup": {
      const rollup = prop.rollup as { type: string; [k: string]: unknown } | undefined;
      return rollup ? rollup[rollup.type] : null;
    }
    case "people":
      return (prop.people as Array<{ name?: string; id: string }> | undefined)
        ?.map((p) => p.name ?? p.id) ?? [];
    case "files":
      return (prop.files as Array<{
        name?: string;
        external?: { url: string };
        file?: { url: string };
      }> | undefined)
        ?.map((f) => f.name ?? f.external?.url ?? f.file?.url) ?? [];
    case "created_time":
      return prop.created_time as string;
    case "last_edited_time":
      return prop.last_edited_time as string;
    case "created_by":
      return (prop.created_by as { name?: string; id: string } | undefined)?.name
        ?? (prop.created_by as { id: string } | undefined)?.id;
    case "last_edited_by":
      return (prop.last_edited_by as { name?: string; id: string } | undefined)?.name
        ?? (prop.last_edited_by as { id: string } | undefined)?.id;
    case "unique_id": {
      const uid = prop.unique_id as { prefix?: string; number: number } | null;
      return uid ? `${uid.prefix ?? ""}${uid.number}` : null;
    }
    default:
      return (prop[prop.type] as unknown) ?? null;
  }
}

export class NotionQueryMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "notion-query",
    version: "1.0.0",
  });

  async init() {
    this.server.tool(
      "query_database",
      "Query a Notion database with structured filters, sorting, and pagination. Equivalent to SQL SELECT with WHERE, ORDER BY, and LIMIT/OFFSET.",
      {
        database_id: notionId
          .describe("Notion database ID (UUID, with or without dashes)"),
        filter: notionFilter
          .optional()
          .describe(
            "Notion API filter object. Supports 'and'/'or' compound filters and property-level filters. Example: {\"property\": \"Status\", \"status\": {\"equals\": \"Not started\"}}",
          ),
        sorts: z
          .array(
            z.object({
              property: z.string(),
              direction: z.enum(["ascending", "descending"]),
            }),
          )
          .optional()
          .describe(
            'Array of sort objects. E.g. [{"property": "Date", "direction": "ascending"}]',
          ),
        page_size: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of results per page (1-100, default 100)"),
        start_cursor: z
          .string()
          .optional()
          .describe(
            "Cursor for pagination. Use next_cursor from previous response.",
          ),
        format: z
          .enum(["compact", "full"])
          .default("compact")
          .describe(
            '"compact" returns columns + rows (token-efficient). "full" returns array of objects.',
          ),
      },
      async ({
        database_id,
        filter,
        sorts,
        page_size,
        start_cursor,
        format,
      }) => {
        try {
          const requestBody: Record<string, unknown> = {};
          if (filter) requestBody.filter = filter;
          if (sorts) requestBody.sorts = sorts;
          requestBody.page_size = page_size ?? 100;
          if (start_cursor) requestBody.start_cursor = start_cursor;

          const data = await notionFetch(
            this.env,
            `/databases/${database_id}/query`,
            "POST",
            requestBody,
          ) as NotionListResponse;

          const results: FlatPage[] = data.results.map((page) => ({
            id: page.id,
            url: page.url,
            properties: flattenProperties(page.properties),
          }));

          const output =
            format === "compact"
              ? formatCompact(results, data.has_more, data.next_cursor)
              : {
                  results: results.map((r) => ({
                    id: r.id,
                    url: r.url,
                    ...r.properties,
                  })),
                  has_more: data.has_more,
                  next_cursor: data.next_cursor,
                  total_results: results.length,
                };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(output, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error querying database: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      "get_page",
      "Fetch a single Notion page with all its properties, flattened for easy reading.",
      {
        page_id: notionId.describe("Notion page ID (UUID)"),
      },
      async ({ page_id }) => {
        try {
          const data = await notionFetch(
            this.env,
            `/pages/${page_id}`,
            "GET",
          ) as NotionPage;

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    id: data.id,
                    url: data.url,
                    created_time: data.created_time,
                    last_edited_time: data.last_edited_time,
                    properties: flattenProperties(data.properties),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error fetching page: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      "update_page",
      "Update properties on a Notion page. Use to change status, dates, text, etc.",
      {
        page_id: notionId.describe("Notion page ID (UUID)"),
        properties: z
          .record(z.string(), z.unknown())
          // Notion pages rarely have >50 props; cap to prevent abuse
          .refine(
            (obj) => Object.keys(obj).length <= 50,
            { message: "Cannot update more than 50 properties at once" },
          )
          .describe(
            'Properties to update in Notion API format. Example: {"Status": {"status": {"name": "Done"}}}',
          ),
      },
      async ({ page_id, properties }) => {
        try {
          const data = await notionFetch(
            this.env,
            `/pages/${page_id}`,
            "PATCH",
            { properties },
          ) as NotionPage;

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    id: data.id,
                    url: data.url,
                    last_edited_time: data.last_edited_time,
                    properties: flattenProperties(data.properties),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error updating page: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      "list_databases",
      "List all Notion databases the integration can access, with their schemas (property names, types, and options).",
      {
        query: z
          .string()
          .optional()
          .describe("Optional search query to filter databases by title"),
      },
      async ({ query }) => {
        try {
          const data = await notionFetch(this.env, "/search", "POST", {
            filter: { value: "database", property: "object" },
            query: query ?? "",
          }) as NotionSearchResponse;

          const databases = data.results.map((db) => {
            const title =
              db.title?.map((t) => t.plain_text).join("") || "Untitled";

            const schema: Record<string, unknown> = {};
            for (const [propName, prop] of Object.entries(db.properties)) {
              const entry: Record<string, unknown> = { type: prop.type };

              // Surface options so the LLM knows valid filter values
              if (prop.type === "select") {
                const sel = prop.select as { options?: Array<{ name: string }> } | undefined;
                if (sel?.options) entry.options = sel.options.map((o) => o.name);
              }
              if (prop.type === "multi_select") {
                const ms = prop.multi_select as { options?: Array<{ name: string }> } | undefined;
                if (ms?.options) entry.options = ms.options.map((o) => o.name);
              }
              if (prop.type === "status") {
                const st = prop.status as {
                  options?: Array<{ name: string }>;
                  groups?: Array<{ name: string; option_ids: string[] }>;
                } | undefined;
                if (st?.options) entry.options = st.options.map((o) => o.name);
                if (st?.groups) {
                  entry.groups = st.groups.map((g) => ({
                    name: g.name,
                    option_ids: g.option_ids,
                  }));
                }
              }
              schema[propName] = entry;
            }

            return { id: db.id, title, schema };
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(databases, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error listing databases: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
}

const sseHandler = NotionQueryMCP.mount("/sse");
const httpHandler = NotionQueryMCP.serve("/mcp");

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "global";
    const { success } = await env.MCP_LIMITER.limit({ key: ip });
    if (!success) {
      return new Response("Rate limit exceeded", { status: 429 });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith("/mcp")) {
      return httpHandler.fetch(request, env, ctx);
    }
    return sseHandler.fetch(request, env, ctx);
  },
};
