# agent-memory-mcp

MCP server providing persistent cross-session memory for AI agents. Store, recall, search, and summarize memories across agent boundaries.

## Install

```bash
npm install
```

## Run

```bash
node src/index.js
```

## Tools

| Tool | Description |
|------|-------------|
| `remember` | Store a memory with type classification and optional TTL |
| `recall` | Retrieve memories by keyword search, sorted by relevance then recency |
| `forget` | Delete memories by exact key, wildcard prefix, or clear all |
| `get_user_profile` | Aggregate knowledge about a user/entity from all agents |
| `summarize_session` | Store session summaries with decisions and unresolved items |
| `search_across_agents` | Search memories across all agents |
| `get_memory_stats` | Dashboard of memory usage, counts, and type distribution |

## Resources

| URI | Description |
|-----|-------------|
| `memory://agents` | All agents with memory counts |
| `memory://recent` | Last 50 memories across all agents |

## Memory Types

- `fact` — Objective information
- `preference` — User/agent preferences
- `interaction` — Record of an interaction
- `learning` — Lessons learned, insights
- `context` — Session context, summaries

## Claude Desktop Config

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": ["/path/to/agent-memory-mcp/src/index.js"]
    }
  }
}
```

## Test

```bash
npm test
```

## License

MIT
