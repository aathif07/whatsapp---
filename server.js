// Multi-WhatsApp attendance demo: API, simulated WhatsApp and React UI on one port.
import express from 'express';
import http from 'node:http';
import { randomUUID as id } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const PORT = Number(process.env.PORT || 4600);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FILE = here('./data/demo.json');
const now = () => Date.now();
const MIN = 60_000;
const day = (t = now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t);
const clock = (t) => t ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }).format(t) : '';

// ---------- storage ----------
let db;
const save = () => { mkdirSync(here('./data'), { recursive: true }); writeFileSync(FILE + '.tmp', JSON.stringify(db)); renameSync(FILE + '.tmp', FILE); };
let timer;
const io = new Server();
/** Persist soon and tell open dashboards to refresh. */
function changed() { if (!timer) timer = setTimeout(() => { timer = null; save(); io.emit('changed'); }, 100); }
const find = (list, key) => { const x = db[list].find((r) => r.id === key); if (!x) throw Object.assign(new Error('Not found'), { status: 404 }); return x; };
const bad = (m, status = 400) => { throw Object.assign(new Error(m), { status }); };
const str = (v, label, max = 1000) => { const s = String(v ?? '').trim(); if (!s) bad(`${label} is required.`); if (s.length > max) bad(`${label} is too long.`); return s; };
const phone = (v) => { const d = String(v ?? '').replace(/\D/g, ''); if (d.length < 10 || d.length > 15) bad('Enter the number with country code, for example +91 98765 43210.'); return '+' + d; };
const log = (action, detail = '') => { db.logs.unshift({ id: id(), at: now(), action, detail }); db.logs.length = Math.min(db.logs.length, 500); };

function seed() {
  const names = ['Aathif', 'Kumar', 'Rahul', 'Arjun', 'Vimal', 'Priya', 'Divya', 'Karthik', 'Meena', 'Suresh', 'Anitha', 'Naveen', 'Lakshmi', 'Farhan', 'Deepa', 'Ganesh', 'Nisha', 'Manoj', 'Revathi', 'Imran', 'Sandhya', 'Vijay', 'Kavya', 'Ashok', 'Swathi', 'Dinesh', 'Yamini', 'Harish', 'Pooja', 'Balaji'];
  db = { nextUser: 1, accounts: [], users: [], messages: [], sessions: [], records: [], logs: [],
    settings: { minutes: 30, requireLocation: true, office: null, message: 'Hey {{name}} 😃,\nThis is a reminder to check in for your scheduled shift today. Reply "In" to confirm your attendance.' } };
  for (let i = 0; i < 10; i++) db.accounts.push({ id: id(), name: `Account ${String(i + 1).padStart(2, '0')}`, phone: `+9190000000${String(i + 1).padStart(2, '0')}`, connected: i < 8, createdAt: now(), changedAt: now() });
  names.forEach((name, i) => addUser({ name, phone: `+9198000000${String(i + 1).padStart(2, '0')}`, accountId: db.accounts[i % 8].id, active: true }));
  for (let d = 7; d >= 1; d--) { // a week of sample history
    const start = now() - d * 24 * 60 * MIN;
    const s = { id: id(), title: 'Daily attendance', status: 'completed', message: db.settings.message, accountIds: db.accounts.slice(0, 8).map((a) => a.id), minutes: 30, startedAt: start, endsAt: start + 30 * MIN, finalizedAt: start + 30 * MIN };
    db.sessions.push(s);
    db.users.forEach((u, i) => {
      const r = newRecord(s, u), present = (i * 7 + d * 5) % 9 > 1;
      Object.assign(r, { sentAt: start + i * 300, delivery: present || i % 2 ? 'read' : 'delivered', status: present ? 'present' : 'absent', reply: present ? 'Present' : '', repliedAt: present ? start + (2 + i % 20) * MIN : null });
    });
  }
  ['Good morning, I will be 10 minutes late.', 'Can you share the schedule for today?', 'Thank you!'].forEach((t, i) => addMessage(db.users[i], 'in', t, { at: now() - (i + 1) * 9 * MIN, read: i > 1 }));
  log('Demo data created', '10 accounts, 30 users');
}
function addUser(u) { const r = { id: id(), code: `USR-${String(db.nextUser++).padStart(4, '0')}`, createdAt: now(), ...u }; db.users.push(r); return r; }
function newRecord(s, u) {
  const a = find('accounts', u.accountId);
  const r = { id: id(), sessionId: s.id, userId: u.id, code: u.code, name: u.name, phone: u.phone, accountId: a.id, account: a.name, delivery: 'queued', sentAt: null, status: 'pending', reply: '', repliedAt: null, lateReply: '', lateAt: null, token: id(), askedAt: null, checkedAt: null, location: null, lateBy: null };
  db.records.push(r); return r;
}
function addMessage(u, dir, text, extra = {}) {
  const m = { id: id(), userId: u.id, accountId: u.accountId, dir, text, at: now(), status: dir === 'out' ? 'sending' : 'received', read: dir === 'out', ...extra };
  db.messages.push(m); return m;
}

