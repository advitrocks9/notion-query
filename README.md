# notion-query

MCP server for structured Notion queries.

## The problem

Claude's built-in Notion connector only does semantic search, returning at most 10 fuzzy results. It cannot filter by property values (status, date, module, type), sort results, or paginate through large databases. If you want Claude to answer "show me all overdue tasks where Status is In Progress", the default connector can't do it.

## How it works

Wraps the Notion REST API and exposes four MCP tools:

- **query_database** -- filter, sort, and paginate any database (WHERE + ORDER BY + LIMIT)
- **get_page** -- fetch a single page with all its properties
- **update_page** -- modify page properties (status, dates, text, etc.)
- **list_databases** -- discover accessible databases and their schemas

## Tech stack

- TypeScript on Cloudflare Workers
- MCP SDK (`@modelcontextprotocol/sdk`) with SSE and Streamable HTTP transports
- Zod for input validation
- Notion REST API (internal integration)

## Setup

### 1. Create a Notion integration

1. Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
2. Click **New integration**, name it whatever you want
3. Enable **Read content** and **Update content**
4. Copy the **Internal Integration Secret** (starts with `ntn_`)

### 2. Share your databases

Open each Notion database you want Claude to query. Click `...` > **Connections** > **Connect to** and select your integration.

### 3. Deploy to Cloudflare

```bash
git clone <this-repo>
cd notion-query-mcp
npm install

npx wrangler login
npx wrangler secret put NOTION_API_KEY
# Paste your ntn_XXXXX token when prompted

npx wrangler secret put MCP_AUTH_TOKEN
# Paste a strong random token (e.g. openssl rand -hex 32)

npm run deploy
```

This gives you a URL like `https://notion-query-mcp.<your-subdomain>.workers.dev`.

### 4. Connect to Claude

All requests require a bearer token. Set your `MCP_AUTH_TOKEN` as a Cloudflare secret (step 3), then configure your MCP client to send it.

**Claude Desktop / claude.ai config:**

```json
{
  "mcpServers": {
    "notion-query": {
      "url": "https://notion-query-mcp.your-subdomain.workers.dev/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

**Claude Code config (`~/.claude.json` or project `.mcp.json`):**

```json
{
  "mcpServers": {
    "notion-query": {
      "type": "sse",
      "url": "https://notion-query-mcp.your-subdomain.workers.dev/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

Replace `YOUR_MCP_AUTH_TOKEN` with the same token you set via `wrangler secret put`.

## Example queries

Once connected, try in a Claude conversation:

- "List all my Notion databases"
- "Show me all tasks where Status is 'Not started', sorted by due date"
- "Mark task X as Done"
- "What's overdue in my coursework database?"

## Development

```bash
npm run dev          # local dev server
npm run type-check   # TypeScript validation
npm run deploy       # deploy to Cloudflare
```

## Security

- Bearer token auth on all endpoints (`npx wrangler secret put MCP_AUTH_TOKEN`)
- CORS locked to `https://claude.ai`
- Rate limited: 60 req/min via Cloudflare Rate Limiting
- All IDs validated as UUIDs; filters validated against a structured Zod schema; property updates capped at 50 fields
- Notion API errors logged server-side only; clients get generic error codes

## Cost

Free. Cloudflare Workers free tier (100k req/day) + Notion API (free for internal integrations).

## License

MIT
