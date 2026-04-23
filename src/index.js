#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  remember,
  recall,
  forget,
  getUserProfile,
  summarizeSession,
  searchAcrossAgents,
  getMemoryStats,
  listAgentsResource,
  recentMemories,
} from './storage.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';


const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const startTime = Date.now();
let toolCallCount = 0;

function wrap(fn) {
  return async (...args) => {
    toolCallCount++;
    try { return await fn(...args); }
    catch (e) { return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }] }; }
  };
}
const server = new McpServer({
  name: 'agent-memory-mcp',
  version: pkg.version,
  description: 'Persistent cross-session memory for AI agents — store, recall, search, and summarize memories across agent boundaries',
});

server.tool('health_check', 'Returns server health, uptime, version, and call stats', {},
  wrap(async () => ({
    content: [{ type: 'text', text: JSON.stringify({
      status: 'healthy', server: 'agent-memorystore-mcp', version: pkg.version,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      tool_calls_served: toolCallCount,
    }, null, 2) }],
  }))
);

// ═══════════════════════════════════════════
// TOOL: remember
// ═══════════════════════════════════════════

server.tool(
  'remember',
  'Store a memory for an agent. Persists across sessions. Supports optional TTL for auto-expiry.',
  {
    agent_id: z.string().describe('Unique identifier for the agent storing this memory'),
    key: z.string().describe('Short descriptive key for the memory (e.g. "user_preferred_language")'),
    value: z.string().describe('The memory content to store'),
    memory_type: z.enum(['fact', 'preference', 'interaction', 'learning', 'context']).describe('Category of memory'),
    ttl_hours: z.number().optional().describe('Auto-expire after this many hours (omit for permanent)'),
  },
  async ({ agent_id, key, value, memory_type, ttl_hours }) => {
    const result = remember(agent_id, key, value, memory_type, ttl_hours);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: recall
// ═══════════════════════════════════════════

server.tool(
  'recall',
  'Retrieve relevant memories for an agent. Keyword-matches against key and value, sorted by relevance then recency.',
  {
    agent_id: z.string().describe('Agent whose memories to search'),
    query: z.string().describe('Search query — keywords matched against stored memories'),
    memory_type: z.enum(['fact', 'preference', 'interaction', 'learning', 'context']).optional().describe('Filter by memory type'),
    limit: z.number().int().min(1).max(100).default(10).describe('Maximum results to return (default 10)'),
  },
  async ({ agent_id, query, memory_type, limit }) => {
    const result = recall(agent_id, query, memory_type, limit);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: forget
// ═══════════════════════════════════════════

server.tool(
  'forget',
  'Delete memories by key pattern. Use exact key for single delete, "prefix*" for wildcard, or "*" to clear all.',
  {
    agent_id: z.string().describe('Agent whose memories to delete'),
    key_pattern: z.string().describe('Exact key, "prefix*" wildcard, or "*" to delete all'),
  },
  async ({ agent_id, key_pattern }) => {
    const result = forget(agent_id, key_pattern);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: get_user_profile
// ═══════════════════════════════════════════

server.tool(
  'get_user_profile',
  'Build a profile of accumulated knowledge about a user or entity, aggregated from all agents\' memories.',
  {
    user_id: z.string().describe('User or entity identifier to build a profile for'),
  },
  async ({ user_id }) => {
    const result = getUserProfile(user_id);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: summarize_session
// ═══════════════════════════════════════════

server.tool(
  'summarize_session',
  'Store a session summary for future recall. Captures key decisions and unresolved items.',
  {
    agent_id: z.string().describe('Agent that ran the session'),
    session_id: z.string().describe('Unique identifier for the session'),
    summary: z.string().describe('Human-readable summary of what happened'),
    key_decisions: z.array(z.string()).describe('List of decisions made during the session'),
    unresolved_items: z.array(z.string()).describe('List of items left unresolved'),
  },
  async ({ agent_id, session_id, summary, key_decisions, unresolved_items }) => {
    const result = summarizeSession(agent_id, session_id, summary, key_decisions, unresolved_items);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: search_across_agents
// ═══════════════════════════════════════════

server.tool(
  'search_across_agents',
  'Search memories across ALL agents. Useful for finding cross-cutting knowledge or context.',
  {
    query: z.string().describe('Search query — keywords matched across all agent memories'),
    limit: z.number().int().min(1).max(100).default(10).describe('Maximum results to return (default 10)'),
  },
  async ({ query, limit }) => {
    const result = searchAcrossAgents(query, limit);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: get_memory_stats
// ═══════════════════════════════════════════

server.tool(
  'get_memory_stats',
  'Memory usage dashboard — per-agent counts by type, totals, oldest/newest, type distribution.',
  {},
  async () => {
    const result = getMemoryStats();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════

server.resource(
  'agents',
  'memory://agents',
  async () => {
    const agents = listAgentsResource();
    return {
      contents: [{
        uri: 'memory://agents',
        mimeType: 'application/json',
        text: JSON.stringify({ agents, total: agents.length }, null, 2),
      }],
    };
  }
);

server.resource(
  'recent',
  'memory://recent',
  async () => {
    const memories = recentMemories(50);
    return {
      contents: [{
        uri: 'memory://recent',
        mimeType: 'application/json',
        text: JSON.stringify({ memories, count: memories.length }, null, 2),
      }],
    };
  }
);

// ═══════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Agent Memory MCP Server running on stdio');
}

main().catch(console.error);
