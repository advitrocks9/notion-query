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
            (page: { id: string; url: string; created_time: string; last_edited_time: string; properties: Record<string, unknown> }) => ({
              id: page.id,
              url: page.url,
              created_time: page.created_time,
              last_edited_time: page.last_edited_time,
              properties: page.properties,
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
