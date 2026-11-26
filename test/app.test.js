import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { makeDays, day, ist } from '../server/days.js';
import { openStore } from '../server/store.js';

const PORT = 4700 + process.pid % 200, B = `http://127.0.0.1:${PORT}`, dir = mkdtempSync(join(tmpdir(), 'att-'));
let proc, graph, gport, sent = [], admin = '', emp = '';
const req = async (path, method = 'GET', body, cookie = '', headers = {}) => {
  const r = await fetch(B + path, { method, headers: { cookie, ...(body && { 'Content-Type': 'application/json' }), ...headers }, body: body && JSON.stringify(body) });
  const text = await r.text(); let j = text; try { j = JSON.parse(text); } catch {}
  return { s: r.status, j, cookie: r.headers.get('set-cookie')?.split(';')[0], raw: r.headers.get('set-cookie') };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot() {
  proc = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir, NODE_ENV: 'production', WA_TOKEN: 't', ADMIN_EMAIL: 'A@B.co', ADMIN_PASSWORD: 'long-password-1', WA_APP_SECRET: 's3', WA_VERIFY_TOKEN: 'vt', PUBLIC_URL: 'https://x.test', WA_GRAPH_URL: `http://127.0.0.1:${gport}` } });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  await new Promise((ok) => proc.stdout.on('data', (d) => { if (/Dashboard ready/.test(d)) setTimeout(ok, 100); }));
}
before(async () => {
  graph = http.createServer((q, r) => { let b = ''; q.on('data', (d) => b += d); q.on('end', () => { sent.push({ url: q.url, auth: q.headers.authorization, b: b && JSON.parse(b) }); r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify(/messages$/.test(q.url) ? { messages: [{ id: 'wamid.' + sent.length }] } : { display_phone_number: '+91 90000 11111', verified_name: 'Co', code_verification_status: 'VERIFIED', success: true })); }); });
  await new Promise((ok) => graph.listen(0, '127.0.0.1', ok)); gport = graph.address().port; await boot();
});
after(() => { proc.kill(); graph.close(); rmSync(dir, { recursive: true, force: true }); });
const hook = (value, secret = 's3') => { const body = JSON.stringify({ entry: [{ changes: [{ field: 'messages', value }] }] }); return fetch(B + '/webhook/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex') }, body }).then((r) => r.status); };
let liveUser, acc, n = 0;
const say = (text, extra = {}) => hook({ metadata: { phone_number_id: '123456789' }, messages: [{ id: 'in.' + ++n, from: '919800000002', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text }, ...extra }] });