// ---------- simulated WhatsApp ----------
const isConnected = (aid) => db.accounts.find((a) => a.id === aid)?.connected;
const record = (m) => m.recordId && db.records.find((r) => r.id === m.recordId);
const typing = new Map(); // "user:<id>" or "bot:<id>" -> pending count
function typeThen(key, ms, fn) {
  typing.set(key, (typing.get(key) ?? 0) + 1); changed();
  setTimeout(() => { const n = typing.get(key) - 1; n ? typing.set(key, n) : typing.delete(key); changed(); fn(); }, ms);
}
function botSay(u, text, extra = {}) {
  typeThen('bot:' + u.id, 900 + Math.random() * 700, () => { if (db.users.includes(u)) sendMessage(u, text, { system: true, ...extra }); });
}
function botAnswer(u, text) {
  const mine = db.records.filter((r) => r.userId === u.id && r.sentAt && day(r.sentAt) === day()).at(-1);
  if (/^(in|present|status|attendance)\b/i.test(text.trim())) return botSay(u, mine?.status === 'present' ? 'You are already checked in for today ✅' : mine?.status === 'absent' ? 'The attendance window has closed. You are marked Absent. Please contact your administrator.' : 'There is no attendance session open right now. You will get a reminder when it starts.');
  if (/\b(hi|hey|hello|vanakkam)\b/i.test(text)) return botSay(u, `Hello ${u.name} 👋\nReply "In" when you get the attendance reminder, or send "status" to see today's attendance.`);
  // Anything else is left for the administrator to answer.
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function deliver(m) {
  const set = (status) => { m.status = status; const r = record(m); if (r) { r.delivery = status; if (status === 'sent') r.sentAt = m.at; } changed(); };
  if (!isConnected(m.accountId)) return set('failed');
  setTimeout(() => { if (m.status === 'sending') set('sent'); }, 250);
  setTimeout(() => { if (m.status === 'sent') set('delivered'); }, 900);
  // It becomes "read" only when the person opens the chat (see /me/read).
}
function sendMessage(u, text, extra) {
  const m = addMessage(u, 'out', text, extra); changed(); deliver(m); return m;
}
/** Every inbound reply passes through here; this is where attendance is decided. */
function receive(u, text) {
  if (!isConnected(u.accountId)) return false;
  const m = addMessage(u, 'in', text);
  const mine = db.records.filter((r) => r.userId === u.id && r.accountId === u.accountId && r.sentAt);
  const open = mine.find((r) => r.status === 'pending' && db.sessions.some((s) => s.id === r.sessionId && s.status === 'active' && m.at <= s.endsAt));
  if (open) {
    const s = find('sessions', open.sessionId);
    open.delivery = 'read';
    if (!open.repliedAt) {
      Object.assign(open, { reply: text, repliedAt: m.at });
      if (s.requireLocation) {
        open.askedAt = now();
        askLocation(u, open);
      } else markPresent(open, u);
    }
    else if (s.requireLocation) askLocation(u, open);
    const out = db.messages.find((x) => x.recordId === open.id); if (out) out.status = 'read';
  } else {
    // After the window closes, keep the same-day reply separately without changing the result.
    const late = mine.filter((r) => r.status === 'absent').sort((a, b) => b.sentAt - a.sentAt)[0];
    if (late && !late.lateAt && day(late.sentAt) === day()) Object.assign(late, { lateReply: text, lateAt: m.at });
  }
  if (!open) botAnswer(u, text);
  changed(); return true;
}
const askLocation = (u, r) => botSay(u, 'Attach your current location 📍 to mark your attendance on below link', { kind: 'checkin', token: r.token });
function markPresent(r, u) {
  const s = find('sessions', r.sessionId);
  Object.assign(r, { status: 'present', checkedAt: now(), lateBy: Math.floor((r.repliedAt - s.startedAt) / 1000) });
  const mm = String(Math.floor(r.lateBy / 60)).padStart(2, '0'), ss = String(r.lateBy % 60).padStart(2, '0');
  botSay(u, `You've successfully been checked in!\n${r.lateBy < 60 ? 'On time' : `Late by : ${mm}:${ss}m!`}`);
  log('Attendance marked present', u.name);
}
const metres = (a, b) => { const r = Math.PI / 180, h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
/** Second step: the user opened Mark Attendance and shared a location. */
function checkIn(token, lat, lng, accuracy) {
  const r = db.records.find((x) => x.token === token && x.askedAt);
  if (!r) bad('This check-in link is not valid.', 404);
  if (r.status === 'present') bad('You are already checked in.');
  const s = find('sessions', r.sessionId);
  if (s.status !== 'active' || now() > s.endsAt) bad('The attendance window has closed.');
  if (!isConnected(r.accountId)) bad('Attendance is unavailable right now. Please contact your administrator.');
  if (![lat, lng].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180) bad('Location is not valid.');
  const office = db.settings.office, distance = office ? Math.round(metres(office, { lat, lng })) : null;
  if (office && distance > office.radius) bad(`You are ${distance} m away. Check in within ${office.radius} m of the office.`);
  const u = find('users', r.userId);
  r.location = { lat, lng, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null, distance };
  addMessage(u, 'in', `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`, { kind: 'location', lat, lng });
  markPresent(r, u); changed(); return r;
}
function finalize(s, status = 'completed') {
  if (s.status !== 'active') return;
  s.status = status; s.finalizedAt = now();
  for (const r of db.records) if (r.sessionId === s.id && r.status === 'pending') r.status = status === 'completed' ? 'absent' : 'cancelled';
  log(`Attendance ${status}`, s.title); changed();
}
// Wall-clock check, so a session still ends correctly after a restart.
setInterval(() => { for (const s of db.sessions) if (s.status === 'active' && now() >= s.endsAt) finalize(s); }, 1000);

// ---------- views ----------
const summary = (rs) => {
  const c = (f) => rs.filter(f).length, present = c((r) => r.status === 'present');
  return { total: rs.length, accounts: new Set(rs.map((r) => r.accountId)).size, sent: c((r) => r.sentAt), delivered: c((r) => ['delivered', 'read'].includes(r.delivery)), failed: c((r) => r.delivery === 'failed'), present, absent: c((r) => r.status === 'absent'), pending: c((r) => r.status === 'pending'), percent: rs.length ? Math.round(present / rs.length * 1000) / 10 : 0 };
};
function state() {
  const bySession = Map.groupBy(db.records, (r) => r.sessionId);
  const sessions = [...db.sessions].sort((a, b) => b.startedAt - a.startedAt).map((s) => ({ ...s, date: day(s.startedAt), summary: summary(bySession.get(s.id) ?? []) }));
  const byUser = Map.groupBy(db.messages, (m) => m.userId);
  const conversations = db.users.filter((u) => u.accountId).map((u) => {
    const ms = (byUser.get(u.id) ?? []).filter((m) => m.accountId === u.accountId), last = ms.reduce((a, m) => !a || m.at >= a.at ? m : a, null);
    return { userId: u.id, accountId: u.accountId, last, unread: ms.filter((m) => !m.read).length, userUnread: ms.filter((m) => m.dir === 'out' && ['sent', 'delivered'].includes(m.status)).length };
  }).sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  const started = new Map(db.sessions.filter((s) => s.status === 'completed').map((s) => [s.id, s.startedAt]));
  const results = Map.groupBy(db.records.filter((r) => started.has(r.sessionId)).sort((a, b) => started.get(a.sessionId) - started.get(b.sessionId)), (r) => r.userId);
  const today = new Map(); // one result per user even if several sessions ran today
  const todays = new Set(sessions.filter((s) => s.date === day() && s.status !== 'cancelled').map((s) => s.id));
  for (const r of db.records) if (todays.has(r.sessionId)) { const prev = today.get(r.userId); if (prev !== 'present') today.set(r.userId, r.status); }
  const n = (v) => [...today.values()].filter((x) => x === v).length;
  return { now: now(), typing: [...typing.keys(), ...typers.keys()], accounts: db.accounts, users: db.users.map((u) => { const rs = results.get(u.id) ?? [], p = rs.filter((r) => r.status === 'present').length; return { ...u, sessions: rs.length, presents: p, rate: rs.length ? Math.round(p / rs.length * 100) : null, recent: rs.slice(-7).map((r) => r.status), today: today.get(u.id) ?? null }; }), settings: db.settings, sessions, conversations, logs: db.logs.slice(0, 100),
    records: db.records.filter((r) => db.sessions.some((s) => s.id === r.sessionId && s.status === 'active')),
    recentMessages: db.messages.filter((m) => m.dir === 'in').sort((a, b) => b.at - a.at).slice(0, 6),
    recentAttendance: db.records.filter((r) => r.status === 'present').sort((a, b) => (b.checkedAt ?? b.repliedAt) - (a.checkedAt ?? a.repliedAt)).slice(0, 6),
    today: { total: today.size, present: n('present'), absent: n('absent'), pending: n('pending'), percent: today.size ? Math.round(n('present') / today.size * 1000) / 10 : 0 } };
}

// ---------- API ----------
const app = express(), api = express.Router();
app.use(express.json({ limit: '200kb' })); app.use('/api', api);
api.get('/health', (q, r) => r.json({ ok: true }));
api.get('/state', (q, r) => r.json(state()));
api.get('/checkin/:token', (q, r) => { const x = db.records.find((v) => v.token === q.params.token && v.askedAt); if (!x) bad('This check-in link is not valid.', 404); const s = find('sessions', x.sessionId); r.json({ name: x.name, status: x.status, lateBy: x.lateBy, endsAt: s.endsAt, open: s.status === 'active' }); });
api.post('/checkin/:token', (q, r) => { const x = checkIn(q.params.token, q.body.lat, q.body.lng, q.body.accuracy); r.json({ status: x.status, lateBy: x.lateBy }); });
api.get('/users/:id/messages', (q, r) => { const u = find('users', q.params.id); r.json(db.messages.filter((m) => m.userId === u.id && m.accountId === u.accountId).sort((a, b) => a.at - b.at)); });
api.post('/users/:id/read', (q, r) => { let hit = false; for (const m of db.messages) if (m.userId === q.params.id && !m.read) { m.read = true; hit = true; } if (hit) changed(); r.json({}); });
api.post('/users/:id/messages', (q, r) => {
  const u = find('users', q.params.id), text = str(q.body.text, 'Message', 4096);
  if (!isConnected(u.accountId)) bad('This WhatsApp account is disconnected. Connect it to send messages.');
  r.json(sendMessage(u, text));
});
// ---------- user login (each person sees only their own chat) ----------
const me = (q) => {
  const t = db.tokens?.[q.get('x-user-token') ?? ''], u = t && db.users.find((x) => x.id === t);
  if (!u) bad('Please sign in.', 401);
  return u;
};
api.post('/me/login', (q, r) => {
  const u = find('users', q.body.userId); // demo: clicking a person opens their chat, no password
  const token = id() + id(); (db.tokens ??= {})[token] = u.id; log('User signed in', u.name); changed(); r.json({ token });
});
api.post('/me/logout', (q, r) => { me(q); delete db.tokens[q.get('x-user-token')]; changed(); r.json({}); });
api.get('/me', (q, r) => {
  const u = me(q), a = find('accounts', u.accountId);
  const rec = db.records.filter((x) => x.userId === u.id && db.sessions.some((s) => s.id === x.sessionId && s.status !== 'cancelled' && day(s.startedAt) === day())).at(-1);
  r.json({ user: { id: u.id, name: u.name, phone: u.phone }, account: { name: a.name, connected: a.connected }, today: rec?.status ?? null, typing: typing.has('bot:' + u.id) || typers.has('bot:' + u.id),
    messages: db.messages.filter((m) => m.userId === u.id && m.accountId === u.accountId).sort((x, y) => x.at - y.at) });
});
api.post('/me/messages', (q, r) => { if (!receive(me(q), str(q.body.text, 'Message', 4096))) bad('This account is offline. Try again later.'); r.json({}); });
api.post('/me/read', (q, r) => {
  const u = me(q); let hit = false;
  for (const m of db.messages) if (m.userId === u.id && m.dir === 'out' && m.status === 'delivered') { m.status = 'read'; const x = record(m); if (x) x.delivery = 'read'; hit = true; }
  if (hit) changed(); r.json({});
});
api.get('/users/:id/history', (q, r) => r.json(db.records.filter((x) => x.userId === q.params.id).map((x) => ({ ...x, session: find('sessions', x.sessionId) })).sort((a, b) => b.session.startedAt - a.session.startedAt)));

const accountBody = (b, self) => { const v = { name: str(b.name, 'Account name', 60), phone: phone(b.phone) }; if (db.accounts.some((a) => a.phone === v.phone && a.id !== self)) bad('That number is already connected.'); return v; };
api.post('/accounts', (q, r) => { const a = { id: id(), ...accountBody(q.body), connected: true, createdAt: now(), changedAt: now() }; db.accounts.push(a); log('Account added', a.name); changed(); r.json(a); });
api.put('/accounts/:id', (q, r) => { const a = find('accounts', q.params.id); Object.assign(a, accountBody(q.body, a.id)); log('Account edited', a.name); changed(); r.json(a); });
api.post('/accounts/:id/toggle', (q, r) => { const a = find('accounts', q.params.id); a.connected = !a.connected; a.changedAt = now(); log(a.connected ? 'Account connected' : 'Account disconnected', a.name); changed(); r.json(a); });
api.delete('/accounts/:id', (q, r) => {
  const a = find('accounts', q.params.id);
  if (db.sessions.some((s) => s.status === 'active' && s.accountIds.includes(a.id))) bad('Finish the active attendance session first.');
  if (db.users.some((u) => u.accountId === a.id)) bad('Move this account’s users to another account first.');
  db.accounts = db.accounts.filter((x) => x !== a); log('Account deleted', a.name); changed(); r.json({});
});

const inActive = (uid) => db.records.some((x) => x.userId === uid && x.status === 'pending');
const userBody = (b, self) => { const v = { name: str(b.name, 'Name', 80), phone: phone(b.phone), accountId: find('accounts', b.accountId).id, active: !!b.active }; if (db.users.some((u) => u.phone === v.phone && u.id !== self)) bad('Another user already has that number.'); return v; };
api.post('/users', (q, r) => { const u = addUser(userBody(q.body)); log('User added', u.name); changed(); r.json(u); });
api.put('/users/:id', (q, r) => { const u = find('users', q.params.id), v = userBody(q.body, u.id); if (inActive(u.id) && (v.accountId !== u.accountId || v.phone !== u.phone)) bad('Finish the active attendance session before changing this user’s account or number.'); Object.assign(u, v); log('User edited', u.name); changed(); r.json(u); });
api.delete('/users/:id', (q, r) => { const u = find('users', q.params.id); if (inActive(u.id)) bad('This user is in an active attendance session.'); db.users = db.users.filter((x) => x !== u); db.messages = db.messages.filter((m) => m.userId !== u.id); log('User deleted', u.name); changed(); r.json({}); });

api.post('/sessions', (q, r) => {
  if (db.sessions.some((s) => s.status === 'active')) bad('An attendance session is already running.');
  const message = str(q.body.message, 'Message', 1024), minutes = Number(q.body.minutes);
  if (!(minutes >= 1 && minutes <= 240)) bad('Duration must be 1 to 240 minutes.');
  const ids = (q.body.accountIds ?? []).filter(isConnected);
  const users = db.users.filter((u) => u.active && ids.includes(u.accountId));
  if (!users.length) bad('No active users on the selected connected accounts.');
  const t = now(), s = { id: id(), title: String(q.body.title || 'Daily attendance').slice(0, 80), status: 'active', message, accountIds: ids, minutes, requireLocation: q.body.requireLocation !== false, startedAt: t, endsAt: t + minutes * MIN, finalizedAt: null };
  db.sessions.push(s); log('Attendance started', `${users.length} users`);
  users.forEach((u, i) => {
    const rec = newRecord(s, u);
    setTimeout(() => {
      const cur = db.users.find((x) => x.id === u.id);
      if (s.status !== 'active' || !cur) return;
      sendMessage(cur, message.replace(/\{\{\s*name\s*\}\}/g, () => cur.name).replace(/\{\{\s*date\s*\}\}/g, day()).replace(/\{\{\s*account\s*\}\}/g, () => rec.account), { recordId: rec.id });
    }, i * 120);
  });
  changed(); r.json(s);
});
api.post('/sessions/:id/finish', (q, r) => { finalize(find('sessions', q.params.id)); r.json({}); });
api.post('/sessions/:id/cancel', (q, r) => { finalize(find('sessions', q.params.id), 'cancelled'); r.json({}); });
api.get('/sessions/:id', (q, r) => { const s = find('sessions', q.params.id), rs = db.records.filter((x) => x.sessionId === s.id); r.json({ ...s, date: day(s.startedAt), records: rs, summary: summary(rs) }); });
api.put('/settings', (q, r) => { const m = Number(q.body.minutes); if (!(m >= 1 && m <= 240)) bad('Duration must be 1 to 240 minutes.'); const o = q.body.office; const office = o && o.lat !== '' && o.lng !== '' ? { lat: Number(o.lat), lng: Number(o.lng), radius: Number(o.radius) } : null; if (office && (!(Math.abs(office.lat) <= 90) || !(Math.abs(office.lng) <= 180) || !(office.radius >= 10))) bad('Enter a valid office location and a radius of at least 10 m.'); db.settings = { minutes: m, requireLocation: !!q.body.requireLocation, office, message: str(q.body.message, 'Message', 1024) }; log('Settings updated'); changed(); r.json({}); });
api.post('/reset', (q, r) => { if (db.sessions.some((s) => s.status === 'active')) bad('Finish the active attendance session first.'); seed(); changed(); r.json({}); });

const COLS = [['User ID', 'code', 11], ['User name', 'name', 16], ['WhatsApp number', 'phone', 17], ['Account', 'account', 13], ['Date', 'date', 12], ['Message sent', 'sent', 24], ['Delivery', 'delivery', 11], ['User reply', 'reply', 22], ['Reply received', 'replied', 24], ['Final status', 'status', 12], ['Location', 'place', 22], ['Checked in', 'checked', 24], ['Late by (mm:ss)', 'lateBy', 14], ['Late reply', 'late', 22]];
api.get('/export.:format', async (q, r) => {
  const { session, from, to, account } = q.query;
  const ss = new Map(db.sessions.filter((s) => (!session || s.id === session) && (!from || day(s.startedAt) >= from) && (!to || day(s.startedAt) <= to)).map((s) => [s.id, s]));
  const raw = db.records.filter((x) => ss.has(x.sessionId) && (!account || x.accountId === account)).sort((a, b) => ss.get(b.sessionId).startedAt - ss.get(a.sessionId).startedAt);
  const rows = raw.map((x) => ({ ...x, date: day(ss.get(x.sessionId).startedAt), sent: clock(x.sentAt), checked: clock(x.checkedAt), place: x.location ? `${x.location.lat.toFixed(5)}, ${x.location.lng.toFixed(5)}` : '', lateBy: x.lateBy == null ? '' : `${String(Math.floor(x.lateBy / 60)).padStart(2, '0')}:${String(x.lateBy % 60).padStart(2, '0')}`, replied: clock(x.repliedAt), late: x.lateReply ? `${x.lateReply} (${clock(x.lateAt)})` : '' }));
  const f = q.params.format, sum = summary(raw);
  if (!['csv', 'xlsx', 'pdf'].includes(f)) bad('Unknown format', 404);
  // Phone numbers start with "+" and replies are untrusted: a leading ' stops spreadsheets running them as formulas.
  const safe = (v) => /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  r.attachment(`attendance-${day()}.${f}`);
  if (f === 'csv') return r.send('﻿' + [COLS.map((c) => c[0]), ...rows.map((x) => COLS.map((c) => safe(String(x[c[1]] ?? ''))))].map((l) => l.map((v) => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n'));
  if (f === 'xlsx') {
    const wb = new ExcelJS.Workbook(), a = wb.addWorksheet('Summary'), w = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 1 }] });
    a.columns = [{ width: 24 }, { width: 14 }];
    a.addRows([['Description', 'Count'], ['Records', sum.total], ['WhatsApp accounts', sum.accounts], ['Messages sent', sum.sent], ['Delivered', sum.delivered], ['Present', sum.present], ['Absent', sum.absent], ['Pending', sum.pending], ['Attendance percentage', sum.percent / 100]]);
    a.getCell('B9').numFmt = '0.0%'; a.getRow(1).font = w.getRow(1).font = { bold: true };
    w.columns = COLS.map(([header, key, width]) => ({ header, key, width })); w.addRows(rows); w.getRow(1).font = { bold: true }; w.autoFilter = { from: 'A1', to: { row: 1, column: COLS.length } };
    return r.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }
  const p = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 }); p.pipe(r);
  p.font('Helvetica-Bold').fontSize(16).text('Attendance report').font('Helvetica').fontSize(9).text(`Total ${sum.total}   Sent ${sum.sent}   Delivered ${sum.delivered}   Present ${sum.present}   Absent ${sum.absent}   Pending ${sum.pending}   Attendance ${sum.percent}%`);
  const cols = COLS.filter((c) => c[1] !== 'late' && c[1] !== 'checked'), k = 780 / cols.reduce((n, c) => n + c[2], 0); let y = 80;
  const line = (cells, bold) => { let x = 30; p.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7); cells.forEach((v, i) => { const cw = cols[i][2] * k; let t = String(v ?? '').replace(/[^\x20-\xff]/g, '?'); while (t && p.widthOfString(t) > cw - 6) t = t.slice(0, -1); p.text(t, x, y, { lineBreak: false }); x += cw; }); y += 14; };
  line(cols.map((c) => c[0]), true);
  for (const x of rows) { if (y > 545) { p.addPage(); y = 35; line(cols.map((c) => c[0]), true); } line(cols.map((c) => x[c[1]])); }
  p.end();
});
api.use((q, r) => r.status(404).json({ error: 'Not found' }));
api.use((e, q, r, _n) => { if (!e.status) console.error(e); r.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong.' }); });

const typers = new Map();
io.on('connection', (s) => s.on('typing', (key) => { // live "typing…" between a person and the administrator
  if (typeof key !== 'string' || !/^(user|bot):[\w-]{36}$/.test(key)) return;
  const fresh = !typers.has(key); clearTimeout(typers.get(key));
  typers.set(key, setTimeout(() => { typers.delete(key); io.emit('changed'); }, 2500));
  if (fresh) io.emit('changed');
}));
// ---------- start ----------
if (existsSync(FILE)) db = JSON.parse(readFileSync(FILE, 'utf8')); else { seed(); save(); }
const server = http.createServer(app);
io.attach(server);
if (process.env.NODE_ENV === 'production') {
  app.use('/assets', express.static(here('./dist/assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(here('./dist'), { index: false }));
  app.get('/{*path}', (q, r) => r.set('Cache-Control', 'no-cache').sendFile('index.html', { root: here('./dist') }));
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ root: here('.'), server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
process.on('SIGINT', () => { save(); process.exit(0); });
process.on('SIGTERM', () => { save(); process.exit(0); });
server.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`\n  Dashboard ready: http://localhost:${PORT}\n`));
