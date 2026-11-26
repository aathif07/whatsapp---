// Unofficial WhatsApp Web link (QR scan). Breaks WhatsApp's terms: trial use with a spare number only.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { makeChats, unwrap, textOf, isGroup } from './chats.js';

const GAP = 3000; // at most one message every 3 seconds per number
const quiet = { level: 'silent', child: () => quiet, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
// The crypto library prints session keys when it rotates them; keep those out of the server log.
for (const k of ['info', 'log', 'warn', 'error']) { const f = console[k].bind(console); console[k] = (...a) => { if (!/^(Closing (open )?session|Opening session|Removing old closed session|Session already|Session error|Failed to decrypt message|Decrypted message with closed)/i.test(String(a[0]))) f(...a); }; }

const digitsOf = (jid) => jid?.endsWith('@s.whatsapp.net') ? jid.split('@')[0].split(':')[0] : null;

export function makeQr({ sql, dir, onMessage, onStatus, onState, onChats = () => {}, getText, lib }) {
  sql.exec('CREATE TABLE IF NOT EXISTS qr_auth (account TEXT NOT NULL, k TEXT NOT NULL, v BLOB NOT NULL, PRIMARY KEY (account, k))');
  const keyFile = join(dir, 'session.key');
  let key;
  if (process.env.WA_SESSION_KEY) { key = Buffer.from(process.env.WA_SESSION_KEY, 'hex'); if (key.length !== 32) throw new Error('WA_SESSION_KEY must be 64 hex characters.'); }
  else { if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 }); key = readFileSync(keyFile); }
  const seal = (s) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv), b = Buffer.concat([c.update(s, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]); };
  const open = (b) => { const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
  const chats = makeChats({ sql, seal, open, onChange: () => onChats() });
  const getRow = sql.prepare('SELECT v FROM qr_auth WHERE account = ? AND k = ?'), putRow = sql.prepare('INSERT INTO qr_auth VALUES (?,?,?) ON CONFLICT (account, k) DO UPDATE SET v = excluded.v'), delRow = sql.prepare('DELETE FROM qr_auth WHERE account = ? AND k = ?');
  const wipe = (a) => sql.prepare('DELETE FROM qr_auth WHERE account = ?').run(a);
  const hasSession = (a) => !!getRow.get(a, 'creds');
  const live = new Map(); // account id -> { state, qr, error, sock, tries, chain, timer }

  async function authState(a, B) {
    const rd = (k) => { const r = getRow.get(a, k); return r ? JSON.parse(open(r.v), B.BufferJSON.reviver) : null; };
    const enc = (v) => seal(JSON.stringify(v, B.BufferJSON.replacer));
    const creds = rd('creds') ?? B.initAuthCreds();
    return { creds, saveCreds: () => putRow.run(a, 'creds', enc(creds)),
      keys: {
        get: async (type, ids) => Object.fromEntries(ids.map((i) => { let v = rd(`${type}-${i}`); if (type === 'app-state-sync-key' && v) v = B.proto.Message.AppStateSyncKeyData.fromObject(v); return [i, v]; })),
        set: async (data) => sql.transaction(() => { for (const t in data) for (const i in data[t]) { const v = data[t][i]; v ? putRow.run(a, `${t}-${i}`, enc(v)) : delRow.run(a, `${t}-${i}`); } })(),
      } };
  }
  const set = (a, x, patch) => { if (live.get(a) !== x) return; Object.assign(x, patch); onState(a, { state: x.state, phone: patch.phone }); };
  function drop(a) { const x = live.get(a); if (!x) return; live.delete(a); clearTimeout(x.timer); try { x.sock?.end?.(undefined); } catch { /* already closed */ } }

  async function start(a, tries = 0) {
    drop(a);
    const x = { state: tries ? 'reconnecting' : 'starting', qr: null, error: null, sock: null, chain: Promise.resolve(), timer: null, tries }; live.set(a, x); set(a, x, {});
    try {
      const B = lib ?? await import('baileys'), auth = await authState(a, B);
      let version; try { version = (await B.fetchLatestWaWebVersion({ signal: AbortSignal.timeout(8000) })).version; } catch { /* use the built-in version */ }
      if (live.get(a) !== x) return;
      const sock = x.sock = B.makeWASocket({ auth: { creds: auth.creds, keys: auth.keys }, ...(version && { version }), logger: quiet, browser: B.Browsers.macOS('Chrome'), markOnlineOnConnect: false, syncFullHistory: false,
        shouldIgnoreJid: (j) => /@(broadcast|newsletter)$/.test(j ?? ''), getMessage: async (k) => { const t = getText(a, k.id) ?? chats.textById(a, k.id); return t ? { conversation: t } : undefined; } });
      sock.ev.on('creds.update', () => { if (live.get(a) === x) auth.saveCreds(); });
      sock.ev.on('connection.update', async (u) => {
        if (live.get(a) !== x) return;
        if (u.qr) { const img = await QRCode.toDataURL(u.qr, { width: 320, margin: 2 }); if (x.state !== 'connected') set(a, x, { state: 'scan', qr: img }); }
        if (u.connection === 'open') set(a, x, { state: 'connected', qr: null, error: null, tries: 0, phone: '+' + sock.user.id.split('@')[0].split(':')[0] });
        if (u.connection === 'close') {
          const code = u.lastDisconnect?.error?.output?.statusCode, paired = !!auth.creds.me;
          if (code === 401) { wipe(a); set(a, x, { state: 'loggedout', qr: null, error: 'Logged out from the phone. Scan again.' }); }
          else if (code === 403) set(a, x, { state: 'blocked', qr: null, error: 'WhatsApp refused this number. It may be banned.' });
          else if (code === 440) set(a, x, { state: 'stopped', qr: null, error: 'This link was opened somewhere else.' });
          else if (code === 515) start(a);
          else if (!paired) set(a, x, { state: 'stopped', qr: null, error: code === 408 ? 'The QR code expired. Try again.' : 'Could not reach WhatsApp. Try again.' });
          else { const n = x.tries + 1; set(a, x, { state: 'reconnecting', qr: null, tries: n }); x.timer = setTimeout(() => start(a, n), Math.min(60_000, 2000 * 2 ** Math.min(n, 5))); }
        }
      });
      const safe = (what, f) => (v) => { if (live.get(a) !== x) return; try { chats.tx(() => f(v)); onChats(); } catch (e) { console.error('whatsapp', what, e.message); } };
      const raw = (m) => Buffer.from(B.proto.WebMessageInfo.encode(B.proto.WebMessageInfo.fromObject(m)).finish()).toString('base64');
      sock.ev.on('messaging-history.set', safe('history', (h) => {
        for (const y of h.lidPnMappings ?? []) chats.map(a, y.lid, y.pn);
        for (const y of h.contacts ?? []) chats.contact(a, y);
        for (const y of h.chats ?? []) chats.chat(a, y, true);
        for (const y of h.messages ?? []) chats.add(a, y, { raw });
      }));
      sock.ev.on('contacts.upsert', safe('contacts', (l) => l.forEach((y) => chats.contact(a, y))));
      sock.ev.on('contacts.update', safe('contacts', (l) => l.forEach((y) => chats.contact(a, y))));
      sock.ev.on('chats.upsert', safe('chats', (l) => l.forEach((y) => chats.chat(a, y, true))));
      sock.ev.on('chats.update', safe('chats', (l) => l.forEach((y) => chats.chat(a, y, false))));
      sock.ev.on('groups.upsert', safe('groups', (l) => l.forEach((y) => chats.chat(a, y, true))));
      sock.ev.on('groups.update', safe('groups', (l) => l.forEach((y) => chats.chat(a, y, false))));
      sock.ev.on('lid-mapping.update', safe('mapping', (y) => chats.map(a, y.lid, y.pn)));
      sock.ev.on('messages.upsert', safe('messages', ({ messages, type }) => messages.forEach((m) => m.message && chats.add(a, m, { live: type === 'notify', raw }))));
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return;
        for (const m of messages) try {
          if (live.get(a) !== x || m.key.fromMe || !m.message) continue;
          if (isGroup(m.key.remoteJid)) continue; // groups are shown but never mark attendance
          let from = digitsOf(m.key.remoteJid) ?? digitsOf(m.key.remoteJidAlt);
          if (!from && m.key.remoteJid?.endsWith('@lid')) from = digitsOf(chats.canon(a, m.key.remoteJid)) ?? digitsOf(await sock.signalRepository?.lidMapping?.getPNForLID(m.key.remoteJid));
          if (!from) continue;
          const body = unwrap(m.message), ts = Number(m.messageTimestamp?.toNumber?.() ?? m.messageTimestamp) * 1000;
          if (!body || body.protocolMessage || body.reactionMessage) continue;
          onMessage(a, { id: `${a}:${m.key.id}`, from, at: Math.min(Date.now(), ts || Date.now()), text: textOf(body), type: body.locationMessage || body.liveLocationMessage ? 'location' : 'attachment' });
        } catch (e) { console.error('whatsapp qr message', e.message); }
      });
      sock.ev.on('messages.update', (list) => { for (const { key: k, update } of list) { const st = { 0: 'failed', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' }[update.status]; if (st && k.fromMe) onStatus(a, k.id, st); } });
      sock.ev.on('messages.update', safe('updates', (list) => { for (const { key: k, update: u } of list) {
        const st = { 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' }[u.status]; if (st && k.fromMe) chats.setStatus(a, k.remoteJid, k.id, st);
        if (u.message === null && u.messageStubType) chats.change(a, k.remoteJid, k.id, { deleted: true });
        else if (u.message?.editedMessage) { const t = textOf(unwrap(u.message)); if (t) chats.change(a, k.remoteJid, k.id, { text: t, edited: true }); }
      } }));
    } catch (e) { console.error('whatsapp qr', e.message); set(a, x, { state: 'stopped', error: 'Could not start the WhatsApp link. Try again.' }); }
  }
  function send(a, to, text) {
    const x = live.get(a); if (x?.state !== 'connected') return Promise.reject(new Error('This WhatsApp is not connected.'));
    const job = x.chain.then(async () => {
      if (live.get(a) !== x || x.state !== 'connected') throw new Error('This WhatsApp is not connected.');
      const r = await x.sock.sendMessage(to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`, { text }, { linkPreview: null });
      if (!r?.key?.id) throw new Error('WhatsApp did not accept the message.');
      return r.key.id;
    });
    x.chain = job.catch(() => {}).then(() => new Promise((r) => setTimeout(r, lib ? 0 : GAP)));
    return job;
  }
  async function unlink(a) { const x = live.get(a); try { if (x?.state === 'connected') await Promise.race([x.sock.logout(), new Promise((r) => setTimeout(r, 4000))]); } catch { /* remove locally anyway */ } drop(a); wipe(a); }
  const view = (a) => { const x = live.get(a); return { state: x?.state ?? 'off', qr: x?.qr ?? null, error: x?.error ?? null }; };
  async function media(a, jid, id) {
    const b = chats.media(a, jid, id), x = live.get(a); if (!b) return null;
    if (b.size > 25e6) throw Object.assign(new Error('This file is too large to open here.'), { status: 413 });
    const B = lib ?? await import('baileys'), m = B.proto.WebMessageInfo.decode(Buffer.from(b.raw, 'base64'));
    try { return { ...b, data: await B.downloadMediaMessage(m, 'buffer', {}, { logger: quiet, reuploadRequest: (y) => { if (x?.state !== 'connected') throw new Error('offline'); return x.sock.updateMediaMessage(y); } }) }; }
    catch { throw Object.assign(new Error('This file is no longer available.'), { status: 410 }); }
  }
  return { chats, media, start, stop: drop, send, unlink, view, hasSession };
}
