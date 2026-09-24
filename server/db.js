// מסד נתונים SQLite מובנה ב-Node (node:sqlite) — בלי התקנות נוספות.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY,
      ref TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      service TEXT NOT NULL,            -- self | concierge
      status TEXT NOT NULL DEFAULT 'new', -- new | in_progress | done
      new_city TEXT,
      move_date TEXT,
      data TEXT NOT NULL                -- כל הפרטים, מוצפנים
    );
    CREATE TABLE IF NOT EXISTS tasks (
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      body_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo', -- todo | done | auto | na | error
      note TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (lead_id, body_id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
    -- מונים אנונימיים: בלי IP, בלי עוגיות. רק כמה פעמים ביום.
    CREATE TABLE IF NOT EXISTS counters (
      day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, key)
    );
    -- מובילים (פיילוט)
    CREATE TABLE IF NOT EXISTS movers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL, contact TEXT, phone TEXT NOT NULL, email TEXT, website TEXT,
      areas TEXT NOT NULL DEFAULT '',          -- ערים מופרדות בפסיק, או * לכל הארץ
      company_id TEXT, insurance INTEGER NOT NULL DEFAULT 0, agreement INTEGER NOT NULL DEFAULT 0,
      checked_at TEXT, notes TEXT,
      active INTEGER NOT NULL DEFAULT 0,       -- 0 = בקשת הצטרפות / מושהה
      paying INTEGER NOT NULL DEFAULT 0,       -- משלם על הפניות (לגילוי נאות)
      weekly_cap INTEGER NOT NULL DEFAULT 10,
      source TEXT NOT NULL DEFAULT 'admin',    -- admin | join
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mover_leads (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      mover_id INTEGER NOT NULL REFERENCES movers(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | contacted | quoted | won | lost
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, first_action_at TEXT, expires_at TEXT NOT NULL,
      UNIQUE (lead_id, mover_id)
    );
    -- בקשות לתיאום שיחה עם נציג של גוף (אנחנו ממתינים על הקו ומחברים את הלקוח)
    CREATE TABLE IF NOT EXISTS callbacks (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      body_id TEXT NOT NULL, title TEXT NOT NULL, day TEXT NOT NULL, slot TEXT NOT NULL,
      note TEXT, status TEXT NOT NULL DEFAULT 'todo',   -- todo | done | failed | canceled
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER UNIQUE REFERENCES leads(id) ON DELETE SET NULL,
      mover_id INTEGER NOT NULL REFERENCES movers(id) ON DELETE CASCADE,
      stars INTEGER NOT NULL, text TEXT, public_name TEXT, city TEXT,
      published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
  `);
  // הרחבות לטבלה קיימת (בטוח להריץ שוב)
  for (const col of ["amount INTEGER NOT NULL DEFAULT 0", "paid_at TEXT", "provider_ref TEXT", "marketing INTEGER NOT NULL DEFAULT 0",
    "move_quote INTEGER NOT NULL DEFAULT 0", "review_token TEXT", "review_sent_at TEXT",
    "edit_token TEXT", "remind_count INTEGER NOT NULL DEFAULT 0", "remind_at TEXT"]) {
    try { db.exec("ALTER TABLE leads ADD COLUMN " + col); } catch { /* כבר קיים */ }
  }
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_edit ON leads(edit_token)"); } catch { /* */ }
  const now = () => new Date().toISOString();

  const q = {
    insertLead: db.prepare("INSERT INTO leads (ref, created_at, service, new_city, move_date, data, status, amount, marketing, move_quote, review_token, edit_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    markPaid: db.prepare("UPDATE leads SET status = 'new', paid_at = ?, provider_ref = ? WHERE id = ? AND status = 'awaiting_payment'"),
    purgePending: db.prepare("DELETE FROM leads WHERE status = 'awaiting_payment' AND created_at < ?"),
    bump: db.prepare("INSERT INTO counters (day, key, n) VALUES (?, ?, 1) ON CONFLICT(day, key) DO UPDATE SET n = n + 1"),
    countersSince: db.prepare("SELECT key, SUM(n) AS n FROM counters WHERE day >= ? GROUP BY key"),
    since: db.prepare("SELECT * FROM leads WHERE created_at >= ? ORDER BY created_at DESC"),
    insertTask: db.prepare("INSERT INTO tasks (lead_id, body_id, title, status, updated_at) VALUES (?, ?, ?, ?, ?)"),
    insertEvent: db.prepare("INSERT INTO events (lead_id, at, type, detail) VALUES (?, ?, ?, ?)"),
    byRef: db.prepare("SELECT * FROM leads WHERE ref = ?"),
    list: db.prepare("SELECT * FROM leads WHERE (? = '' OR status = ?) ORDER BY created_at DESC LIMIT ? OFFSET ?"),
    count: db.prepare("SELECT status, COUNT(*) AS n FROM leads GROUP BY status"),
    tasks: db.prepare("SELECT * FROM tasks WHERE lead_id = ? ORDER BY rowid"),
    events: db.prepare("SELECT * FROM events WHERE lead_id = ? ORDER BY id DESC LIMIT 50"),
    setTask: db.prepare("UPDATE tasks SET status = ?, note = ?, updated_at = ? WHERE lead_id = ? AND body_id = ?"),
    setStatus: db.prepare("UPDATE leads SET status = ? WHERE id = ?"),
    del: db.prepare("DELETE FROM leads WHERE id = ?"),
    byEdit: db.prepare("SELECT * FROM leads WHERE edit_token = ?"),
    setData: db.prepare("UPDATE leads SET data = ? WHERE id = ?"),
    reminded: db.prepare("UPDATE leads SET remind_count = remind_count + 1, remind_at = ? WHERE id = ?"),
    stopRemind: db.prepare("UPDATE leads SET remind_count = 99 WHERE id = ?"),
    remindCandidates: db.prepare("SELECT * FROM leads WHERE edit_token IS NOT NULL AND remind_count < 2 AND status NOT IN ('awaiting_payment', 'done')"),
    addCallback: db.prepare("INSERT INTO callbacks (lead_id, body_id, title, day, slot, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    callbacksFor: db.prepare("SELECT * FROM callbacks WHERE lead_id = ? ORDER BY day, slot"),
    openCallbackCount: db.prepare("SELECT COUNT(*) AS n FROM callbacks WHERE lead_id = ? AND status = 'todo'"),
    callbacksList: db.prepare("SELECT c.*, l.ref, l.data FROM callbacks c JOIN leads l ON l.id = c.lead_id WHERE (? = '' OR c.status = ?) ORDER BY c.day, c.slot LIMIT 500"),
    setCallback: db.prepare("UPDATE callbacks SET status = ?, updated_at = ? WHERE id = ?"),
    purge: db.prepare("DELETE FROM leads WHERE COALESCE(move_date, substr(created_at, 1, 10)) < ?")
  };

  return {
    raw: db,
    createLead({ ref, service, newCity, moveDate, data, tasks, status = "new", amount = 0, marketing = false, moveQuote = false, reviewToken = null, editToken = null, onCreate }) {
      db.exec("BEGIN");
      try {
        const r = q.insertLead.run(ref, now(), service, newCity, moveDate, data, status, amount, marketing ? 1 : 0, moveQuote ? 1 : 0, reviewToken, editToken);
        const id = Number(r.lastInsertRowid);
        for (const t of tasks) q.insertTask.run(id, t.id, t.title, t.status, now());
        q.insertEvent.run(id, now(), "created", service);
        if (onCreate) onCreate(id);
        db.exec("COMMIT");
        return id;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    event(leadId, type, detail) { q.insertEvent.run(leadId, now(), type, detail == null ? null : String(detail).slice(0, 500)); },
    byRef: (ref) => q.byRef.get(ref),
    byEdit: (token) => (token ? q.byEdit.get(String(token)) : undefined),
    setData: (id, data) => q.setData.run(data, id),
    reminded: (id) => q.reminded.run(now(), id),
    stopRemind: (id) => q.stopRemind.run(id),
    remindCandidates: () => q.remindCandidates.all(),
    addCallback: (leadId, c) => Number(q.addCallback.run(leadId, c.body, c.title, c.day, c.slot, c.note || null, now(), now()).lastInsertRowid),
    callbacksFor: (leadId) => q.callbacksFor.all(leadId),
    openCallbackCount: (leadId) => q.openCallbackCount.get(leadId).n,
    callbacksList: (status = "") => q.callbacksList.all(status, status),
    setCallback: (id, status) => q.setCallback.run(status, now(), id),
    list: ({ status = "", limit = 50, offset = 0 } = {}) => q.list.all(status, status, limit, offset),
    counts: () => Object.fromEntries(q.count.all().map((r) => [r.status, r.n])),
    tasks: (id) => q.tasks.all(id),
    events: (id) => q.events.all(id),
    setTask: (id, bodyId, status, note) => q.setTask.run(status, note || null, now(), id, bodyId),
    setStatus: (id, status) => q.setStatus.run(status, id),
    remove: (id) => q.del.run(id),
    markPaid: (id, providerRef) => Number(q.markPaid.run(now(), providerRef || null, id).changes),
    purgePending(hours) { return Number(q.purgePending.run(new Date(Date.now() - hours * 3600e3).toISOString()).changes); },
    bump: (key) => q.bump.run(now().slice(0, 10), String(key).slice(0, 60)),
    counters(days) { return Object.fromEntries(q.countersSince.all(new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)).map((r) => [r.key, r.n])); },
    since: (days) => q.since.all(new Date(Date.now() - days * 864e5).toISOString()),
    purgeOlderThan(days) {
      const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      return Number(q.purge.run(cutoff).changes);
    },
    close: () => db.close()
  };
}
