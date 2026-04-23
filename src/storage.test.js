import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
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

// All agent IDs used in these tests — wiped before each suite
const TEST_AGENTS = [
  'agent-1',
  'agent-ttl',
  'agent-recall',
  'agent-forget',
  'agent-forget2',
  'agent-profile-1',
  'agent-profile-2',
  'agent-session',
  'agent-x',
  'agent-y',
];

function cleanAll() {
  for (const id of TEST_AGENTS) forget(id, '*');
}

describe('remember', () => {
  before(() => {
    // Clean up this agent before tests so total_memories is predictable
    forget('agent-1', '*');
    forget('agent-ttl', '*');
  });

  it('stores a memory and returns confirmation', () => {
    const result = remember('agent-1', 'user_language', 'English', 'preference');
    assert.equal(result.stored, true);
    assert.ok(result.memory_id.startsWith('mem_'));
    assert.equal(result.total_memories, 1);
  });

  it('increments total count on multiple stores', () => {
    const r1 = remember('agent-1', 'user_timezone', 'UTC+3', 'fact');
    const r2 = remember('agent-1', 'user_name', 'Ahmed', 'fact');
    assert.ok(r2.total_memories >= 3);
  });

  it('accepts optional ttl_hours', () => {
    const result = remember('agent-ttl', 'temp_key', 'temp_value', 'context', 1);
    assert.equal(result.stored, true);
  });
});

describe('recall', () => {
  before(() => {
    forget('agent-recall', '*');
    remember('agent-recall', 'project_status', 'Dashboard is 80% complete', 'fact');
    remember('agent-recall', 'api_key_rotation', 'Keys rotated on March 15', 'learning');
    remember('agent-recall', 'dashboard_color', 'User prefers dark theme', 'preference');
  });

  it('finds memories by keyword match', () => {
    const result = recall('agent-recall', 'dashboard');
    assert.ok(result.memories.length >= 2);
    assert.ok(result.total_searched >= 3);
  });

  it('filters by memory_type', () => {
    const result = recall('agent-recall', 'dashboard', 'preference');
    assert.equal(result.memories.length, 1);
    assert.equal(result.memories[0].type, 'preference');
  });

  it('respects limit', () => {
    const result = recall('agent-recall', 'dashboard', undefined, 1);
    assert.equal(result.memories.length, 1);
  });

  it('returns empty for no match', () => {
    const result = recall('agent-recall', 'xyznonexistent');
    assert.equal(result.memories.length, 0);
  });
});

describe('forget', () => {
  before(() => {
    forget('agent-forget', '*');
    forget('agent-forget2', '*');
    remember('agent-forget', 'temp_a', 'val', 'fact');
    remember('agent-forget', 'temp_b', 'val', 'fact');
    remember('agent-forget', 'keep_me', 'val', 'fact');
  });

  it('deletes by exact key', () => {
    const result = forget('agent-forget', 'keep_me');
    assert.equal(result.deleted_count, 1);
  });

  it('deletes by wildcard prefix', () => {
    const result = forget('agent-forget', 'temp*');
    assert.equal(result.deleted_count, 2);
    assert.equal(result.remaining_memories, 0);
  });

  it('clears all with *', () => {
    remember('agent-forget2', 'a', 'v', 'fact');
    remember('agent-forget2', 'b', 'v', 'fact');
    const result = forget('agent-forget2', '*');
    assert.equal(result.deleted_count, 2);
    assert.equal(result.remaining_memories, 0);
  });
});

describe('getUserProfile', () => {
  before(() => {
    forget('agent-profile-1', '*');
    forget('agent-profile-2', '*');
    remember('agent-profile-1', 'ahmed_language', 'Ahmed speaks Arabic and English', 'fact');
    remember('agent-profile-2', 'ahmed_preference', 'Ahmed prefers dark mode', 'preference');
    remember('agent-profile-1', 'ahmed_meeting', 'Met Ahmed on March 10', 'interaction');
  });

  it('aggregates facts and preferences across agents', () => {
    const profile = getUserProfile('ahmed');
    assert.ok(profile.facts.length >= 1);
    assert.ok(profile.preferences.length >= 1);
    assert.ok(profile.interaction_count >= 3);
    assert.ok(profile.first_seen);
    assert.ok(profile.last_seen);
  });

  it('returns empty for unknown user', () => {
    const profile = getUserProfile('nobody_here_xyz');
    assert.equal(profile.interaction_count, 0);
    assert.equal(profile.first_seen, null);
  });
});

describe('summarizeSession', () => {
  before(() => {
    forget('agent-session', '*');
  });

  it('stores session summary and returns count', () => {
    const result = summarizeSession(
      'agent-session',
      'sess-001',
      'Built the login page',
      ['Use OAuth instead of passwords'],
      ['Need to add MFA']
    );
    assert.equal(result.stored, true);
    assert.equal(result.session_count_total, 1);
  });

  it('increments session count', () => {
    const result = summarizeSession(
      'agent-session',
      'sess-002',
      'Added MFA support',
      ['Use TOTP'],
      []
    );
    assert.equal(result.session_count_total, 2);
  });
});

describe('searchAcrossAgents', () => {
  it('finds memories across multiple agents', () => {
    forget('agent-x', '*');
    forget('agent-y', '*');
    remember('agent-x', 'kubernetes_config', 'Using k3s on edge nodes', 'fact');
    remember('agent-y', 'kubernetes_issue', 'Pod restart loop on node-3', 'learning');
    const result = searchAcrossAgents('kubernetes');
    assert.ok(result.results.length >= 2);
    const agentIds = result.results.map(r => r.agent_id);
    assert.ok(agentIds.includes('agent-x'));
    assert.ok(agentIds.includes('agent-y'));
  });
});

describe('getMemoryStats', () => {
  it('returns stats with agent breakdown', () => {
    const stats = getMemoryStats();
    assert.ok(stats.total_memories > 0);
    assert.ok(Object.keys(stats.agents).length > 0);
    assert.ok(stats.oldest_memory);
    assert.ok(stats.newest_memory);
    assert.ok(Object.keys(stats.memory_type_distribution).length > 0);
  });
});

describe('resources', () => {
  it('listAgentsResource returns agent list', () => {
    const agents = listAgentsResource();
    assert.ok(Array.isArray(agents));
    assert.ok(agents.length > 0);
    assert.ok(agents[0].agent_id);
    assert.ok(typeof agents[0].memory_count === 'number');
  });

  it('recentMemories returns ordered list', () => {
    const recent = recentMemories(5);
    assert.ok(Array.isArray(recent));
    assert.ok(recent.length <= 5);
    if (recent.length >= 2) {
      const t0 = new Date(recent[0].created_at).getTime();
      const t1 = new Date(recent[1].created_at).getTime();
      assert.ok(t0 >= t1, 'Should be ordered newest first');
    }
  });
});
