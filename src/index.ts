import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  NOTION_API_KEY: string;
  MCP_OBJECT: DurableObjectNamespace;
}

async function notionFetch(
  env: Env,
  endpoint: string,
  method: string = "GET",
  body?: unknown,
): Promise<any> {
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
    throw new Error(`Notion API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

// Flatten Notion's deeply nested property objects into simple key-value pairs
function flattenProperties(
  properties: Record<string, any>,
): Record<string, any> {
  const flat: Record<string, any> = {};
  for (const [name, prop] of Object.entries(properties)) {
    switch (prop.type) {
      case "title":
        flat[name] =
          prop.title?.map((t: { plain_text: string }) => t.plain_text).join("") || "";
        break;
      case "rich_text":
        flat[name] =
          prop.rich_text?.map((t: { plain_text: string }) => t.plain_text).join("") || "";
        break;
      case "number":
        flat[name] = prop.number;
        break;
      case "select":
        flat[name] = prop.select?.name || null;
        break;
      case "multi_select":
        flat[name] = prop.multi_select?.map((s: { name: string }) => s.name) || [];
        break;
      case "status":
        flat[name] = prop.status?.name || null;
        break;
      case "date":
        flat[name] = prop.date
          ? { start: prop.date.start, end: prop.date.end }
          : null;
        break;
      case "checkbox":
        flat[name] = prop.checkbox;
        break;
      case "url":
        flat[name] = prop.url;
        break;
      case "email":
        flat[name] = prop.email;
        break;
      case "phone_number":
        flat[name] = prop.phone_number;
        break;
      case "formula":
        flat[name] = prop.formula?.[prop.formula.type];
        break;
      case "relation":
        flat[name] = prop.relation?.map((r: { id: string }) => r.id) || [];
        break;
      case "rollup":
        flat[name] = prop.rollup?.[prop.rollup.type];
        break;
      case "people":
        flat[name] =
          prop.people?.map((p: { name?: string; id: string }) => p.name || p.id) || [];
        break;
      case "files":
        flat[name] =
          prop.files?.map(
            (f: { name?: string; external?: { url: string }; file?: { url: string } }) =>
              f.name || f.external?.url || f.file?.url,
          ) || [];
        break;
      case "created_time":
        flat[name] = prop.created_time;
        break;
      case "last_edited_time":
        flat[name] = prop.last_edited_time;
        break;
      case "created_by":
        flat[name] = prop.created_by?.name || prop.created_by?.id;
        break;
      case "last_edited_by":
        flat[name] =
          prop.last_edited_by?.name || prop.last_edited_by?.id;
        break;
      case "unique_id":
        flat[name] = prop.unique_id
          ? `${prop.unique_id.prefix || ""}${prop.unique_id.number}`
          : null;
        break;
      default:
        flat[name] = prop[prop.type] ?? null;
    }
  }
  return flat;
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
        database_id: z
          .string()
          .describe("Notion database ID (UUID, with or without dashes)"),
        filter: z
          .any()
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
          .optional()
          .describe("Number of results per page (max 100, default 100)"),
        start_cursor: z
          .string()
          .optional()
          .describe(
            "Cursor for pagination. Use next_cursor from previous response.",
          ),
      },
      async ({ database_id, filter, sorts, page_size, start_cursor }) => {
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
          );

          const results = data.results.map(
            (page: { id: string; url: string; created_time: string; last_edited_time: string; properties: Record<string, any> }) => ({
              id: page.id,
              url: page.url,
              created_time: page.created_time,
              last_edited_time: page.last_edited_time,
              properties: flattenProperties(page.properties),
            }),
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    results,
                    has_more: data.has_more,
                    next_cursor: data.next_cursor,
                    total_results: results.length,
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
        page_id: z.string().describe("Notion page ID (UUID)"),
      },
      async ({ page_id }) => {
        try {
          const data = await notionFetch(
            this.env,
            `/pages/${page_id}`,
            "GET",
          );

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
        page_id: z.string().describe("Notion page ID (UUID)"),
        properties: z
          .record(z.unknown())
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
          );

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
            query: query || "",
          });

          const databases = data.results.map(
            (db: { id: string; title?: Array<{ plain_text: string }>; properties: Record<string, any> }) => {
              const title =
                db.title?.map((t: { plain_text: string }) => t.plain_text).join("") ||
                "Untitled";

              const schema: Record<string, unknown> = {};
              for (const [propName, prop] of Object.entries(db.properties)) {
                const entry: Record<string, unknown> = { type: prop.type };
                if (prop.type === "select" && prop.select?.options) {
                  entry.options = prop.select.options.map(
                    (o: { name: string }) => o.name,
                  );
                }
                if (
                  prop.type === "multi_select" &&
                  prop.multi_select?.options
                ) {
                  entry.options = prop.multi_select.options.map(
                    (o: { name: string }) => o.name,
                  );
                }
                if (prop.type === "status" && prop.status?.options) {
                  entry.options = prop.status.options.map(
                    (o: { name: string }) => o.name,
                  );
                  entry.groups = prop.status.groups?.map(
                    (g: { name: string; option_ids: string[] }) => ({
                      name: g.name,
                      option_ids: g.option_ids,
                    }),
                  );
                }
                schema[propName] = entry;
              }

              return { id: db.id, title, schema };
            },
          );

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
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/mcp")) {
      return httpHandler.fetch(request, env, ctx);
    }
    return sseHandler.fetch(request, env, ctx);
  },
};