test('nothing is readable without signing in', async () => {
  for (const p of ['/api/state', '/api/days', '/api/export.csv', '/api/days.csv', '/api/admins', '/api/sim/x', '/api/me', '/api/audit']) assert.equal((await req(p)).s, 401, p);
  for (const p of ['/data/app.db', '/server.js', '/server/auth.js']) assert.equal((await req(p)).s, 404, p);
  assert.equal((await req('/socket.io/?EIO=4&transport=polling')).s, 200); // transport only; namespace join is refused
});
test('first admin comes from server settings; cookie is protected', async () => {
  assert.equal((await req('/api/auth/setup', 'POST', { code: 'x' })).s, 401); // removed
  assert.equal((await req('/api/auth/login', 'POST', { email: 'a@b.co', password: 'wrong-password' })).s, 401);
  const r = await req('/api/auth/login', 'POST', { email: 'a@b.co', password: 'long-password-1' }); assert.equal(r.s, 200); admin = r.cookie;
  assert.match(r.raw, /HttpOnly/); assert.match(r.raw, /SameSite=Strict/); assert.match(r.raw, /Secure/);
  assert.equal((await req('/api/admins', 'GET', null, admin)).j.length, 1);
  assert.equal((await req('/api/state', 'GET', null, admin)).s, 200);
});
test('requests from another site are refused', async () => assert.equal((await req('/api/auth/logout', 'POST', {}, admin, { origin: 'https://evil.test' })).s, 403));
test('web IN then OUT, no duplicates, admin sees it', async () => {
  acc = (await req('/api/accounts', 'POST', { name: 'Sim', phone: '+919000000001' }, admin)).j;
  const u = (await req('/api/users', 'POST', { name: 'Kumar', phone: '+919800000001', accountId: acc.id, active: true }, admin)).j;
  const { pin } = (await req(`/api/users/${u.id}/pin`, 'POST', {}, admin)).j; assert.match(pin, /^\d{6}$/);
  assert.equal((await req('/api/me/login', 'POST', { phone: '9800000001', pin: 'x' })).s, 401);
  emp = (await req('/api/me/login', 'POST', { phone: '9800000001', pin })).cookie;
  assert.equal((await req('/api/state', 'GET', null, emp)).s, 401);
  const place = { lat: 13, lng: 80, accuracy: 10 };
  assert.equal((await req('/api/me/out', 'POST', place, emp)).s, 409);
  assert.equal((await req('/api/me/in', 'POST', {}, emp)).s, 400);
  const both = await Promise.all([req('/api/me/in', 'POST', place, emp), req('/api/me/in', 'POST', place, emp)]);
  assert.deepEqual(both.map((x) => x.s).sort(), [200, 409]);
  let m = (await req('/api/me', 'GET', null, emp)).j; assert.equal(m.canIn, false); assert.equal(m.canOut, true);
  assert.equal((await req('/api/me/out', 'POST', place, emp)).s, 200);
  assert.equal((await req('/api/me/out', 'POST', place, emp)).s, 409);
  assert.equal((await req('/api/me/in', 'POST', place, emp)).s, 409);
  const row = (await req('/api/days', 'GET', null, admin)).j[0]; assert.equal(row.status, 'completed'); assert.equal(row.inSource, 'web'); assert.ok(row.outAt >= row.inAt);
  assert.equal((await req(`/api/users/${u.id}`, 'PUT', { ...u, active: false }, admin)).s, 200);
  assert.equal((await req('/api/me', 'GET', null, emp)).s, 401);
});
test('login locks after repeated wrong PINs', async () => { let s; for (let i = 0; i < 6; i++) s = (await req('/api/me/login', 'POST', { phone: '9811111111', pin: '000000' })).s; assert.equal(s, 429); });
test('real WhatsApp: connect, IN by link, OUT by reply', async () => {
  const a = (await req('/api/accounts', 'POST', { live: true, name: 'Live', phoneNumberId: '123456789', wabaId: '987654321' }, admin)).j;
  assert.equal(a.phone, '+919000011111'); assert.equal(a.connected, false);
  assert.equal((await req(`/api/accounts/${a.id}/toggle`, 'POST', {}, admin)).s, 400);
  assert.equal((await req(`/api/accounts/${a.id}/setup/connect`, 'POST', {}, admin)).j.connected, true);
  liveUser = (await req('/api/users', 'POST', { name: 'Priya', phone: '+919800000002', accountId: a.id, active: true }, admin)).j;
  assert.equal((await req(`/api/sim/${liveUser.id}/messages`, 'POST', { text: 'in' }, admin)).s, 403);
  assert.equal((await req(`/api/users/${liveUser.id}/messages`, 'POST', { text: 'hi' }, admin)).s, 400); // no open 24 h window
  assert.equal(await hook({}, 'wrong'), 401);
  assert.equal((await req('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42')).j, 42);
  assert.equal((await req('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42')).s, 403);
  await say('out'); await wait(150); assert.match(sent.at(-1).b.text.body, /Mark IN first/);
  await say('I am sick in bed'); await say('IN'); await wait(150);
  const url = sent.at(-1).b.interactive.action.parameters.url, tok = url.split('/').pop(); assert.match(url, /^https:\/\/x\.test\/checkin\//);
  assert.equal((await req('/api/days', 'GET', null, admin)).j.find((x) => x.name === 'Priya').status, 'notin');
  assert.equal((await req('/api/checkin/' + tok, 'POST', { lat: 13, lng: 80, accuracy: 9 })).s, 200);
  assert.equal((await req('/api/checkin/' + tok, 'POST', { lat: 13, lng: 80, accuracy: 9 })).s, 409);
  await say('OUT'); n--; await say('OUT'); await wait(150); // same message id delivered twice
  assert.match(sent.at(-1).b.text.body, /OUT recorded/);
  const row = (await req('/api/days', 'GET', null, admin)).j.find((x) => x.name === 'Priya'); assert.equal(row.status, 'completed'); assert.equal(row.outSource, 'whatsapp');
  assert.equal((await req(`/api/users/${liveUser.id}/messages`, 'POST', { text: 'ok' }, admin)).s, 200); await wait(150);
  const id = 'wamid.' + sent.length; await hook({ metadata: { phone_number_id: '123456789' }, statuses: [{ id, status: 'read' }] }); await hook({ metadata: { phone_number_id: '123456789' }, statuses: [{ id, status: 'delivered' }] });
  assert.equal((await req(`/api/users/${liveUser.id}/messages`, 'GET', null, admin)).j.at(-1).status, 'read');
});
test('office distance and poor GPS are refused', async () => {
  const st = (await req('/api/state', 'GET', null, admin)).j.settings;
  assert.equal((await req('/api/settings', 'PUT', { ...st, office: { lat: 13, lng: 80, radius: 100 } }, admin)).s, 200);
  const u = (await req('/api/users', 'POST', { name: 'Meena', phone: '+919800000003', accountId: acc.id, active: true }, admin)).j, { pin } = (await req(`/api/users/${u.id}/pin`, 'POST', {}, admin)).j;
  const c = (await req('/api/me/login', 'POST', { phone: '9800000003', pin })).cookie;
  assert.match((await req('/api/me/in', 'POST', { lat: 14, lng: 80, accuracy: 5 }, c)).j.error, /away/);
  assert.match((await req('/api/me/in', 'POST', { lat: 13, lng: 80, accuracy: 5000 }, c)).j.error, /accurate/);
  assert.equal((await req('/api/me/in', 'POST', { lat: 13, lng: 80, accuracy: 5 }, c)).s, 200);
});
test('corrections need a reason, are audited; exports work', async () => {
  const b = { userId: liveUser.id, date: '2026-01-05', in: '09:00', out: '18:00' };
  assert.equal((await req('/api/days', 'PUT', b, admin)).s, 400);
  assert.equal((await req('/api/days', 'PUT', { ...b, reason: 'Forgot' }, admin)).s, 200);
  assert.equal((await req('/api/days?from=2026-01-05&to=2026-01-05', 'GET', null, admin)).j[0].minutes, 540);
  assert.match((await req('/api/audit', 'GET', null, admin)).j[0].detail, /Reason: Forgot/);
  assert.match((await req('/api/days.csv', 'GET', null, admin)).j, /Priya/); assert.equal((await req('/api/days.xlsx', 'GET', null, admin)).s, 200);
  for (const f of ['csv', 'xlsx', 'pdf']) assert.equal((await req('/api/export.' + f, 'GET', null, admin)).s, 200);
});
test('reminder session: IN on web marks the person present', async () => {
  const u = (await req('/api/users', 'POST', { name: 'Ravi', phone: '+919800000004', accountId: acc.id, active: true }, admin)).j, { pin } = (await req(`/api/users/${u.id}/pin`, 'POST', {}, admin)).j;
  const s = (await req('/api/sessions', 'POST', { message: 'Hi {{name}}', minutes: 5, accountIds: [acc.id] }, admin)).j; await wait(900);
  const c = (await req('/api/me/login', 'POST', { phone: '9800000004', pin })).cookie; assert.equal((await req('/api/me/in', 'POST', { lat: 13, lng: 80, accuracy: 5 }, c)).s, 200);
  const x = (await req('/api/sessions/' + s.id, 'GET', null, admin)).j; assert.equal(x.records.find((r) => r.name === 'Ravi').status, 'present'); assert.equal(x.records.length, 1);
});
test('everything survives a restart', async () => {
  await wait(250); const gone = new Promise((r) => proc.on('exit', r)); proc.kill(); await gone; await boot();
  assert.equal((await req('/api/state', 'GET', null, admin)).j.users.length, 4);
  assert.equal((await req('/api/days', 'GET', null, admin)).j.find((x) => x.name === 'Priya').status, 'completed');
});
test('day rules: IST dates, overnight OUT, missing OUT, late, absences', () => {
  const d2 = mkdtempSync(join(tmpdir(), 'd-')), { sql } = openStore(d2), D = makeDays(sql, () => ({ start: '09:30', end: '18:30', grace: 10, days: [1, 2, 3, 4, 5, 6] }));
  const u = { id: 'u', code: 'U1', name: 'U', active: true, createdAt: ist('2026-01-01', '00:00') };
  assert.equal(day(Date.parse('2026-01-05T18:31:00Z')), '2026-01-06');
  assert.equal(D.punch(u, 'in', { source: 'web', at: ist('2026-01-05', '09:40') }).late_min, 0);
  assert.throws(() => D.punch(u, 'in', { source: 'whatsapp', at: ist('2026-01-05', '10:00') }), /already/);
  assert.equal(D.punch(u, 'in', { source: 'web', at: ist('2026-01-06', '22:00') }).late_min, 750);
  assert.equal(D.punch(u, 'out', { source: 'web', at: ist('2026-01-07', '06:00') }).date, '2026-01-06');
  assert.throws(() => D.punch(u, 'out', { source: 'web', at: ist('2026-01-07', '07:00') }), /Mark IN first/);
  const l = D.list([u], { from: '2026-01-03', to: '2026-01-07' }).map((x) => x.date.slice(8) + x.status);
  assert.deepEqual(l, ['07absent', '06completed', '05missing', '03absent']); // Sunday the 4th is off
  assert.throws(() => D.correct(u, '2026-02-31', '09:00', ''), /valid date/);
  sql.close(); rmSync(d2, { recursive: true });
});

test('QR link: scan, receive, send, private chats ignored, session encrypted, logout wipes', async () => {
  const { EventEmitter } = await import('node:events'), { makeQr } = await import('../server/qr.js'), d3 = mkdtempSync(join(tmpdir(), 'q-')), { sql } = openStore(d3);
  const got = [], states = [], st = [], socks = [], out = [];
  const lib = { BufferJSON: {}, initAuthCreds: () => ({ secretThing: 'TOPSECRET' }), proto: {}, Browsers: { macOS: () => [] }, fetchLatestWaWebVersion: async () => ({ version: [2] }),
    makeWASocket: (o) => { const s = { o, ev: new EventEmitter(), user: { id: '919000022222:3@s.whatsapp.net' }, end() {}, logout: async () => {}, sendMessage: async (j, m) => { out.push([j, m.text]); return { key: { id: 'W' + out.length } }; }, signalRepository: { lidMapping: { getPNForLID: async () => '919800000009:0@s.whatsapp.net' } } }; socks.push(s); return s; } };
  const q = makeQr({ sql, dir: d3, lib, onMessage: (a, x) => got.push(x), onChats() {}, onStatus: (a, i, x) => st.push([i, x]), onState: (a, x) => states.push(x), getText: () => null });
  await q.start('A'); const s = socks[0]; s.ev.emit('connection.update', { qr: 'abc' }); await wait(60); assert.equal(q.view('A').state, 'scan'); assert.match(q.view('A').qr, /^data:image\/png/);
  await assert.rejects(q.send('A', '+91 98', 'x'), /not connected/);
  s.ev.emit('creds.update'); assert.ok(q.hasSession('A')); assert.ok(!sql.prepare('SELECT v FROM qr_auth').get().v.includes('TOPSECRET'));
  s.o.auth.creds.me = { id: 'x' }; s.ev.emit('connection.update', { connection: 'open' }); assert.equal(states.at(-1).phone, '+919000022222');
  const msg = (jid, message, fromMe = false, id = 'i') => ({ key: { id, remoteJid: jid, fromMe }, message, messageTimestamp: 1700000000 });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msg('919800000002@s.whatsapp.net', { conversation: 'IN' }), msg('77@lid', { ephemeralMessage: { message: { extendedTextMessage: { text: 'OUT' } } } }), msg('1@g.us', { conversation: 'IN' }), msg('919800000002@s.whatsapp.net', { conversation: 'IN' }, true)] }); await wait(30);
  assert.deepEqual(got.map((x) => [x.from, x.text]), [['919800000002', 'IN'], ['919800000009', 'OUT']]);
  assert.equal(await q.send('A', '+91 9800000002', 'hello'), 'W1'); assert.equal(out[0][0], '919800000002@s.whatsapp.net');
  s.ev.emit('messages.update', [{ key: { id: 'W1', fromMe: true }, update: { status: 3 } }]); assert.deepEqual(st, [['W1', 'delivered']]);
  s.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } }); await wait(30); assert.equal(socks.length, 2); assert.equal(socks[1].o.auth.creds.secretThing, 'TOPSECRET');
  socks[1].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }); await wait(10); assert.equal(q.view('A').state, 'loggedout'); assert.ok(!q.hasSession('A'));
  q.stop('A'); sql.close(); rmSync(d3, { recursive: true });
});
test('linked chats: history, names, lid merge, groups, edit, delete, encrypted', async () => {
  const { makeChats } = await import('../server/chats.js'), d4 = mkdtempSync(join(tmpdir(), 'c-')), { sql } = openStore(d4);
  const flip = (b) => Buffer.from(b).map((x) => x ^ 90), C = makeChats({ sql, seal: (s) => flip(Buffer.from(s)), open: (b) => flip(b).toString(), onChange() {} });
  const P = '919800000001@s.whatsapp.net', m = (id, jid, text, t, o = {}) => ({ key: { id, remoteJid: jid, fromMe: !!o.me, ...o.key }, message: o.message ?? { conversation: text }, messageTimestamp: t, pushName: o.push });
  C.contact('A', { id: P, name: 'Ravi Saved' }); C.chat('A', { id: P, conversationTimestamp: 100, unreadCount: 2 }, true);
  C.add('A', m('1', P, 'old', 100)); C.add('A', m('2', '5@lid', 'hidden', 200, { push: 'R' })); assert.equal(C.list('A').length, 2);
  C.map('A', '5@lid', '919800000001@s.whatsapp.net'); let l = C.list('A'); assert.equal(l.length, 1); assert.equal(l[0].name, 'Ravi Saved'); assert.equal(l[0].last.text, 'hidden'); assert.equal(l[0].unread, 2);
  assert.equal(C.add('A', m('2', P, 'hidden', 200)), false); C.add('A', m('3', '5@lid', 'new', 300), { live: true }); assert.equal(C.list('A')[0].unread, 3); C.read('A', P); assert.equal(C.list('A')[0].unread, 0);
  C.add('A', m('4', P, 'mine', 400, { me: true })); C.setStatus('A', P, '4', 'read'); C.setStatus('A', P, '4', 'delivered'); assert.equal(C.messages('A', P).at(-1).status, 'read');
  C.change('A', P, '4', { text: 'fixed', edited: true }); assert.equal(C.list('A')[0].last.text, 'fixed'); C.change('A', P, '3', { deleted: true }); assert.deepEqual(C.messages('A', P).map((x) => x.text), ['old', 'hidden', 'This message was deleted', 'fixed']);
  C.chat('A', { id: '7@g.us', conversationTimestamp: 999 }, true); C.add('A', m('8', '7@g.us', 'before', 90)); assert.equal(C.list('A').find((x) => x.jid === '7@g.us').last.text, 'before'); C.removeChat('A', '7@g.us');
  C.chat('A', { id: '9@g.us', name: 'Office' }, true); C.add('A', m('5', '9@g.us', '', 500, { key: { participant: P }, message: { imageMessage: { caption: 'pic', mimetype: 'image/jpeg' } } }), { raw: () => 'r' }); l = C.list('A'); assert.equal(l[0].name, 'Office'); const g = C.messages('A', '9@g.us')[0]; assert.equal(g.by, 'Ravi Saved'); assert.equal(g.media, true);
  assert.equal(C.add('A', m('6', 'status@broadcast', 'x', 1)), false); assert.equal(C.add('A', m('7', P, '', 1, { message: { protocolMessage: {} } })), false);
  assert.ok(!Buffer.concat(sql.prepare('SELECT body FROM wa_msgs').all().map((r) => r.body)).includes('hidden')); assert.equal(C.list('B').length, 0);
  C.removeChat('A', P); assert.equal(C.list('A').length, 1); C.clear('A'); assert.equal(C.list('A').length, 0); sql.close(); rmSync(d4, { recursive: true });
});
test('deleting a test account can remove its test users', async () => {
  const a = (await req('/api/accounts', 'POST', { name: 'Tmp', phone: '+919000000099' }, admin)).j, u = (await req('/api/users', 'POST', { name: 'T', phone: '+919800000088', accountId: a.id, active: true }, admin)).j;
  assert.equal((await req('/api/accounts/' + a.id, 'DELETE', null, admin)).s, 400); assert.equal((await req('/api/accounts/' + a.id + '?users=1', 'DELETE', null, admin)).s, 200); assert.equal((await req('/api/sim/' + u.id, 'GET', null, admin)).s, 404);
});
test('QR account API needs the risk tick', async () => {
  assert.equal((await req('/api/accounts', 'POST', { type: 'qr', name: 'Q' }, admin)).s, 400);
  const a = (await req('/api/accounts', 'POST', { type: 'qr', name: 'Q', agree: true }, admin)).j; assert.equal(a.connected, false);
  assert.equal((await req(`/api/accounts/${a.id}/qr`)).s, 401); assert.equal((await req(`/api/accounts/${a.id}/qr`, 'GET', null, admin)).j.state, 'off');
  const u = (await req('/api/users', 'POST', { name: 'Q1', phone: '+919800000010', accountId: a.id, active: true }, admin)).j;
  assert.equal((await req(`/api/users/${u.id}/messages`, 'POST', { text: 'x' }, admin)).s, 400); assert.equal((await req(`/api/sim/${u.id}`, 'GET', null, admin)).s, 403);
  assert.deepEqual((await req(`/api/accounts/${a.id}/chats`, 'GET', null, admin)).j, []); assert.equal((await req(`/api/accounts/${a.id}/chats`)).s, 401); assert.equal((await req(`/api/accounts/${a.id}/chats/x`, 'GET', null, admin)).s, 404);
  assert.equal((await req(`/api/users/${u.id}`, 'DELETE', null, admin)).s, 200); assert.equal((await req(`/api/accounts/${a.id}`, 'DELETE', null, admin)).s, 200);
});
