import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

  async init() {}
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
