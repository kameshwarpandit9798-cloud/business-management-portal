const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const COLLECTIONS = {
  companies: 'companies',
  users: 'users',
  teams: 'teams',
  announcements: 'announcements',
  projects: 'projects',
  tasks: 'tasks',
  chatMessages: 'chat_messages',
  featureRecords: 'feature_records'
};

class PortalDatabase {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.connection = new DatabaseSync(filename, { timeout: 5000 });
    this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS portal_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, industry TEXT NOT NULL, accent TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, active INTEGER NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, team_id TEXT NOT NULL, status TEXT NOT NULL, due_date TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, project_id TEXT NOT NULL, team_id TEXT NOT NULL, owner_id TEXT NOT NULL, status TEXT NOT NULL, due_date TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS feature_records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, company_id TEXT NOT NULL, actor_id TEXT NOT NULL, parent_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS teams_company_idx ON teams(company_id);
      CREATE INDEX IF NOT EXISTS announcements_company_created_idx ON announcements(company_id, created_at);
      CREATE INDEX IF NOT EXISTS projects_company_team_idx ON projects(company_id, team_id);
      CREATE INDEX IF NOT EXISTS tasks_company_team_due_idx ON tasks(company_id, team_id, due_date);
      CREATE INDEX IF NOT EXISTS tasks_owner_status_idx ON tasks(owner_id, status);
      CREATE INDEX IF NOT EXISTS chat_company_conversation_idx ON chat_messages(company_id, sender_id, recipient_id, created_at);
      CREATE INDEX IF NOT EXISTS feature_company_kind_parent_idx ON feature_records(company_id, kind, parent_id, created_at);
    `);
    this.meta = this.connection.prepare('SELECT value FROM portal_meta WHERE key = ?');
    this.setMeta = this.connection.prepare('INSERT INTO portal_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  }

  isInitialized() {
    return Boolean(this.meta.get('schema_version'));
  }

  load() {
    if (!this.isInitialized()) return null;
    const data = {};
    for (const [key, table] of Object.entries(COLLECTIONS)) {
      data[key] = this.connection.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.payload));
    }
    return data;
  }

  save(data) {
    const db = this.connection;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of Object.values(COLLECTIONS)) db.exec(`DELETE FROM ${table}`);
      for (const [key, table] of Object.entries(COLLECTIONS)) {
        const config = { table };
        const prepared = this.prepareInsert(key, config, db);
        for (const item of data[key]) prepared.run(...this.valuesFor(key, config, item));
      }
      this.setMeta.run('schema_version', '3');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  insertChatMessage(message) {
    this.connection.prepare('INSERT INTO chat_messages (id, company_id, sender_id, recipient_id, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)')
      .run(message.id, message.companyId, message.senderId, message.recipientId, message.createdAt, JSON.stringify(message));
  }

  prepareInsert(key, config, db) {
    const columnNames = {
      companies: 'id, name, industry, accent, payload',
      users: 'id, email, active, payload',
      teams: 'id, company_id, name, payload',
      announcements: 'id, company_id, created_at, payload',
      projects: 'id, company_id, team_id, status, due_date, payload',
      tasks: 'id, company_id, project_id, team_id, owner_id, status, due_date, payload',
      chatMessages: 'id, company_id, sender_id, recipient_id, created_at, payload',
      featureRecords: 'id, kind, company_id, actor_id, parent_id, created_at, payload'
    }[key];
    const count = columnNames.split(',').length;
    return db.prepare(`INSERT INTO ${config.table} (${columnNames}) VALUES (${Array(count).fill('?').join(', ')})`);
  }

  valuesFor(key, config, item) {
    const payload = JSON.stringify(item);
    switch (key) {
      case 'companies': return [item.id, item.name, item.industry || '', item.accent || '', payload];
      case 'users': return [item.id, item.email.toLowerCase(), item.active === false ? 0 : 1, payload];
      case 'teams': return [item.id, item.companyId, item.name, payload];
      case 'announcements': return [item.id, item.companyId, item.createdAt || '', payload];
      case 'projects': return [item.id, item.companyId, item.teamId, item.status || '', item.dueDate || '', payload];
      case 'tasks': return [item.id, item.companyId, item.projectId, item.teamId, item.ownerId, item.status || 'TODO', item.dueDate || '', payload];
      case 'chatMessages': return [item.id, item.companyId, item.senderId, item.recipientId, item.createdAt || '', payload];
      case 'featureRecords': return [item.id, item.kind, item.companyId, item.actorId, item.parentId, item.createdAt || '', payload];
      default: throw new Error(`Unknown database collection: ${key}`);
    }
  }
}

module.exports = { PortalDatabase };
