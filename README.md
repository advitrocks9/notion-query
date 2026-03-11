# Notion Query MCP Server

A custom [MCP](https://modelcontextprotocol.io/) server that gives Claude structured, SQL-style query access to any Notion database. Deployed on Cloudflare Workers (free tier).

## Why

Claude's built-in Notion connector only supports semantic search (max 10 fuzzy results). It cannot filter by property values like Status, Module, or Type. This server wraps the Notion REST API to expose proper structured filtering, sorting, and pagination.

## Tools

| Tool | Description |
|------|-------------|
| `query_database` | Query with filters, sorts, and pagination (SQL-style WHERE/ORDER BY/LIMIT) |
| `get_page` | Fetch a single page with all properties |
| `update_page` | Update page properties (status, dates, text, etc.) |
| `list_databases` | Discover all accessible databases and their schemas |

## Setup

### Prerequisites

- Node.js v18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free, no credit card)
- A Notion workspace

### 1. Create a Notion Integration

1. Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
2. Click **New integration**, name it (e.g. `Claude MCP Bridge`)
3. Enable **Read content** and **Update content**
4. Copy the **Internal Integration Secret** (starts with `ntn_`)

### 2. Share Databases

Open each Notion database you want Claude to access, click `...` > **Connections** > **Connect to** > select your integration.

### 3. Install and Deploy

```bash
git clone <this-repo>
cd notion-query-mcp
npm install

# Login to Cloudflare
npx wrangler login

# Set your Notion API key as a secret
npx wrangler secret put NOTION_API_KEY
# Paste your ntn_XXXXX token

# Deploy
npm run deploy
```

The deploy outputs a URL like `https://notion-query-mcp.<your-subdomain>.workers.dev`.

### 4. Connect to Claude.ai

1. Go to **Settings** > **Integrations** > **Add custom connector**
2. Enter a name and your worker URL with `/sse` path (e.g. `https://notion-query-mcp.example.workers.dev/sse`)
3. Leave OAuth fields empty
4. Click **Add**

### 5. Test

Open a new Claude conversation and try:

> "List all my Notion databases"

> "Show me all tasks where Status is 'Not started', sorted by Date"

## Endpoints

The server exposes two MCP transports:

- **SSE**: `/sse` (used by Claude.ai)
- **Streamable HTTP**: `/mcp`

## Development

```bash
npm run dev        # Local dev server
npm run type-check # TypeScript validation
npm run deploy     # Deploy to Cloudflare
```

## Cost

$0/month. Cloudflare Workers free tier provides 100,000 requests/day. The Notion API is free for internal integrations.

## License

MIT
