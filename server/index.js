import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'todotime.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  color TEXT NOT NULL DEFAULT '#247b75',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_at TEXT,
  end_at TEXT,
  task_date TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  tags TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'shared',
  assignment TEXT NOT NULL DEFAULT 'owner',
  recurrence TEXT,
  recurrence_parent_id INTEGER REFERENCES tasks(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  task_id INTEGER REFERENCES tasks(id),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS task_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  occurrence_date TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'skip',
  override_json TEXT,
  UNIQUE(task_id, occurrence_date)
);
`);
try { db.exec('ALTER TABLE tasks ADD COLUMN task_date TEXT'); } catch { /* already exists */ }

const purgeExpiredTrash = () => {
  const expired = db.prepare("SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND datetime(deleted_at) < datetime('now', '-30 day')").all();
  if (!expired.length) return;
  const remove = db.transaction((rows) => {
    for (const row of rows) {
      db.prepare('DELETE FROM comments WHERE task_id=?').run(row.id);
      db.prepare('DELETE FROM task_exceptions WHERE task_id=?').run(row.id);
      db.prepare('DELETE FROM notifications WHERE task_id=?').run(row.id);
      db.prepare('DELETE FROM tasks WHERE id=?').run(row.id);
    }
  });
  remove(expired);
};
purgeExpiredTrash();
setInterval(purgeExpiredTrash, 24 * 60 * 60 * 1000).unref();

const PORT = Number(process.env.PORT || 3030);
const JWT_SECRET = process.env.JWT_SECRET || 'todotime-local-secret-change-me';
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const nowIso = () => new Date().toISOString();
const toUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, color: u.color });
const publicTask = (t, currentUserId, occurrenceDate = null) => {
  const isPrivate = t.visibility === 'private' && t.owner_id !== currentUserId;
  const tags = (() => { try { return JSON.parse(t.tags || '[]'); } catch { return []; } })();
  return {
    id: t.id,
    occurrenceId: occurrenceDate ? `${t.id}:${occurrenceDate}` : String(t.id),
    occurrenceDate,
    ownerId: t.owner_id,
    ownerName: t.owner_name,
    ownerColor: t.owner_color,
    title: isPrivate ? '私人安排' : t.title,
    description: isPrivate ? '' : t.description,
    startAt: isPrivate ? t.start_at : t.start_at,
    endAt: isPrivate ? t.end_at : t.end_at,
    taskDate: occurrenceDate || t.task_date || (t.start_at ? t.start_at.slice(0, 10) : null),
    allDay: Boolean(t.all_day),
    status: t.status,
    priority: t.priority,
    tags: isPrivate ? [] : tags,
    visibility: t.visibility,
    assignment: t.assignment,
    recurrence: t.recurrence ? JSON.parse(t.recurrence) : null,
    deletedAt: t.deleted_at,
    isPrivateMasked: isPrivate,
    updatedAt: t.updated_at
  };
};
const auth = (req, res, next) => {
  const token = req.cookies.tt_session || (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(401).json({ error: '登录已过期，请重新登录' }); }
};
const issue = (res, user) => {
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('tt_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000 });
};
const notifyOther = (userId, type, title, body, taskId = null) => {
  const other = db.prepare('SELECT id FROM users WHERE id != ? ORDER BY id LIMIT 1').get(userId);
  if (!other) return;
  db.prepare('INSERT INTO notifications (user_id,type,title,body,task_id) VALUES (?,?,?,?,?)').run(other.id, type, title, body, taskId);
};
const taskRow = (id) => db.prepare(`SELECT t.*, u.display_name AS owner_name, u.color AS owner_color FROM tasks t JOIN users u ON u.id=t.owner_id WHERE t.id=?`).get(id);
const parseDate = (value) => value ? new Date(value) : null;
const formatLocalDate = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const expandTasks = (rows, from, to, currentUserId) => {
  const fromDate = new Date(`${from}T00:00:00+08:00`);
  const toDate = new Date(`${to}T23:59:59+08:00`);
  const output = [];
  for (const row of rows) {
    const recurrence = row.recurrence ? JSON.parse(row.recurrence) : null;
    if (!recurrence && row.all_day && row.start_at && row.end_at) {
      const startDay = row.task_date || row.start_at.slice(0, 10);
      const endDay = row.end_at.slice(0, 10);
      const cursor = new Date(`${startDay}T00:00:00+08:00`);
      let guard = 0;
      while (formatLocalDate(cursor) <= endDay && guard < 730) {
        const day = formatLocalDate(cursor);
        if (day >= from && day <= to) output.push(publicTask({ ...row, task_date: day }, currentUserId, day));
        cursor.setUTCDate(cursor.getUTCDate() + 1); guard += 1;
      }
      continue;
    }
    if (!recurrence || !row.start_at) {
      const day = row.task_date || (row.start_at ? row.start_at.slice(0, 10) : null);
      if (!day || (day >= from && day <= to)) output.push(publicTask(row, currentUserId));
      continue;
    }
    const base = new Date(row.start_at);
    const duration = row.end_at ? new Date(row.end_at).getTime() - base.getTime() : 0;
    const until = recurrence.until ? new Date(`${recurrence.until}T23:59:59+08:00`) : toDate;
    const cursor = new Date(base);
    let guard = 0;
    while (cursor <= toDate && cursor <= until && guard < 730) {
      if (cursor >= fromDate || new Date(cursor.getTime() + duration) >= fromDate) {
        const day = formatLocalDate(cursor);
        const exception = db.prepare('SELECT * FROM task_exceptions WHERE task_id=? AND occurrence_date=?').get(row.id, day);
        if (!exception || exception.action !== 'skip') {
          const occurrence = { ...row, task_date: day, start_at: cursor.toISOString(), end_at: row.end_at ? new Date(cursor.getTime() + duration).toISOString() : null };
          if (exception?.override_json) Object.assign(occurrence, JSON.parse(exception.override_json));
          output.push(publicTask(occurrence, currentUserId, day));
        }
      }
      if (recurrence.frequency === 'daily') cursor.setUTCDate(cursor.getUTCDate() + (Number(recurrence.interval) || 1));
      else if (recurrence.frequency === 'weekly') cursor.setUTCDate(cursor.getUTCDate() + 7 * (Number(recurrence.interval) || 1));
      else if (recurrence.frequency === 'monthly') cursor.setUTCMonth(cursor.getUTCMonth() + (Number(recurrence.interval) || 1));
      else break;
      guard += 1;
    }
  }
  return output;
};

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'todotime' }));
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  res.json({ user: toUser(user), count: db.prepare('SELECT COUNT(*) AS count FROM users').get().count });
});
app.post('/api/auth/register', (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !password || password.length < 6) return res.status(400).json({ error: '用户名不能为空，密码至少 6 位' });
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count >= 2) return res.status(403).json({ error: '当前空间已达到两位成员上限' });
  try {
    const info = db.prepare('INSERT INTO users (username,display_name,password_hash,role,color) VALUES (?,?,?,?,?)').run(username.trim(), (displayName || username).trim(), bcrypt.hashSync(password, 12), count === 0 ? 'admin' : 'member', count === 0 ? '#247b75' : '#db7b47');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    issue(res, user); res.status(201).json({ user: toUser(user), count: count + 1 });
  } catch { res.status(409).json({ error: '用户名已存在' }); }
});
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: '用户名或密码不正确' });
  issue(res, user); res.json({ user: toUser(user), count: db.prepare('SELECT COUNT(*) AS count FROM users').get().count });
});
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('tt_session'); res.json({ ok: true }); });
app.post('/api/auth/reset-password', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '只有管理员可以重置密码' });
  const { userId, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  const target = db.prepare('SELECT id FROM users WHERE id=?').get(userId);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword, 12), userId);
  res.json({ ok: true });
});

app.get('/api/users', auth, (_req, res) => res.json({ users: db.prepare('SELECT * FROM users ORDER BY id').all().map(toUser) }));

app.get('/api/tasks', auth, (req, res) => {
  const from = req.query.from || formatLocalDate(new Date());
  const to = req.query.to || from;
  const includeDeleted = req.query.deleted === '1';
  const rows = db.prepare(`SELECT t.*, u.display_name AS owner_name, u.color AS owner_color FROM tasks t JOIN users u ON u.id=t.owner_id WHERE ((?=1 AND t.deleted_at IS NOT NULL) OR (?=0 AND t.deleted_at IS NULL)) ORDER BY COALESCE(t.start_at,'9999')`).all(includeDeleted ? 1 : 0, includeDeleted ? 1 : 0);
  const tasks = includeDeleted ? rows.map((r) => publicTask(r, req.user.id)) : expandTasks(rows, from, to, req.user.id);
  res.json({ tasks });
});
app.post('/api/tasks', auth, (req, res) => {
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: '请输入任务标题' });
  const recurrence = b.recurrence ? JSON.stringify(b.recurrence) : null;
  const info = db.prepare(`INSERT INTO tasks (owner_id,title,description,start_at,end_at,task_date,all_day,priority,tags,visibility,assignment,recurrence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, b.title.trim(), b.description || '', b.startAt || null, b.endAt || null, b.taskDate || (b.startAt ? b.startAt.slice(0, 10) : null), b.allDay ? 1 : 0, b.priority || 'normal', JSON.stringify(b.tags || []), b.visibility === 'private' ? 'private' : 'shared', b.assignment || 'owner', recurrence);
  const row = taskRow(info.lastInsertRowid); notifyOther(req.user.id, 'task_created', '新的日程安排', `${row.owner_name} 添加了「${b.title.trim()}」`, row.id);
  res.status(201).json({ task: publicTask(row, req.user.id) });
});
app.put('/api/tasks/:id', auth, (req, res) => {
  const id = Number(req.params.id); const row = taskRow(id);
  if (!row || row.deleted_at) return res.status(404).json({ error: '任务不存在' });
  const b = req.body || {}; const scope = b.scope || 'all';
  if (scope === 'this' && b.occurrenceDate && row.recurrence) {
    const overrides = { title: b.title, description: b.description, start_at: b.startAt, end_at: b.endAt, all_day: b.allDay ? 1 : 0, priority: b.priority, tags: JSON.stringify(b.tags || []) };
    db.prepare(`INSERT INTO task_exceptions(task_id,occurrence_date,action,override_json) VALUES(?,?,?,?) ON CONFLICT(task_id,occurrence_date) DO UPDATE SET action=excluded.action, override_json=excluded.override_json`).run(id, b.occurrenceDate, 'override', JSON.stringify(overrides));
  } else if (scope === 'future' && b.occurrenceDate && row.recurrence) {
    const rec = row.recurrence ? JSON.parse(row.recurrence) : null;
    const until = new Date(`${b.occurrenceDate}T00:00:00+08:00`); until.setDate(until.getDate() - 1);
    db.prepare('UPDATE tasks SET recurrence=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...rec, until: formatLocalDate(until) }), nowIso(), id);
    const info = db.prepare(`INSERT INTO tasks (owner_id,title,description,start_at,end_at,task_date,all_day,priority,tags,visibility,assignment,recurrence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.owner_id, b.title ?? row.title, b.description ?? row.description, b.startAt ?? row.start_at, b.endAt ?? row.end_at, b.taskDate ?? b.occurrenceDate ?? row.task_date, b.allDay === undefined ? row.all_day : (b.allDay ? 1 : 0), b.priority ?? row.priority, JSON.stringify(b.tags ?? JSON.parse(row.tags || '[]')), b.visibility ?? row.visibility, b.assignment ?? row.assignment, row.recurrence);
    const newRow = taskRow(info.lastInsertRowid); notifyOther(req.user.id, 'task_updated', '日程已更新', `${newRow.owner_name} 更新了「${newRow.title}」`, newRow.id); return res.json({ task: publicTask(newRow, req.user.id) });
  } else {
    db.prepare(`UPDATE tasks SET title=?,description=?,start_at=?,end_at=?,task_date=?,all_day=?,priority=?,tags=?,visibility=?,assignment=?,recurrence=?,status=?,updated_at=? WHERE id=?`).run(b.title ?? row.title, b.description ?? row.description, b.startAt === undefined ? row.start_at : (b.startAt || null), b.endAt === undefined ? row.end_at : (b.endAt || null), b.taskDate ?? (b.startAt ? b.startAt.slice(0, 10) : row.task_date), b.allDay === undefined ? row.all_day : (b.allDay ? 1 : 0), b.priority ?? row.priority, JSON.stringify(b.tags ?? JSON.parse(row.tags || '[]')), b.visibility ?? row.visibility, b.assignment ?? row.assignment, b.recurrence === undefined ? row.recurrence : (b.recurrence ? JSON.stringify(b.recurrence) : null), b.status ?? row.status, nowIso(), id);
  }
  const updated = taskRow(id); notifyOther(req.user.id, 'task_updated', '日程已更新', `${updated.owner_name} 更新了「${updated.title}」`, id); res.json({ task: publicTask(updated, req.user.id) });
});
app.post('/api/tasks/:id/complete', auth, (req, res) => {
  const id = Number(req.params.id); const row = taskRow(id); if (!row) return res.status(404).json({ error: '任务不存在' });
  if (row.recurrence && req.body?.occurrenceDate) {
    const existing = db.prepare('SELECT * FROM task_exceptions WHERE task_id=? AND occurrence_date=?').get(id, req.body.occurrenceDate);
    const override = existing?.override_json ? JSON.parse(existing.override_json) : {};
    override.status = override.status === 'done' ? 'open' : 'done';
    db.prepare(`INSERT INTO task_exceptions(task_id,occurrence_date,action,override_json) VALUES(?,?,?,?) ON CONFLICT(task_id,occurrence_date) DO UPDATE SET action=excluded.action,override_json=excluded.override_json`).run(id, req.body.occurrenceDate, 'override', JSON.stringify(override));
    return res.json({ task: publicTask({ ...row, ...override }, req.user.id, req.body.occurrenceDate) });
  }
  db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(row.status === 'done' ? 'open' : 'done', nowIso(), id); res.json({ task: publicTask(taskRow(id), req.user.id) });
});
app.delete('/api/tasks/:id', auth, (req, res) => {
  const id = Number(req.params.id); const row = taskRow(id); if (!row) return res.status(404).json({ error: '任务不存在' });
  db.prepare('UPDATE tasks SET deleted_at=?,updated_at=? WHERE id=?').run(nowIso(), nowIso(), id); notifyOther(req.user.id, 'task_deleted', '任务移入回收站', `「${row.title}」已被移入回收站`, id); res.json({ ok: true });
});
app.post('/api/tasks/:id/restore', auth, (req, res) => { const id = Number(req.params.id); db.prepare('UPDATE tasks SET deleted_at=NULL,updated_at=? WHERE id=?').run(nowIso(), id); res.json({ ok: true }); });
app.delete('/api/tasks/:id/permanent', auth, (req, res) => { const id = Number(req.params.id); db.prepare('DELETE FROM tasks WHERE id=?').run(id); res.json({ ok: true }); });

app.get('/api/tasks/:id/comments', auth, (req, res) => {
  const comments = db.prepare(`SELECT c.*, u.display_name AS user_name, u.color AS user_color FROM comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.created_at`).all(Number(req.params.id));
  res.json({ comments: comments.map((c) => ({ id: c.id, taskId: c.task_id, userId: c.user_id, userName: c.user_name, userColor: c.user_color, body: c.body, createdAt: c.created_at })) });
});
app.post('/api/tasks/:id/comments', auth, (req, res) => {
  if (!req.body?.body?.trim()) return res.status(400).json({ error: '评论不能为空' });
  const id = Number(req.params.id); const info = db.prepare('INSERT INTO comments(task_id,user_id,body) VALUES(?,?,?)').run(id, req.user.id, req.body.body.trim());
  const other = db.prepare('SELECT id FROM users WHERE id != ? LIMIT 1').get(req.user.id); if (other) db.prepare('INSERT INTO notifications(user_id,type,title,body,task_id) VALUES(?,?,?,?,?)').run(other.id, 'comment', '任务有新评论', req.body.body.trim(), id);
  const c = db.prepare(`SELECT c.*,u.display_name AS user_name,u.color AS user_color FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?`).get(info.lastInsertRowid);
  res.status(201).json({ comment: { id: c.id, taskId: c.task_id, userId: c.user_id, userName: c.user_name, userColor: c.user_color, body: c.body, createdAt: c.created_at } });
});
app.delete('/api/comments/:id', auth, (req, res) => { db.prepare('DELETE FROM comments WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id); res.json({ ok: true }); });

app.get('/api/notifications', auth, (req, res) => {
  const list = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ notifications: list.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, taskId: n.task_id, read: Boolean(n.read_at), createdAt: n.created_at })) });
});
app.post('/api/notifications/read', auth, (req, res) => { db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND (id=? OR ?=0)').run(nowIso(), req.user.id, Number(req.body?.id || 0), Number(req.body?.id || 0)); res.json({ ok: true }); });

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res, next) => req.path.startsWith('/api') ? next() : res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, '0.0.0.0', () => console.log(`TodoTime API listening on http://0.0.0.0:${PORT}`));
