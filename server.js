// Multi-WhatsApp attendance: API, WhatsApp (Cloud API or simulated) and React UI on one port.
import express from 'express';
import http from 'node:http';
import { randomUUID as id, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { openStore } from './server/store.js';
import { makeDays, day } from './server/days.js';
import { makeAuth, hash, newPin, same } from './server/auth.js';
import * as wa from './server/whatsapp.js';
import { makeQr } from './server/qr.js';

const PORT = Number(process.env.PORT || 4600);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const DATA = process.env.DATA_DIR || here('./data');
const now = () => Date.now();
const MIN = 60_000;
const clock = (t) => t ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }).format(t) : '';

// ---------- storage ----------
let db;
const store = openStore(DATA), { sql } = store;
const days = makeDays(sql, () => db.settings.shift);
const auth = makeAuth(sql, /^https:/.test(process.env.PUBLIC_URL ?? ''));
const save = () => store.save(db);
let timer;
const io = new Server();
/** Persist soon and tell open dashboards to refresh. */
function changed() { if (!timer) timer = setTimeout(() => { timer = null; save(); io.emit('changed'); }, 100); }
const find = (list, key) => { const x = db[list].find((r) => r.id === key); if (!x) throw Object.assign(new Error('Not found'), { status: 404 }); return x; };
const bad = (m, status = 400) => { throw Object.assign(new Error(m), { status }); };
const str = (v, label, max = 1000) => { const s = String(v ?? '').trim(); if (!s) bad(`${label} is required.`); if (s.length > max) bad(`${label} is too long.`); return s; };
const phone = (v) => { const d = String(v ?? '').replace(/\D/g, ''); if (d.length < 10 || d.length > 15) bad('Enter the number with country code, for example +91 98765 43210.'); return '+' + d; };
const log = (action, detail = '', by = 'System') => { db.logs.unshift({ id: id(), at: now(), action, detail, by }); db.logs.length = Math.min(db.logs.length, 500); };
/** Permanent history: approvals, corrections and security changes are never trimmed. */
const audit = (by, action, detail = '') => { sql.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?,?,?,?)').run(now(), by, action, detail); log(action, detail, by); };
const DEFAULTS = { minutes: 30, requireLocation: true, office: null, message: 'Hey {{name}} 😃,\nThis is a reminder to check in for your scheduled shift today. Reply "In" to confirm your attendance.', shift: { start: '09:30', end: '18:30', grace: 10, days: [1, 2, 3, 4, 5, 6] }, template: { name: '', lang: 'en' } };

const empty = () => ({ nextUser: 1, accounts: [], users: [], messages: [], sessions: [], records: [], logs: [], links: [], settings: structuredClone(DEFAULTS) });
function seed() {
  const names = ['Aathif', 'Kumar', 'Rahul', 'Arjun', 'Vimal', 'Priya', 'Divya', 'Karthik', 'Meena', 'Suresh', 'Anitha', 'Naveen', 'Lakshmi', 'Farhan', 'Deepa', 'Ganesh', 'Nisha', 'Manoj', 'Revathi', 'Imran', 'Sandhya', 'Vijay', 'Kavya', 'Ashok', 'Swathi', 'Dinesh', 'Yamini', 'Harish', 'Pooja', 'Balaji'];
  db = empty();
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
  const r = { id: id(), sessionId: s.id, userId: u.id, code: u.code, name: u.name, phone: u.phone, accountId: a.id, account: a.name, delivery: 'queued', sentAt: null, status: 'pending', reply: '', repliedAt: null, lateReply: '', lateAt: null, askedAt: null, checkedAt: null, location: null, lateBy: null };
  db.records.push(r); return r;
}
function addMessage(u, dir, text, extra = {}) {
  const m = { id: id(), userId: u.id, accountId: u.accountId, dir, text, at: now(), status: dir === 'out' ? 'sending' : 'received', read: dir === 'out', ...extra };
  db.messages.push(m); return m;
}

// ---------- WhatsApp: accounts with a Phone Number ID are real, the rest are simulated ----------
const isCloud = (a) => !!a?.phoneNumberId;
const isLive = (a) => isCloud(a) || !!a?.qr;
const RANK = { sending: 0, sent: 1, delivered: 2, read: 3 };
const outText = (m) => m.kind === 'checkin' ? `${m.text}\n${process.env.PUBLIC_URL.replace(/\/$/, '')}/checkin/${m.token}` : m.text;
const qr = makeQr({ sql, dir: DATA,
  onMessage: (aid, x) => inboundMessage(account(aid), x),
  onStatus: (aid, wamid, st) => { const m = db.messages.find((y) => y.accountId === aid && y.wamid === wamid); if (m && st === 'failed') setStatus(m, 'failed', 'Not delivered'); else if (m && RANK[st] > (RANK[m.status] ?? 99)) { const r = record(m); setStatus(m, st); if (r && !r.sentAt) r.sentAt = m.at; } },
  onState: (aid, x) => {
    const a = account(aid); if (!a) return;
    if (x.phone && db.accounts.some((b) => b !== a && b.phone === x.phone)) { log('WhatsApp link refused: number already added', a.name); a.connected = false; setTimeout(() => qr.unlink(aid), 0); return changed(); }
    if (x.phone) { if (a.phone && a.phone !== x.phone) qr.chats.clear(aid); a.phone = x.phone; } // a different phone starts with no chats
    const on = x.state === 'connected';
    if (a.connected !== on) { a.connected = on; a.changedAt = now(); log(on ? 'WhatsApp connected by QR' : 'WhatsApp link lost', a.name); }
    changed();
  },
  onChats: () => changed(),
  getText: (aid, wamid) => { const m = db.messages.find((y) => y.accountId === aid && y.wamid === wamid); return m && outText(m); } });
