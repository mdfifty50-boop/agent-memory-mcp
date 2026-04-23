/**
 * SQLite-backed storage layer for agent-memory-mcp.
 * Drop-in replacement for the previous in-memory Map implementation.
 * All exported function signatures are identical to the original.
 */

import { db } from './db.js';

// ─── Internal helpers ───

let memoryIdCounter = 0;

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

/** Returns epoch ms cutoff for "not expired" queries. */
function nowMs() {
  return Date.now();
}

/** Deserialize a DB row into a MemoryEntry (tags JSON → array). */
function rowToEntry(row) {
  return {
    memory_id:   row.memory_id,
    agent_id:    row.agent_id,
    key:         row.key,
    value:       row.value,
    memory_type: row.memory_type,
    tags:        JSON.parse(row.tags),
    created_at:  row.created_at,
    expires_at:  row.expires_at ?? null,
  };
}

// ─── Prepared statements (compiled once, reused) ───

const stmtInsert = db.prepare(`
  INSERT INTO memories (memory_id, agent_id, key, value, memory_type, tags, created_at, expires_at)
  VALUES (@memory_id, @agent_id, @key, @value, @memory_type, @tags, @created_at, @expires_at)
`);

const stmtCountAgent = db.prepare(`
  SELECT COUNT(*) AS cnt FROM memories
  WHERE agent_id = @agent_id AND (expires_at IS NULL OR expires_at > @now)
`);

const stmtSelectAgent = db.prepare(`
  SELECT * FROM memories
  WHERE agent_id = @agent_id AND (expires_at IS NULL OR expires_at > @now)
`);

const stmtSelectAll = db.prepare(`
  SELECT * FROM memories
  WHERE expires_at IS NULL OR expires_at > @now
`);

const stmtDeleteExact = db.prepare(`
  DELETE FROM memories WHERE agent_id = @agent_id AND key = @key
`);

const stmtDeletePrefix = db.prepare(`
  DELETE FROM memories WHERE agent_id = @agent_id AND key LIKE @prefix ESCAPE '\\'
`);

const stmtDeleteAll = db.prepare(`
  DELETE FROM memories WHERE agent_id = @agent_id
`);

const stmtCountAgentRemaining = db.prepare(`
  SELECT COUNT(*) AS cnt FROM memories WHERE agent_id = @agent_id
`);

const stmtSelectAllRaw = db.prepare(`SELECT * FROM memories`);

const stmtCountSessionsForAgent = db.prepare(`
  SELECT COUNT(*) AS cnt FROM memories
  WHERE agent_id = @agent_id AND key LIKE 'session:%'
`);

// ─── Tool implementations ───

export function remember(agentId, key, value, memoryType, ttlHours) {
  const memoryId = generateId();
  const now = nowMs();
  const entry = {
    memory_id:   memoryId,
    agent_id:    agentId,
    key,
    value,
    memory_type: memoryType,
    tags:        JSON.stringify(generateTags(key)),
    created_at:  new Date().toISOString(),
    expires_at:  ttlHours ? now + ttlHours * 3_600_000 : null,
  };
  stmtInsert.run(entry);

  const { cnt } = stmtCountAgent.get({ agent_id: agentId, now });
  return { stored: true, memory_id: memoryId, total_memories: cnt };
}

export function recall(agentId, query, memoryType, limit = 10) {
  const now = nowMs();
  const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  const rows = stmtSelectAgent.all({ agent_id: agentId, now });
  const totalSearched = rows.length;

  const scored = [];
  for (const row of rows) {
    if (memoryType && row.memory_type !== memoryType) continue;

    const haystack = `${row.key} ${row.value}`.toLowerCase();
    let matchCount = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) matchCount++;
    }
    if (matchCount === 0) continue;

    scored.push({
      memory_id:       row.memory_id,
      key:             row.key,
      value:           row.value,
      type:            row.memory_type,
      created_at:      row.created_at,
      relevance_score: matchCount / queryTokens.length,
      _ts:             new Date(row.created_at).getTime(),
    });
  }

  scored.sort((a, b) => {
    if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
    return b._ts - a._ts;
  });

  const results = scored.slice(0, limit).map(({ _ts, ...rest }) => rest);
  return { memories: results, total_searched: totalSearched };
}

