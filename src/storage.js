/**
 * In-memory storage layer for agent-memory-mcp.
 * Uses Maps structured for easy swap to SQLite/Redis.
 */

// Primary store: agent_id -> Map<memory_id, MemoryEntry>
const agentMemories = new Map();

// Global counter for memory IDs
let memoryIdCounter = 0;

// TTL cleanup interval (every 60s)
setInterval(() => { expireMemories(); }, 60_000);

/**
 * @typedef {Object} MemoryEntry
 * @property {string} memory_id
 * @property {string} agent_id
 * @property {string} key
 * @property {string} value
 * @property {string} memory_type
 * @property {string[]} tags
 * @property {string} created_at
 * @property {number|null} expires_at - epoch ms or null
 */

function generateId() {
  memoryIdCounter++;
  return `mem_${Date.now()}_${memoryIdCounter}`;
}

function generateTags(key) {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .split(/[\s_-]+/)
    .filter(t => t.length > 1);
}

function getAgentStore(agentId) {
  if (!agentMemories.has(agentId)) {
    agentMemories.set(agentId, new Map());
  }
  return agentMemories.get(agentId);
}

function expireMemories() {
  const now = Date.now();
  for (const [, store] of agentMemories) {
    for (const [id, entry] of store) {
      if (entry.expires_at && entry.expires_at <= now) {
        store.delete(id);
      }
    }
  }
}

// ─── Tool implementations ───

export function remember(agentId, key, value, memoryType, ttlHours) {
  const store = getAgentStore(agentId);
  const memoryId = generateId();
  const entry = {
    memory_id: memoryId,
    agent_id: agentId,
    key,
    value,
    memory_type: memoryType,
    tags: generateTags(key),
    created_at: new Date().toISOString(),
    expires_at: ttlHours ? Date.now() + ttlHours * 3600_000 : null,
  };
  store.set(memoryId, entry);
  return { stored: true, memory_id: memoryId, total_memories: store.size };
}

export function recall(agentId, query, memoryType, limit = 10) {
  const store = getAgentStore(agentId);
  const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const now = Date.now();

  const scored = [];
  for (const entry of store.values()) {
    if (entry.expires_at && entry.expires_at <= now) continue;
    if (memoryType && entry.memory_type !== memoryType) continue;

    const haystack = `${entry.key} ${entry.value}`.toLowerCase();
    let matchCount = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) matchCount++;
    }
    if (matchCount === 0) continue;

    scored.push({
      memory_id: entry.memory_id,
      key: entry.key,
      value: entry.value,
      type: entry.memory_type,
      created_at: entry.created_at,
      relevance_score: matchCount / queryTokens.length,
      _ts: new Date(entry.created_at).getTime(),
    });
  }

  // Sort by relevance desc, then recency desc
  scored.sort((a, b) => {
    if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
    return b._ts - a._ts;
  });

  const results = scored.slice(0, limit).map(({ _ts, ...rest }) => rest);
  return { memories: results, total_searched: store.size };
}

export function forget(agentId, keyPattern) {
  const store = getAgentStore(agentId);
  let deletedCount = 0;

  if (keyPattern === '*') {
    deletedCount = store.size;
    store.clear();
  } else {
    // Support trailing wildcard: "prefix*"
    const isWildcard = keyPattern.endsWith('*');
    const prefix = isWildcard ? keyPattern.slice(0, -1) : null;

    for (const [id, entry] of store) {
      const match = isWildcard
        ? entry.key.startsWith(prefix)
        : entry.key === keyPattern;
      if (match) {
        store.delete(id);
        deletedCount++;
      }
    }
  }

  return { deleted_count: deletedCount, remaining_memories: store.size };
}

export function getUserProfile(userId) {
  const facts = [];
  const preferences = [];
  let interactionCount = 0;
  let firstSeen = null;
  let lastSeen = null;

  const userLower = userId.toLowerCase();

  for (const [, store] of agentMemories) {
    for (const entry of store.values()) {
      const haystack = `${entry.key} ${entry.value} ${entry.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(userLower)) continue;

      interactionCount++;
      const ts = new Date(entry.created_at);
      if (!firstSeen || ts < firstSeen) firstSeen = ts;
      if (!lastSeen || ts > lastSeen) lastSeen = ts;

      if (entry.memory_type === 'fact') facts.push(entry.value);
      if (entry.memory_type === 'preference') preferences.push(entry.value);
    }
  }

  return {
    user_id: userId,
    facts,
    preferences,
    interaction_count: interactionCount,
    first_seen: firstSeen ? firstSeen.toISOString() : null,
    last_seen: lastSeen ? lastSeen.toISOString() : null,
  };
}

export function summarizeSession(agentId, sessionId, summary, keyDecisions, unresolvedItems) {
  const store = getAgentStore(agentId);
  const memoryId = generateId();
  const entry = {
    memory_id: memoryId,
    agent_id: agentId,
    key: `session:${sessionId}`,
    value: JSON.stringify({ summary, key_decisions: keyDecisions, unresolved_items: unresolvedItems }),
    memory_type: 'context',
    tags: ['session', sessionId, ...generateTags(summary)],
    created_at: new Date().toISOString(),
    expires_at: null,
  };
  store.set(memoryId, entry);

  // Count total sessions for this agent
  let sessionCount = 0;
  for (const e of store.values()) {
    if (e.key.startsWith('session:')) sessionCount++;
  }

  return { stored: true, session_count_total: sessionCount };
}

export function searchAcrossAgents(query, limit = 10) {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const now = Date.now();
  const scored = [];

  for (const [agentId, store] of agentMemories) {
    for (const entry of store.values()) {
      if (entry.expires_at && entry.expires_at <= now) continue;

      const haystack = `${entry.key} ${entry.value}`.toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (haystack.includes(token)) matchCount++;
      }
      if (matchCount === 0) continue;

      scored.push({
        agent_id: agentId,
        key: entry.key,
        value: entry.value,
        type: entry.memory_type,
        relevance: matchCount / queryTokens.length,
        _ts: new Date(entry.created_at).getTime(),
      });
    }
  }

  scored.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return b._ts - a._ts;
  });

  return { results: scored.slice(0, limit).map(({ _ts, ...rest }) => rest) };
}

export function getMemoryStats() {
  const agentStats = {};
  let totalMemories = 0;
  let oldest = null;
  let newest = null;
  const typeDistribution = {};

  for (const [agentId, store] of agentMemories) {
    const byType = {};
    for (const entry of store.values()) {
      byType[entry.memory_type] = (byType[entry.memory_type] || 0) + 1;
      typeDistribution[entry.memory_type] = (typeDistribution[entry.memory_type] || 0) + 1;
      totalMemories++;

      const ts = new Date(entry.created_at);
      if (!oldest || ts < oldest) oldest = ts;
      if (!newest || ts > newest) newest = ts;
    }
    agentStats[agentId] = { total: store.size, by_type: byType };
  }

  return {
    agents: agentStats,
    total_memories: totalMemories,
    oldest_memory: oldest ? oldest.toISOString() : null,
    newest_memory: newest ? newest.toISOString() : null,
    memory_type_distribution: typeDistribution,
  };
}

// ─── Resource helpers ───

export function listAgentsResource() {
  const agents = [];
  for (const [agentId, store] of agentMemories) {
    agents.push({ agent_id: agentId, memory_count: store.size });
  }
  return agents;
}

export function recentMemories(limit = 50) {
  const all = [];
  for (const [, store] of agentMemories) {
    for (const entry of store.values()) {
      all.push(entry);
    }
  }
  all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return all.slice(0, limit);
}
