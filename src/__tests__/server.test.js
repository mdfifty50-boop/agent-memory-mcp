import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { remember, recall, forget, getUserProfile, summarizeSession, searchAcrossAgents, getMemoryStats } from '../storage.js';

describe('agent-memory-mcp', () => {
  const AGENT = 'test-agent-' + Date.now();

  it('stores a memory', () => {
    const result = remember(AGENT, 'project-name', 'THRONE system', 'fact', null);
    assert.equal(result.stored, true);
    assert.ok(result.memory_id);
  });

  it('stores another memory with TTL', () => {
    const result = remember(AGENT, 'current-task', 'MCP hardening', 'context', 24);
    assert.equal(result.stored, true);
  });

  it('recalls memories by query', () => {
    const results = recall(AGENT, 'project THRONE');
    assert.ok(results);
    assert.ok(Array.isArray(results.memories) || Array.isArray(results.results) || results.total !== undefined);
  });

  it('gets memory stats', () => {
    const stats = getMemoryStats();
    assert.ok(stats);
    assert.ok(stats.total_memories >= 2 || stats.total_agents >= 1);
  });

  it('gets user profile', () => {
    const profile = getUserProfile(AGENT);
    assert.ok(profile);
  });

  it('searches across agents', () => {
    const results = searchAcrossAgents('THRONE');
    assert.ok(results);
  });

  it('forgets memories by key pattern', () => {
    remember(AGENT, 'temp-key', 'temp-value', 'fact', null);
    const result = forget(AGENT, 'temp-key');
    assert.ok(result);
  });
});
