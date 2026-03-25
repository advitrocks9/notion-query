# notion-query

MCP server for structured Notion queries.

## The problem

Claude's built-in Notion connector only does semantic search, returning at most 10 fuzzy results. It cannot filter by property values (status, date, module, type), sort results, or paginate through large databases. If you want Claude to answer "show me all overdue tasks where Status is In Progress", the default connector can't do it.

## How it works

The server wraps the Notion REST API and exposes four tools over MCP:

- **query_database**: Filter, sort, and paginate any database. Think SQL-style WHERE, ORDER BY, and LIMIT.
- **get_page**: Fetch a single page with all its properties.
- **update_page**: Modify page properties (status, dates, text, and others).
- **list_databases**: Discover all databases the integration can access, along with their schemas.

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

npm run deploy
```

This gives you a URL like `https://notion-query-mcp.<your-subdomain>.workers.dev`.

### 4. Connect to Claude

1. In Claude, go to **Settings** > **Integrations** > **Add custom connector**
2. Enter your worker URL with the `/sse` path (e.g. `https://notion-query-mcp.example.workers.dev/sse`)
3. Leave OAuth fields empty
4. Click **Add**

## Example queries

Once connected, try these in a Claude conversation:

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

## Cost

Free. Cloudflare Workers gives you 100k requests/day on the free tier. The Notion API is free for internal integrations.

## License

MIT
