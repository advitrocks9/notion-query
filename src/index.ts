import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface Env {
  NOTION_API_KEY: string;
  MCP_OBJECT: DurableObjectNamespace;
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