export function forget(agentId, keyPattern) {
  let deletedCount = 0;

  if (keyPattern === '*') {
    const { cnt: before } = stmtCountAgentRemaining.get({ agent_id: agentId });
    stmtDeleteAll.run({ agent_id: agentId });
    deletedCount = before;
  } else {
    const isWildcard = keyPattern.endsWith('*');

    if (isWildcard) {
      // Escape any SQL LIKE special chars in the prefix, then append %
      const rawPrefix = keyPattern.slice(0, -1);
      const escapedPrefix = rawPrefix.replace(/[\\%_]/g, c => `\\${c}`);
      const info = stmtDeletePrefix.run({ agent_id: agentId, prefix: `${escapedPrefix}%` });
      deletedCount = info.changes;
    } else {
      const info = stmtDeleteExact.run({ agent_id: agentId, key: keyPattern });
      deletedCount = info.changes;
    }
  }

  const { cnt: remaining } = stmtCountAgentRemaining.get({ agent_id: agentId });
  return { deleted_count: deletedCount, remaining_memories: remaining };
}

export function getUserProfile(userId) {
  const facts = [];
  const preferences = [];
  let interactionCount = 0;
  let firstSeen = null;
  let lastSeen = null;

  const userLower = userId.toLowerCase();
  const rows = stmtSelectAllRaw.all();

  for (const row of rows) {
    const tags = JSON.parse(row.tags);
    const haystack = `${row.key} ${row.value} ${tags.join(' ')}`.toLowerCase();
    if (!haystack.includes(userLower)) continue;

    interactionCount++;
    const ts = new Date(row.created_at);
    if (!firstSeen || ts < firstSeen) firstSeen = ts;
    if (!lastSeen || ts > lastSeen) lastSeen = ts;

    if (row.memory_type === 'fact') facts.push(row.value);
    if (row.memory_type === 'preference') preferences.push(row.value);
  }

  return {
    user_id:           userId,
    facts,
    preferences,
    interaction_count: interactionCount,
    first_seen:        firstSeen ? firstSeen.toISOString() : null,
    last_seen:         lastSeen ? lastSeen.toISOString() : null,
  };
}

export function summarizeSession(agentId, sessionId, summary, keyDecisions, unresolvedItems) {
  const memoryId = generateId();
  const entry = {
    memory_id:   memoryId,
    agent_id:    agentId,
    key:         `session:${sessionId}`,
    value:       JSON.stringify({ summary, key_decisions: keyDecisions, unresolved_items: unresolvedItems }),
    memory_type: 'context',
    tags:        JSON.stringify(['session', sessionId, ...generateTags(summary)]),
    created_at:  new Date().toISOString(),
    expires_at:  null,
  };
  stmtInsert.run(entry);

  const { cnt: sessionCount } = stmtCountSessionsForAgent.get({ agent_id: agentId });
  return { stored: true, session_count_total: sessionCount };
}

export function searchAcrossAgents(query, limit = 10) {
  const now = nowMs();
  const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  const rows = stmtSelectAll.all({ now });
  const scored = [];

  for (const row of rows) {
    const haystack = `${row.key} ${row.value}`.toLowerCase();
    let matchCount = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) matchCount++;
    }
    if (matchCount === 0) continue;

    scored.push({
      agent_id:  row.agent_id,
      key:       row.key,
      value:     row.value,
      type:      row.memory_type,
      relevance: matchCount / queryTokens.length,
      _ts:       new Date(row.created_at).getTime(),
    });
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

  const rows = stmtSelectAllRaw.all();

  for (const row of rows) {
    const { agent_id, memory_type, created_at } = row;

    if (!agentStats[agent_id]) agentStats[agent_id] = { total: 0, by_type: {} };
    agentStats[agent_id].total++;
    agentStats[agent_id].by_type[memory_type] = (agentStats[agent_id].by_type[memory_type] || 0) + 1;

    typeDistribution[memory_type] = (typeDistribution[memory_type] || 0) + 1;
    totalMemories++;

    const ts = new Date(created_at);
    if (!oldest || ts < oldest) oldest = ts;
    if (!newest || ts > newest) newest = ts;
  }

  return {
    agents:                    agentStats,
    total_memories:            totalMemories,
    oldest_memory:             oldest ? oldest.toISOString() : null,
    newest_memory:             newest ? newest.toISOString() : null,
    memory_type_distribution:  typeDistribution,
  };
}

// ─── Resource helpers ───

export function listAgentsResource() {
  const rows = db.prepare(`
    SELECT agent_id, COUNT(*) AS memory_count FROM memories GROUP BY agent_id
  `).all();
  return rows.map(r => ({ agent_id: r.agent_id, memory_count: r.memory_count }));
}

export function recentMemories(limit = 50) {
  const rows = db.prepare(`
    SELECT * FROM memories ORDER BY created_at DESC LIMIT ?
  `).all(limit);
  return rows.map(rowToEntry);
}
