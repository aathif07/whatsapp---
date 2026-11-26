// SQLite storage. Chat, accounts and session data live in memory and are written through as rows;
// attendance days and logins are read and written directly so the database enforces their rules.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LISTS = ['accounts', 'users', 'messages', 'sessions', 'records', 'logs', 'links'];
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const sql = new Database(join(dir, 'app.db'));
  sql.pragma('foreign_keys = ON'); sql.pragma('synchronous = FULL');
  for (const l of LISTS) sql.exec(`CREATE TABLE IF NOT EXISTS ${l} (id TEXT PRIMARY KEY, json TEXT NOT NULL)`);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS days (
      id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, date TEXT NOT NULL,
      in_at INTEGER NOT NULL, out_at INTEGER, in_source TEXT NOT NULL, out_source TEXT, in_loc TEXT, out_loc TEXT,
      late_min INTEGER NOT NULL DEFAULT 0, corrected INTEGER NOT NULL DEFAULT 0,
      UNIQUE (user_id, date), CHECK (out_at IS NULL OR out_at >= in_at));
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pins (user_id TEXT PRIMARY KEY, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS logins (token TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wamids (id TEXT PRIMARY KEY, at INTEGER NOT NULL);`);

  const seen = Object.fromEntries(LISTS.map((l) => [l, new Map()]));
  const kvs = new Map();
  function load() {
    const db = {};
    for (const l of LISTS) db[l] = sql.prepare(`SELECT id, json FROM ${l} ORDER BY rowid`).all().map((r) => { seen[l].set(r.id, r.json); return JSON.parse(r.json); });
    db.logs.sort((a, b) => b.at - a.at);
    for (const r of sql.prepare('SELECT * FROM kv').all()) { kvs.set(r.k, r.json); db[r.k] = JSON.parse(r.json); }
    return db;
  }
  const put = Object.fromEntries(LISTS.map((l) => [l, sql.prepare(`INSERT INTO ${l} VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json`)]));
  const del = Object.fromEntries(LISTS.map((l) => [l, sql.prepare(`DELETE FROM ${l} WHERE id = ?`)]));
  const putKv = sql.prepare('INSERT INTO kv VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET json = excluded.json');
  /** Write only what changed, in one transaction. */
  function save(db) {
    const work = [];
    for (const l of LISTS) {
      const ids = new Set();
      for (const row of db[l]) { const json = JSON.stringify(row); ids.add(row.id); if (seen[l].get(row.id) !== json) work.push([l, row.id, json]); }
      for (const k of seen[l].keys()) if (!ids.has(k)) work.push([l, k, null]);
    }
    const kw = ['settings', 'nextUser'].map((k) => [k, JSON.stringify(db[k])]).filter(([k, j]) => kvs.get(k) !== j);
    if (!work.length && !kw.length) return;
    sql.transaction(() => {
      for (const [l, k, j] of work) j === null ? del[l].run(k) : put[l].run(k, j);
      for (const [k, j] of kw) putKv.run(k, j);
    })();
    for (const [l, k, j] of work) j === null ? seen[l].delete(k) : seen[l].set(k, j);
    for (const [k, j] of kw) kvs.set(k, j);
  }
  return { sql, load, save };
}