const hasWritten = (u) => db.messages.some((m) => m.userId === u.id && m.accountId === u.accountId && m.dir === 'in');
const account = (aid) => db.accounts.find((a) => a.id === aid);
const isConnected = (aid) => !!account(aid)?.connected;
const record = (m) => m.recordId && db.records.find((r) => r.id === m.recordId);
const typing = new Map(); // "user:<id>" or "bot:<id>" -> pending count
function typeThen(key, ms, fn) {
  typing.set(key, (typing.get(key) ?? 0) + 1); changed();
  setTimeout(() => { const n = typing.get(key) - 1; n ? typing.set(key, n) : typing.delete(key); changed(); fn(); }, ms);
}
function botSay(u, text, extra = {}) {
  const go = () => { if (db.users.includes(u)) sendMessage(u, text, { system: true, ...extra }); };
  isLive(account(u.accountId)) ? go() : typeThen('bot:' + u.id, 900 + Math.random() * 700, go);
}
const hm = (t) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(t).toUpperCase();
const dur = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const IN = /^(i'?m )?(in|present|check(ed)?[ -]?in)( sir| madam| mam)?[.! ]*$/i, OUT = /^(i'?m )?(out|check(ed)?[ -]?out)( sir| madam| mam)?[.! ]*$/i;
function statusText(u) {
  const { row } = days.next(u.id);
  if (!row) return 'You have not marked IN today. Send "IN" when you arrive.';
  return row.out_at ? `Today is completed ✅\nIN ${hm(row.in_at)}, OUT ${hm(row.out_at)}, total ${dur(Math.floor((row.out_at - row.in_at) / MIN))}.` : `You marked IN at ${hm(row.in_at)}. Send "OUT" when you leave.`;
}
const setStatus = (m, status, why) => { m.status = status; if (why) m.error = why; const r = record(m); if (r) { r.delivery = status; if (status === 'sent') r.sentAt = m.at; } changed(); };
/** True when the person wrote to this account in the last 24 hours. */
const windowOpen = (u) => db.messages.some((m) => m.userId === u.id && m.accountId === u.accountId && m.dir === 'in' && m.kind !== 'location' && m.at > now() - 24 * 60 * MIN);
function deliver(m, u) {
  const a = account(m.accountId);
  if (!a?.connected) return setStatus(m, 'failed', 'Account is disconnected.');
  if (isLive(a)) {
    const open = windowOpen(u);
    const job = !a.qr ? wa.send(a, u.phone, m, { open, template: db.settings.template, name: u.name }) : hasWritten(u) ? qr.send(a.id, u.phone, outText(m)) : Promise.reject(new Error('This person must send a message to this number first.'));
    job.then((wamid) => { m.wamid = wamid; if (m.status === 'sending') setStatus(m, 'sent'); save(); })
      .catch((e) => { setStatus(m, 'failed', e.message); log('WhatsApp message failed', `${u.name}: ${e.message}`); });
    return;
  }
  setTimeout(() => { if (m.status === 'sending') setStatus(m, 'sent'); }, 250);
  setTimeout(() => { if (m.status === 'sent') setStatus(m, 'delivered'); }, 900);
  // It becomes "read" only when the person opens the chat (see /sim/:id/read).
}
function sendMessage(u, text, extra) {
  const m = addMessage(u, 'out', text, extra); changed(); deliver(m, u); return m;
}
const openRecord = (u, t = now()) => db.records.find((r) => r.userId === u.id && r.accountId === u.accountId && r.sentAt && r.status === 'pending' && db.sessions.some((s) => s.id === r.sessionId && s.status === 'active' && t <= s.endsAt));
/** Every inbound WhatsApp reply passes through here. */
function receive(u, text, { at = now(), wamid } = {}) {
  if (!isConnected(u.accountId)) return false;
  addMessage(u, 'in', text, { at, wamid });
  const t = text.trim(), open = openRecord(u, at);
  if (open) { open.delivery = 'read'; const out = db.messages.find((x) => x.recordId === open.id); if (out && out.status !== 'failed') out.status = 'read'; }
  const reply = (fn) => { try { fn(); } catch (e) { if (!e.status) throw e; botSay(u, e.message); } };
  if (at < now() - 16 * 60 * MIN) { /* delivered far too late to trust as a punch */ }
  else if (IN.test(t)) reply(() => {
    const n = days.next(u.id, at);
    if (!u.active) bad('Your account is inactive. Please contact your administrator.');
    if (!n.canIn) return botSay(u, statusText(u));
    if (open && !open.repliedAt) Object.assign(open, { reply: text, repliedAt: at });
    if (db.settings.requireLocation || (open && find('sessions', open.sessionId).requireLocation)) { if (open) open.askedAt = now(); askLocation(u, open); }
    else markIn(u, { source: 'whatsapp', at });
    // A reply after the window is kept beside the session result without changing it.
    const late = !open && db.records.filter((r) => r.userId === u.id && r.status === 'absent' && r.sentAt && day(r.sentAt) === day(at)).at(-1);
    if (late && !late.lateAt) Object.assign(late, { lateReply: text, lateAt: at });
  });
  else if (OUT.test(t)) reply(() => markOut(u, { source: 'whatsapp', at }));
  else if (/^status[.! ]*$/i.test(t)) botSay(u, statusText(u));
  else if (/^(hi|hey|hello|vanakkam|help)\b/i.test(t)) botSay(u, `Hello ${u.name} 👋\nSend "IN" when you arrive, "OUT" when you leave, or "STATUS" to see today's attendance.`);
  // Anything else is left for the administrator to answer.
  changed(); return true;
}
function askLocation(u, rec) {
  if (isLive(account(u.accountId)) && !wa.ready().publicUrl) { log('Attendance link not sent: PUBLIC_URL (https) is missing', u.name); return botSay(u, 'Attendance by WhatsApp is not ready yet. Please mark IN on the web page or contact your administrator.'); }
  const token = randomBytes(24).toString('base64url');
  db.links = db.links.filter((l) => l.expires > now() - 24 * 60 * MIN && !(l.userId === u.id && !l.done));
  db.links.push({ id: token, userId: u.id, recordId: rec?.id ?? null, expires: now() + 30 * MIN, done: false }); save();
  botSay(u, 'Attach your current location 📍 to mark your attendance on below link', { kind: 'checkin', token });
}
function markIn(u, { source, location = null, at = now() }) {
  const row = days.punch(u, 'in', { source, location, at });
  const r = openRecord(u, at);
  if (r) { const s = find('sessions', r.sessionId); Object.assign(r, { status: 'present', checkedAt: at, repliedAt: r.repliedAt ?? at, reply: r.reply || `IN (${source})`, location, lateBy: Math.max(0, Math.floor(((r.repliedAt ?? at) - s.startedAt) / 1000)) }); }
  botSay(u, `You've successfully been checked in!\nIN ${hm(row.in_at)}${row.late_min ? `, late by ${dur(row.late_min)}` : ', on time'}\nSend "OUT" when you leave.`);
  log('IN marked', `${u.name}, ${source}`); changed(); return row;
}
function markOut(u, { source, location = null, at = now() }) {
  const row = days.punch(u, 'out', { source, location, at });
  botSay(u, `OUT recorded at ${hm(row.out_at)} ✅\nTotal today: ${dur(Math.floor((row.out_at - row.in_at) / MIN))}`);
  log('OUT marked', `${u.name}, ${source}`); changed(); return row;
}
const metres = (a, b) => { const r = Math.PI / 180, h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
function checkPlace(b = {}) {
  const { lat, lng, accuracy } = b;
  if (![lat, lng, accuracy].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracy < 0) bad('Location is not valid.');
  const office = db.settings.office, distance = office ? Math.round(metres(office, { lat, lng })) : null;
  if (office && accuracy > Math.max(150, office.radius)) bad(`Your location is only accurate to ${Math.round(accuracy)} m. Turn on GPS and try again.`);
  if (office && distance > office.radius) bad(`You are ${distance} m away. Mark attendance within ${office.radius} m of the office.`);
  return { lat, lng, accuracy: Math.round(accuracy), distance };
}
const findLink = (t) => db.links.find((l) => l.id === t) ?? bad('This check-in link is not valid.', 404);
/** Second step of WhatsApp IN: the person opened the private link and shared a location. */
function checkIn(token, body) {
  const l = findLink(token);
  if (l.done) bad('You are already checked in.', 409);
  if (now() > l.expires) bad('This link has expired. Send "IN" again on WhatsApp.', 410);
  const u = find('users', l.userId), location = checkPlace(body);
  const row = markIn(u, { source: 'whatsapp', location });
  l.done = true; addMessage(u, 'in', `📍 ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`, { kind: 'location', lat: location.lat, lng: location.lng });
  save(); changed(); return row;
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
  const conversations = db.users.map((u) => {
    const ms = (byUser.get(u.id) ?? []).filter((m) => m.accountId === u.accountId), last = ms.reduce((a, m) => !a || m.at >= a.at ? m : a, null);
    return { userId: u.id, accountId: u.accountId, last, unread: ms.filter((m) => !m.read).length, userUnread: ms.filter((m) => m.dir === 'out' && ['sent', 'delivered'].includes(m.status)).length };
  }).sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  const started = new Map(db.sessions.filter((s) => s.status === 'completed').map((s) => [s.id, s.startedAt]));
  const results = Map.groupBy(db.records.filter((r) => started.has(r.sessionId)).sort((a, b) => started.get(a.sessionId) - started.get(b.sessionId)), (r) => r.userId);
  const todayRows = days.list(db.users), today = new Map(todayRows.map((x) => [x.userId, x]));
  const n = (f) => todayRows.filter(f).length, came = n((x) => x.inAt), expected = n((x) => x.status !== 'off');
  const pinned = new Set(sql.prepare('SELECT user_id FROM pins').all().map((p) => p.user_id));
  return { now: now(), wa: wa.ready(), qrUnread: Object.fromEntries(db.accounts.filter((a) => a.qr).map((a) => [a.id, qr.chats.unread(a.id)])), typing: [...typing.keys(), ...typers.keys()], accounts: db.accounts, users: db.users.map((u) => { const rs = results.get(u.id) ?? [], p = rs.filter((r) => r.status === 'present').length; return { ...u, sessions: rs.length, presents: p, rate: rs.length ? Math.round(p / rs.length * 100) : null, recent: rs.slice(-7).map((r) => r.status), today: today.get(u.id)?.status ?? null, hasPin: pinned.has(u.id) }; }), settings: db.settings, sessions, conversations, logs: db.logs.slice(0, 100),
    records: db.records.filter((r) => db.sessions.some((s) => s.id === r.sessionId && s.status === 'active')),
    recentMessages: db.messages.filter((m) => m.dir === 'in').sort((a, b) => b.at - a.at).slice(0, 6),
    recentAttendance: todayRows.filter((x) => x.inAt).sort((a, b) => (b.outAt ?? b.inAt) - (a.outAt ?? a.inAt)).slice(0, 6),
    today: { total: expected, present: came, working: n((x) => x.status === 'working'), completed: n((x) => x.status === 'completed'), late: n((x) => x.late), notIn: n((x) => x.status === 'notin'), percent: expected ? Math.round(came / expected * 1000) / 10 : 0 } };
}

// ---------- API ----------
const app = express(), api = express.Router();
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);
app.disable('x-powered-by');
app.use((q, r, next) => { r.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' }); if (q.path.startsWith('/api')) r.set('Cache-Control', 'no-store'); next(); });
app.use(['/data', '/server', '/server.js', '/test'], (q, r) => r.status(404).end()); // never serve these in dev mode

// ---- WhatsApp webhook: Meta signs every call with the app secret ----
app.get('/webhook/whatsapp', (q, r) => { const v = process.env.WA_VERIFY_TOKEN; return v && q.query['hub.mode'] === 'subscribe' && same(q.query['hub.verify_token'] ?? '', v) ? r.type('text').send(String(q.query['hub.challenge'] ?? '')) : r.sendStatus(403); });
app.post('/webhook/whatsapp', express.raw({ type: '*/*', limit: '2mb' }), (q, r) => {
  if (!Buffer.isBuffer(q.body) || !wa.signed(q.body, q.get('x-hub-signature-256'))) return r.sendStatus(401);
  let b; try { b = JSON.parse(q.body); } catch { return r.sendStatus(400); }
  try { for (const e of b.entry ?? []) for (const c of e.changes ?? []) if (c.field === 'messages') inbound(c.value ?? {}); save(); r.sendStatus(200); }
  catch (e) { console.error('webhook', e.message); r.sendStatus(500); } // Meta retries
});
function inbound(v) {
  const a = db.accounts.find((x) => x.phoneNumberId && x.phoneNumberId === v.metadata?.phone_number_id);
  if (!a) return;
  for (const st of v.statuses ?? []) {
    const m = db.messages.find((x) => x.wamid === st.id);
    if (!m) continue;
    if (st.status === 'failed') setStatus(m, 'failed', st.errors?.[0]?.title ?? 'Not delivered');
    else if ((RANK[st.status] ?? -1) > (RANK[m.status] ?? 99)) { const r = record(m); setStatus(m, st.status); if (r && !r.sentAt) r.sentAt = m.at; }
  }
  for (const x of v.messages ?? []) {
    if (!x.id) continue;
    inboundMessage(a, { id: x.id, from: String(x.from), at: Math.min(now(), Number(x.timestamp) * 1000 || now()), text: x.text?.body ?? x.button?.text ?? x.interactive?.button_reply?.title, type: x.type });
  }
}
function inboundMessage(a, x) {
    if (!a) return;
    if (sql.prepare('SELECT 1 FROM wamids WHERE id = ?').get(x.id)) return; // Meta can deliver twice
    const u = db.users.find((y) => y.phone === '+' + x.from);
    const { at, text } = x;
    if (a.qr && u?.accountId !== a.id) return; // private chats on a linked phone are never stored
    if (!u) log('WhatsApp from an unregistered number', '…' + x.from.slice(-4));
    else if (u.accountId !== a.id) log('WhatsApp sent to the wrong account', `${u.name} wrote to ${a.name}`);
    else {
      if (text) receive(u, text.slice(0, 4096), { at, wamid: x.id });
      else { addMessage(u, 'in', x.type === 'location' ? '[Location shared in chat: not accepted as attendance]' : `[${x.type}]`, { at, wamid: x.id }); if (x.type === 'location') botSay(u, 'Please send "IN" and use the attendance link to share your location.'); changed(); }
    }
    sql.prepare('INSERT INTO wamids VALUES (?, ?)').run(x.id, now());
  sql.prepare('DELETE FROM wamids WHERE at < ?').run(now() - 30 * 24 * 60 * MIN);
}

app.use(express.json({ limit: '200kb' })); app.use('/api', api);
api.use((q, r, next) => { // cookies are SameSite=Strict; also refuse writes from any other site
  const o = q.get('origin');
  if (!['GET', 'HEAD'].includes(q.method) && o) { let h; try { h = new URL(o).host; } catch { /* refused below */ } if (h !== q.get('host')) bad('Request refused.', 403); }
  next();
});
api.get('/health', (q, r) => r.json({ ok: true }));

// ---------- sign in ----------
const adminBy = (q) => { const x = auth.who(q, 'admin'); return x ? sql.prepare('SELECT id, email, name FROM admins WHERE id = ?').get(x) : undefined; };
const noAdmins = () => !sql.prepare('SELECT 1 FROM admins LIMIT 1').get();
const email = (v) => { const e = str(v, 'Email', 120).toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(e)) bad('Enter a valid email.'); return e; };
const password = (v) => { const p = String(v ?? ''); if (p.length < 10 || p.length > 200) bad('Use a password of at least 10 characters.'); return p; };
function createAdmin(b) { const a = { id: id(), email: email(b.email), name: str(b.name, 'Name', 60), hash: hash(password(b.password)) }; if (sql.prepare('SELECT 1 FROM admins WHERE email = ?').get(a.email)) bad('That email is already an administrator.'); sql.prepare('INSERT INTO admins VALUES (@id,@email,@name,@hash)').run(a); return a; }
api.get('/auth', (q, r) => { const a = adminBy(q); r.json({ setup: noAdmins(), admin: a ?? null }); });
api.post('/auth/login', (q, r) => {
  const e = String(q.body?.email ?? '').trim().toLowerCase().slice(0, 120), a = sql.prepare('SELECT * FROM admins WHERE email = ?').get(e);
  auth.attempt(q, 'admin:' + e, () => auth.verify(q.body?.password, a?.hash));
  auth.start(r, 'admin', a.id); audit(a.name, 'Administrator signed in'); changed(); r.json({});
});
api.post('/auth/logout', (q, r) => { auth.end(q, r, 'admin'); r.json({}); });

// ---------- employee: sees and marks only their own attendance ----------
const me = (q) => db.users.find((x) => x.id === auth.who(q, 'user') && x.active) ?? bad('Please sign in.', 401);
api.post('/me/login', (q, r) => {
  let p = String(q.body?.phone ?? '').replace(/\D/g, ''); if (p.length === 10) p = '91' + p;
  const u = db.users.find((x) => x.phone === '+' + p && x.active);
  auth.attempt(q, 'user:' + p.slice(0, 15), () => auth.verify(q.body?.pin, u && sql.prepare('SELECT hash FROM pins WHERE user_id = ?').get(u.id)?.hash));
  auth.start(r, 'user', u.id); log('Employee signed in', u.name); changed(); r.json({});
});
api.post('/me/logout', (q, r) => { auth.end(q, r, 'user'); r.json({}); });
api.get('/me', (q, r) => {
  const u = me(q), n = days.next(u.id), from = day(now() - 30 * 24 * 60 * MIN);
  r.json({ now: now(), user: { name: u.name, code: u.code, phone: u.phone }, shift: db.settings.shift, requireLocation: db.settings.requireLocation, canIn: n.canIn, canOut: n.canOut, done: n.done, today: n.row ? days.view(n.row) : null, history: days.list([u], { from, to: day(), userId: u.id }).filter((x) => x.status !== 'off') });
});
for (const type of ['in', 'out']) api.post('/me/' + type, (q, r) => {
  const u = me(q), location = db.settings.requireLocation ? checkPlace(q.body) : null;
  r.json(days.view((type === 'in' ? markIn : markOut)(u, { source: 'web', location })));
});
api.get('/checkin/:token', (q, r) => { const l = findLink(q.params.token), u = find('users', l.userId), n = days.next(u.id); r.json({ name: u.name, done: l.done, open: now() <= l.expires && n.canIn, row: l.done && n.row ? days.view(n.row) : null }); });
api.post('/checkin/:token', (q, r) => r.json({ done: true, row: days.view(checkIn(q.params.token, q.body)) }));

// ---------- everything below needs an administrator ----------
api.use((q, r, next) => { q.admin = adminBy(q); if (!q.admin) bad('Please sign in.', 401); next(); });
api.put('/auth/password', (q, r) => {
  const a = sql.prepare('SELECT * FROM admins WHERE id = ?').get(q.admin.id);
  auth.attempt(q, 'pw:' + a.id, () => auth.verify(q.body.current, a.hash));
  sql.prepare('UPDATE admins SET hash = ? WHERE id = ?').run(hash(password(q.body.password)), a.id); auth.revoke('admin', a.id); auth.start(r, 'admin', a.id); audit(a.name, 'Password changed'); changed(); r.json({});
});
api.get('/admins', (q, r) => r.json(sql.prepare('SELECT id, email, name FROM admins ORDER BY name').all()));
api.post('/admins', (q, r) => { const a = createAdmin(q.body); audit(q.admin.name, 'Administrator added', a.name); changed(); r.json({}); });
api.delete('/admins/:id', (q, r) => { if (q.params.id === q.admin.id) bad('You cannot remove yourself.'); const a = sql.prepare('SELECT name FROM admins WHERE id = ?').get(q.params.id) ?? bad('Not found', 404); sql.prepare('DELETE FROM admins WHERE id = ?').run(q.params.id); auth.revoke('admin', q.params.id); audit(q.admin.name, 'Administrator removed', a.name); changed(); r.json({}); });
api.get('/audit', (q, r) => r.json(sql.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all()));
api.post('/users/:id/pin', (q, r) => { const u = find('users', q.params.id), pin = newPin(); sql.prepare('INSERT INTO pins VALUES (?,?) ON CONFLICT (user_id) DO UPDATE SET hash = excluded.hash').run(u.id, hash(pin)); auth.revoke('user', u.id); audit(q.admin.name, 'Login PIN reset', u.name); changed(); r.json({ pin }); });

// ---------- daily IN/OUT ----------
api.get('/days', (q, r) => r.json(days.list(db.users, { from: q.query.from, to: q.query.to, userId: q.query.user })));
api.put('/days', (q, r) => {
  const u = find('users', q.body.userId), reason = str(q.body.reason, 'Reason', 200), x = days.correct(u, String(q.body.date ?? ''), String(q.body.in ?? ''), String(q.body.out ?? ''));
  const f = (d) => d ? `${hm(d.in_at)} to ${d.out_at ? hm(d.out_at) : 'no OUT'}` : 'no record';
  audit(q.admin.name, 'Attendance corrected', `${u.name} ${q.body.date}: ${f(x.old)} → ${f(x.now)}. Reason: ${reason}`); changed(); r.json({});
});
const DAYCOLS = [['Employee ID', 'code', 12], ['Employee name', 'name', 20], ['Date', 'date', 12], ['Status', 'status', 14], ['IN', 'in', 24], ['OUT', 'out', 24], ['Working hours', 'hours', 14], ['Late (minutes)', 'late', 14], ['IN method', 'inSource', 12], ['OUT method', 'outSource', 12], ['Corrected', 'fixed', 11]];
api.get('/days.:format', async (q, r) => {
  const f = q.params.format; if (!['csv', 'xlsx'].includes(f)) bad('Unknown format', 404);
  const rows = days.list(db.users, { from: q.query.from, to: q.query.to, userId: q.query.user }).map((x) => ({ ...x, status: DAYNAME[x.status], in: clock(x.inAt), out: clock(x.outAt), hours: x.minutes == null ? '' : dur(x.minutes), inSource: x.inSource ?? '', outSource: x.outSource ?? '', fixed: x.corrected ? 'Yes' : '' }));
  r.attachment(`daily-attendance-${day()}.${f}`);
  if (f === 'csv') return r.send('﻿' + [DAYCOLS.map((c) => c[0]), ...rows.map((x) => DAYCOLS.map((c) => safe(String(x[c[1]] ?? ''))))].map((l) => l.map((v) => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n'));
  const wb = new ExcelJS.Workbook(), w = wb.addWorksheet('Daily attendance', { views: [{ state: 'frozen', ySplit: 1 }] });
  w.columns = DAYCOLS.map(([header, key, width]) => ({ header, key, width })); w.addRows(rows.map((x) => ({ ...x, name: safe(x.name) }))); w.getRow(1).font = { bold: true }; w.autoFilter = { from: 'A1', to: { row: 1, column: DAYCOLS.length } };
  r.send(Buffer.from(await wb.xlsx.writeBuffer()));
});
const DAYNAME = { working: 'Working', completed: 'Completed', missing: 'Missing OUT', absent: 'Absent', notin: 'Not in yet', off: 'Day off' };
// Phone numbers start with "+" and replies are untrusted: a leading ' stops spreadsheets running them as formulas.
const safe = (v) => /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
api.get('/state', (q, r) => r.json(state()));
api.get('/users/:id/messages', (q, r) => { const u = find('users', q.params.id); r.json(db.messages.filter((m) => m.userId === u.id && m.accountId === u.accountId).sort((a, b) => a.at - b.at)); });
api.post('/users/:id/read', (q, r) => { let hit = false; for (const m of db.messages) if (m.userId === q.params.id && !m.read) { m.read = true; hit = true; } if (hit) changed(); r.json({}); });
api.post('/users/:id/messages', (q, r) => {
  const u = find('users', q.params.id), text = str(q.body.text, 'Message', 4096);
  if (!isConnected(u.accountId)) bad('This WhatsApp account is disconnected. Connect it to send messages.');
  if (account(u.accountId).qr && !hasWritten(u)) bad('This person must send a message to this number first.');
  if (isCloud(account(u.accountId)) && !windowOpen(u)) bad('This person has not written in the last 24 hours, so WhatsApp does not allow a free message.');
  r.json(sendMessage(u, text));
});
// ---------- chat simulator: administrators only, and only for simulated accounts ----------
const sim = (q) => { const u = find('users', q.params.id); if (isLive(account(u.accountId))) bad('This person uses real WhatsApp, so their chat cannot be simulated.', 403); return u; };
api.get('/sim/:id', (q, r) => {
  const u = sim(q), a = find('accounts', u.accountId), n = days.next(u.id);
  r.json({ user: { id: u.id, name: u.name, phone: u.phone }, account: { name: a.name, connected: a.connected }, today: n.row ? days.view(n.row).status : null, typing: typing.has('bot:' + u.id) || typers.has('bot:' + u.id),
    messages: db.messages.filter((m) => m.userId === u.id && m.accountId === u.accountId).sort((x, y) => x.at - y.at) });
});
api.post('/sim/:id/messages', (q, r) => { if (!receive(sim(q), str(q.body.text, 'Message', 4096))) bad('This account is offline. Try again later.'); r.json({}); });
api.post('/sim/:id/read', (q, r) => {
  const u = sim(q); let hit = false;
  for (const m of db.messages) if (m.userId === u.id && m.dir === 'out' && m.status === 'delivered') { m.status = 'read'; const x = record(m); if (x) x.delivery = 'read'; hit = true; }
  if (hit) changed(); r.json({});
});
api.get('/users/:id/history', (q, r) => r.json(db.records.filter((x) => x.userId === q.params.id).map((x) => ({ ...x, session: find('sessions', x.sessionId) })).sort((a, b) => b.session.startedAt - a.session.startedAt)));

const digits = (v, label, n = 6) => { const d = String(v ?? '').trim(); if (!/^\d+$/.test(d) || d.length < n || d.length > 30) bad(`${label} must be numbers only.`); return d; };
async function accountBody(b, self) {
  const name = str(b.name, 'Account name', 60);
  const v = { name, phoneNumberId: null, wabaId: null };
  if (b.type === 'qr') { // the phone number is learned when the QR is scanned
    if (!self && b.agree !== true) bad('Confirm that you understand the ban risk.');
    const old = self && find('accounts', self);
    return { name, phoneNumberId: null, wabaId: null, qr: true, phone: old?.phone ?? null };
  }
  if (b.live) {
    const w = wa.ready(), miss = [!w.token && 'WA_TOKEN', !w.secret && 'WA_APP_SECRET', !w.verify && 'WA_VERIFY_TOKEN', !w.publicUrl && 'PUBLIC_URL (https)'].filter(Boolean);
    if (miss.length) bad(`Add these on the server first: ${miss.join(', ')}.`);
    v.phoneNumberId = digits(b.phoneNumberId, 'Phone Number ID'); v.wabaId = digits(b.wabaId, 'WhatsApp Business Account ID');
    const info = await wa.numberInfo(v.phoneNumberId); v.phone = phone(info.display_phone_number); v.info = info;
    if (db.accounts.some((a) => a.phoneNumberId === v.phoneNumberId && a.id !== self)) bad('That number is already added.');
  } else v.phone = phone(b.phone);
  if (db.accounts.some((a) => a.phone === v.phone && a.id !== self)) bad('That number is already added.');
  return v;
}
api.post('/accounts', async (q, r) => { const v = await accountBody(q.body), a = { id: id(), ...v, connected: !isLive(v), createdAt: now(), changedAt: now() }; db.accounts.push(a); audit(q.admin.name, 'Account added', a.name); changed(); r.json(a); });
api.put('/accounts/:id', async (q, r) => {
  const a = find('accounts', q.params.id), v = await accountBody(q.body, a.id);
  if (isCloud(a) !== isCloud(v) || !!a.qr !== !!v.qr) bad('Add a new account to change between real and simulated.');
  if (v.phoneNumberId !== a.phoneNumberId && a.phoneNumberId) v.connected = false;
  Object.assign(a, v); audit(q.admin.name, 'Account edited', a.name); changed(); r.json(a);
});
api.post('/accounts/:id/toggle', (q, r) => { const a = find('accounts', q.params.id); if (isLive(a) && !a.connected) bad('Use Set up to connect a real number.'); if (a.qr) qr.unlink(a.id); a.connected = !a.connected; a.changedAt = now(); audit(q.admin.name, a.connected ? 'Account connected' : 'Account disconnected', a.name); changed(); r.json(a); });
const qrAccount = (q) => { const a = find('accounts', q.params.id); if (!a.qr) bad('This account does not use QR.'); return a; };
api.get('/accounts/:id/qr', (q, r) => r.json(qr.view(qrAccount(q).id)));
api.post('/accounts/:id/qr', (q, r) => { const a = qrAccount(q); if (a.connected) bad('This WhatsApp is already connected.'); audit(q.admin.name, 'WhatsApp QR opened', a.name); qr.start(a.id); r.json({}); });
const chatOf = (q) => { const a = qrAccount(q), jid = String(q.params.jid); if (!qr.chats.has(a.id, jid)) bad('Chat not found.', 404); return [a, jid]; };
api.get('/accounts/:id/chats', (q, r) => r.json(qr.chats.list(qrAccount(q).id)));
api.get('/accounts/:id/chats/:jid', (q, r) => { const [a, jid] = chatOf(q); r.json(qr.chats.messages(a.id, jid, q.query.before ? Number(q.query.before) : undefined)); });
api.post('/accounts/:id/chats/:jid/read', (q, r) => { const [a, jid] = chatOf(q); qr.chats.read(a.id, jid); r.json({}); });
api.post('/accounts/:id/chats/:jid/messages', async (q, r) => { const [a, jid] = chatOf(q), text = str(q.body.text, 'Message', 4096); try { await qr.send(a.id, jid, text); } catch { bad('WhatsApp did not accept the message. Check the connection and try again.', 502); } r.json({}); });
api.delete('/accounts/:id/chats/:jid', (q, r) => { const [a, jid] = chatOf(q); qr.chats.removeChat(a.id, jid); audit(q.admin.name, 'Saved chat deleted', a.name); r.json({}); });
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/mp4|audio\/(ogg|mpeg|mp4|aac))$/;
api.get('/accounts/:id/chats/:jid/media/:mid', async (q, r) => {
  const [a, jid] = chatOf(q), m = await qr.media(a.id, jid, q.params.mid); if (!m) bad('File not found.', 404);
  const type = String(m.mime).split(';')[0].trim().toLowerCase();
  r.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (INLINE.test(type) && m.kind !== 'document') r.type(type); else { r.attachment((m.file || 'file').replace(/[^\w. -]/g, '_').slice(-100)); r.type('application/octet-stream'); }
  r.send(m.data);
});
api.post('/accounts/:id/setup/:step', async (q, r) => { // real numbers: code -> verify -> register -> connect
  const a = find('accounts', q.params.id), st = q.params.step; if (!isCloud(a)) bad('This account does not use the Cloud API.');
  if (st === 'code') await wa.requestCode(a.phoneNumberId, q.body.method);
  else if (st === 'verify') await wa.verifyCode(a.phoneNumberId, digits(String(q.body.code ?? '').replace(/\D/g, ''), 'Code', 4));
  else if (st === 'register') { const p = String(q.body.pin ?? ''); if (!/^\d{6}$/.test(p)) bad('Choose a 6-digit PIN.'); await wa.register(a.phoneNumberId, p); }
  else if (st === 'connect') { await wa.subscribe(a.wabaId); a.connected = true; a.changedAt = now(); }
  else if (st !== 'check') bad('Not found', 404);
  a.info = await wa.numberInfo(a.phoneNumberId);
  if (st !== 'check') audit(q.admin.name, `WhatsApp setup: ${st}`, a.name); changed(); r.json(a);
});
function removeUser(u) { db.users = db.users.filter((x) => x !== u); db.messages = db.messages.filter((m) => m.userId !== u.id); db.links = db.links.filter((l) => l.userId !== u.id); auth.revoke('user', u.id); sql.prepare('DELETE FROM pins WHERE user_id = ?').run(u.id); }
api.delete('/accounts/:id', (q, r) => {
  const a = find('accounts', q.params.id);
  if (db.sessions.some((s) => s.status === 'active' && s.accountIds.includes(a.id))) bad('Finish the active attendance session first.');
  const mine = db.users.filter((u) => u.accountId === a.id);
  if (mine.length && (isLive(a) || q.query.users !== '1')) bad('Move or delete this account’s users first.');
  for (const u of mine) removeUser(u);
  if (a.qr) qr.unlink(a.id).then(() => qr.chats.clear(a.id)); db.accounts = db.accounts.filter((x) => x !== a); audit(q.admin.name, 'Account deleted', a.name); changed(); r.json({});
});

const inActive = (uid) => db.records.some((x) => x.userId === uid && x.status === 'pending');
const userBody = (b, self) => { const v = { name: str(b.name, 'Name', 80), phone: phone(b.phone), accountId: find('accounts', b.accountId).id, active: !!b.active }; if (db.users.some((u) => u.phone === v.phone && u.id !== self)) bad('Another user already has that number.'); return v; };
api.post('/users', (q, r) => { const u = addUser(userBody(q.body)); audit(q.admin.name, 'User added', u.name); changed(); r.json(u); });
api.put('/users/:id', (q, r) => { const u = find('users', q.params.id), v = userBody(q.body, u.id); if (inActive(u.id) && (v.accountId !== u.accountId || v.phone !== u.phone)) bad('Finish the active attendance session before changing this user’s account or number.'); Object.assign(u, v); if (!u.active) auth.revoke('user', u.id); audit(q.admin.name, 'User edited', u.name); changed(); r.json(u); });
api.delete('/users/:id', (q, r) => { const u = find('users', q.params.id);  if (inActive(u.id)) bad('This user is in an active attendance session.'); removeUser(u); audit(q.admin.name, 'User deleted', u.name); changed(); r.json({}); });

api.post('/sessions', (q, r) => {
  if (db.sessions.some((s) => s.status === 'active')) bad('An attendance session is already running.');
  const message = str(q.body.message, 'Message', 1024), minutes = Number(q.body.minutes);
  if (!(minutes >= 1 && minutes <= 240)) bad('Duration must be 1 to 240 minutes.');
  const ids = (q.body.accountIds ?? []).filter(isConnected);
  const users = db.users.filter((u) => u.active && ids.includes(u.accountId) && days.next(u.id).canIn && (!account(u.accountId).qr || hasWritten(u)));
  if (!users.length) bad('No users to remind: everyone selected is already IN, inactive, or has not messaged this number yet.');
  if (users.some((u) => isCloud(account(u.accountId)) && !windowOpen(u)) && !db.settings.template.name) bad('Add your approved reminder template name in Settings first.');
  const t = now(), s = { id: id(), title: String(q.body.title || 'Daily attendance').slice(0, 80), status: 'active', message, accountIds: ids, minutes, requireLocation: q.body.requireLocation !== false, startedAt: t, endsAt: t + minutes * MIN, finalizedAt: null };
  db.sessions.push(s); audit(q.admin.name, 'Attendance started', `${users.length} users`);
  users.forEach((u, i) => {
    const rec = newRecord(s, u);
    setTimeout(() => {
      const cur = db.users.find((x) => x.id === u.id);
      if (s.status !== 'active' || !cur || rec.status !== 'pending') return;
      sendMessage(cur, message.replace(/\{\{\s*name\s*\}\}/g, () => cur.name).replace(/\{\{\s*date\s*\}\}/g, day()).replace(/\{\{\s*account\s*\}\}/g, () => rec.account), { recordId: rec.id });
    }, i * 120);
  });
  changed(); r.json(s);
});
api.post('/sessions/:id/finish', (q, r) => { finalize(find('sessions', q.params.id)); r.json({}); });
api.post('/sessions/:id/cancel', (q, r) => { finalize(find('sessions', q.params.id), 'cancelled'); r.json({}); });
api.get('/sessions/:id', (q, r) => { const s = find('sessions', q.params.id), rs = db.records.filter((x) => x.sessionId === s.id); r.json({ ...s, date: day(s.startedAt), records: rs, summary: summary(rs) }); });
api.put('/settings', (q, r) => { const m = Number(q.body.minutes); if (!(m >= 1 && m <= 240)) bad('Duration must be 1 to 240 minutes.'); const o = q.body.office; const office = o && o.lat !== '' && o.lng !== '' ? { lat: Number(o.lat), lng: Number(o.lng), radius: Number(o.radius) } : null; if (office && (!(Math.abs(office.lat) <= 90) || !(Math.abs(office.lng) <= 180) || !(office.radius >= 10))) bad('Enter a valid office location and a radius of at least 10 m.'); const sh = q.body.shift ?? db.settings.shift, hhmm = /^([01]\d|2[0-3]):[0-5]\d$/, grace = Number(sh.grace), wd = [...new Set((sh.days ?? []).map(Number))].filter((x) => x >= 0 && x <= 6).sort();
  if (!hhmm.test(sh.start) || !hhmm.test(sh.end) || !(grace >= 0 && grace <= 240) || !wd.length) bad('Enter valid shift times, late limit and at least one working day.');
  const tp = q.body.template ?? db.settings.template, tn = String(tp.name ?? '').trim(), tl = String(tp.lang ?? '').trim() || 'en';
  if ((tn && !/^[a-z0-9_]{1,512}$/.test(tn)) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(tl)) bad('Enter the template name and language exactly as shown in WhatsApp Manager.');
  db.settings = { minutes: m, requireLocation: !!q.body.requireLocation, office, message: str(q.body.message, 'Message', 1024), shift: { start: sh.start, end: sh.end, grace, days: wd }, template: { name: tn, lang: tl } }; audit(q.admin.name, 'Settings updated'); changed(); r.json({}); });

const COLS = [['User ID', 'code', 11], ['User name', 'name', 16], ['WhatsApp number', 'phone', 17], ['Account', 'account', 13], ['Date', 'date', 12], ['Message sent', 'sent', 24], ['Delivery', 'delivery', 11], ['User reply', 'reply', 22], ['Reply received', 'replied', 24], ['Final status', 'status', 12], ['Location', 'place', 22], ['Checked in', 'checked', 24], ['Late by (mm:ss)', 'lateBy', 14], ['Late reply', 'late', 22]];
api.get('/export.:format', async (q, r) => {
  const { session, from, to, account } = q.query;
  const ss = new Map(db.sessions.filter((s) => (!session || s.id === session) && (!from || day(s.startedAt) >= from) && (!to || day(s.startedAt) <= to)).map((s) => [s.id, s]));
  const raw = db.records.filter((x) => ss.has(x.sessionId) && (!account || x.accountId === account)).sort((a, b) => ss.get(b.sessionId).startedAt - ss.get(a.sessionId).startedAt);
  const rows = raw.map((x) => ({ ...x, date: day(ss.get(x.sessionId).startedAt), sent: clock(x.sentAt), checked: clock(x.checkedAt), place: x.location ? `${x.location.lat.toFixed(5)}, ${x.location.lng.toFixed(5)}` : '', lateBy: x.lateBy == null ? '' : `${String(Math.floor(x.lateBy / 60)).padStart(2, '0')}:${String(x.lateBy % 60).padStart(2, '0')}`, replied: clock(x.repliedAt), late: x.lateReply ? `${x.lateReply} (${clock(x.lateAt)})` : '' }));
  const f = q.params.format, sum = summary(raw);
  if (!['csv', 'xlsx', 'pdf'].includes(f)) bad('Unknown format', 404);
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
api.use((e, q, r, _n) => { if (r.headersSent) return r.end(); if (!e.status) console.error(e); r.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong.' }); });

const typers = new Map();
io.use((s, next) => next(adminBy(s.request) || auth.who(s.request, 'user') ? undefined : new Error('Please sign in.')));
io.on('connection', (s) => s.on('typing', (key) => { // live "typing…" between a person and the administrator
  if (!adminBy(s.request)) return;
  if (typeof key !== 'string' || !/^(user|bot):[\w-]{36}$/.test(key)) return;
  const fresh = !typers.has(key); clearTimeout(typers.get(key));
  typers.set(key, setTimeout(() => { typers.delete(key); io.emit('changed'); }, 2500));
  if (fresh) io.emit('changed');
}));
// ---------- start ----------
db = store.load();
if (!db.settings) { // first start: bring over the earlier JSON data once, otherwise begin empty
  const old = here('./data/demo.json');
  if (!process.env.DATA_DIR && existsSync(old)) { const o = JSON.parse(readFileSync(old, 'utf8')); db = { ...empty(), ...o, links: [], settings: { ...DEFAULTS, ...o.settings } }; delete db.tokens; for (const s of db.sessions) if (s.status === 'active') finalize(s, 'cancelled'); log('Earlier demo data imported'); }
  else if (process.env.SEED_DEMO) seed(); else db = empty();
  save();
}
db.settings = { ...DEFAULTS, ...db.settings };
// QR links reconnect by themselves after a restart.
for (const a of db.accounts) if (a.qr) { a.connected = false; if (qr.hasSession(a.id)) qr.start(a.id); }
// A message still "sending" after a restart was never confirmed.
for (const m of db.messages) if (m.status === 'sending') { m.status = 'failed'; const r = record(m); if (r) r.delivery = 'failed'; }
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
// The first administrator comes from the server settings; it is used only while no administrator exists.
if (noAdmins() && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  try { const a = createAdmin({ name: process.env.ADMIN_NAME || 'Administrator', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }); audit(a.name, 'First administrator created from server settings'); save(); }
  catch (e) { console.error(`  Could not create the administrator: ${e.message}`); }
}
process.on('SIGINT', () => { save(); process.exit(0); });
process.on('SIGTERM', () => { save(); process.exit(0); });
server.listen(PORT, process.env.HOST || '127.0.0.1', () => { console.log(`\n  Dashboard ready: http://localhost:${PORT}`); if (noAdmins()) console.log('  No administrator yet: set ADMIN_EMAIL and ADMIN_PASSWORD, then restart.'); console.log(''); });
