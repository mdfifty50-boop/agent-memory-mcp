/**
 * SQLite database initializer for agent-memory-mcp.
 * Auto-creates the DB file and schema on first run.
 */

import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

// better-sqlite3 is a CommonJS module; load it via createRequire in ESM context
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbPath = process.env.AGENT_MEMORY_DB ||
  path.join(os.homedir(), '.agent-memory-mcp', 'memories.db');

// Ensure directory exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    memory_id   TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    memory_type TEXT DEFAULT 'short_term',
    tags        TEXT DEFAULT '[]',
    created_at  TEXT NOT NULL,
    expires_at  INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_agent_id ON memories(agent_id);
`);

export { db };
