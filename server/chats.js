// Chats of QR-linked numbers (names, text and media keys are encrypted at rest).
const bare = (j) => j ? j.replace(/:\d+(?=@)/, '') : j;
export const isPn = (j) => !!j?.endsWith('@s.whatsapp.net'), isLid = (j) => !!j?.endsWith('@lid'), isGroup = (j) => !!j?.endsWith('@g.us');
const MEDIA = { imageMessage: ['image', '📷 Photo'], videoMessage: ['video', '🎥 Video'], ptvMessage: ['video', '🎥 Video'], audioMessage: ['audio', '🎤 Audio'], documentMessage: ['document', '📄 Document'], stickerMessage: ['sticker', 'Sticker'] };
const OTHER = { locationMessage: '📍 Location', liveLocationMessage: '📍 Live location', contactMessage: '👤 Contact', contactsArrayMessage: '👤 Contacts', pollCreationMessage: '📊 Poll', pollCreationMessageV3: '📊 Poll', callLogMesssage: '📞 Call', eventMessage: '📅 Event' };
export const unwrap = (m) => { for (let i = 0; m && i < 6; i++) { const n = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message ?? m.viewOnceMessageV2Extension?.message ?? m.documentWithCaptionMessage?.message ?? m.editedMessage?.message ?? m.deviceSentMessage?.message; if (!n) break; m = n; } return m; };
export const textOf = (m) => m?.conversation ?? m?.extendedTextMessage?.text ?? m?.buttonsResponseMessage?.selectedDisplayText ?? m?.templateButtonReplyMessage?.selectedDisplayText ?? m?.listResponseMessage?.title ?? null;
/** What to show for a message, or null for protocol noise. */
export function content(message) {
  const m = unwrap(message); if (!m) return null;
  const t = textOf(m); if (t) return { kind: 'text', text: t };
  for (const k in MEDIA) if (m[k]) return { kind: MEDIA[k][0], text: m[k].caption || (k === 'documentMessage' && m[k].fileName) || MEDIA[k][1], mime: m[k].mimetype ?? '', file: m[k].fileName ?? '', size: Number(m[k].fileLength ?? 0) };
  for (const k in OTHER) if (m[k]) return { kind: 'other', text: OTHER[k] };
  return null;
}
const secs = (t) => Number(t?.toNumber?.() ?? t ?? 0) * 1000;
const RANK = { sent: 1, delivered: 2, read: 3 };

export function makeChats({ sql, seal, open, onChange }) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS wa_chats (account TEXT NOT NULL, jid TEXT NOT NULL, name BLOB, last BLOB, at INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account, jid));
    CREATE TABLE IF NOT EXISTS wa_msgs (account TEXT NOT NULL, jid TEXT NOT NULL, id TEXT NOT NULL, me INTEGER NOT NULL, at INTEGER NOT NULL, status TEXT, body BLOB NOT NULL, PRIMARY KEY (account, jid, id));
    CREATE INDEX IF NOT EXISTS wa_msgs_at ON wa_msgs (account, jid, at);
    CREATE TABLE IF NOT EXISTS wa_lid (account TEXT NOT NULL, lid TEXT NOT NULL, pn TEXT NOT NULL, PRIMARY KEY (account, lid));
    CREATE TABLE IF NOT EXISTS wa_names (account TEXT NOT NULL, jid TEXT NOT NULL, saved BLOB, push BLOB, PRIMARY KEY (account, jid));`);
  const P = (s) => sql.prepare(s), s = (v) => v == null ? null : seal(String(v)), o = (b) => b ? open(b) : null;
  const q = { pn: P('SELECT pn FROM wa_lid WHERE account=? AND lid=?'), putPn: P('INSERT OR REPLACE INTO wa_lid VALUES (?,?,?)'), chat: P('SELECT * FROM wa_chats WHERE account=? AND jid=?'),
    ensure: P('INSERT OR IGNORE INTO wa_chats (account,jid) VALUES (?,?)'), last: P('UPDATE wa_chats SET last=?, at=? WHERE account=? AND jid=? AND (at<=? OR last IS NULL)'), cname: P('UPDATE wa_chats SET name=? WHERE account=? AND jid=?'), unread: P('UPDATE wa_chats SET unread=? WHERE account=? AND jid=?'), inc: P('UPDATE wa_chats SET unread=unread+1 WHERE account=? AND jid=?'),
    msg: P('INSERT OR IGNORE INTO wa_msgs VALUES (?,?,?,?,?,?,?)'), one: P('SELECT * FROM wa_msgs WHERE account=? AND jid=? AND id=?'), byId: P('SELECT * FROM wa_msgs WHERE account=? AND id=?'), body: P('UPDATE wa_msgs SET body=? WHERE account=? AND jid=? AND id=?'), status: P('UPDATE wa_msgs SET status=? WHERE account=? AND jid=? AND id=?'),
    name: P('SELECT * FROM wa_names WHERE account=? AND jid=?'), saved: P('INSERT INTO wa_names (account,jid,saved) VALUES (?,?,?) ON CONFLICT DO UPDATE SET saved=excluded.saved'), push: P('INSERT INTO wa_names (account,jid,push) VALUES (?,?,?) ON CONFLICT DO UPDATE SET push=excluded.push') };
  const tx = (f) => sql.transaction(f)();
  /** One person can appear under a hidden @lid or a phone number; keep one chat under the phone number. */
  const canon = (a, jid) => { jid = bare(jid); return isLid(jid) ? q.pn.get(a, jid)?.pn ?? jid : jid; };
  function map(a, lid, pn) {
    lid = bare(lid); pn = bare(pn); if (!isLid(lid) || !isPn(pn) || q.pn.get(a, lid)?.pn === pn) return;
    tx(() => {
      q.putPn.run(a, lid, pn);
      const old = q.chat.get(a, lid);
      if (old) {
        q.ensure.run(a, pn); const now = q.chat.get(a, pn);
        P('UPDATE OR IGNORE wa_msgs SET jid=? WHERE account=? AND jid=?').run(pn, a, lid); P('DELETE FROM wa_msgs WHERE account=? AND jid=?').run(a, lid);
        if (old.at > now.at) q.last.run(old.last, old.at, a, pn, old.at);
        if (old.name && !now.name) q.cname.run(old.name, a, pn);
        q.unread.run(old.unread + now.unread, a, pn); P('DELETE FROM wa_chats WHERE account=? AND jid=?').run(a, lid);
      }
      const n = q.name.get(a, lid); if (n) { if (n.saved) q.saved.run(a, pn, n.saved); if (n.push) q.push.run(a, pn, n.push); }
    });
  }
  const keep = (j) => isPn(j) || isLid(j) || isGroup(j);
  function add(a, m, { live = false, raw = null } = {}) {
    const k = m.key; if (!k?.id || !keep(bare(k.remoteJid))) return false;
    if (k.remoteJidAlt) { map(a, k.remoteJid, k.remoteJidAlt); map(a, k.remoteJidAlt, k.remoteJid); }
    if (k.participantAlt) { map(a, k.participant, k.participantAlt); map(a, k.participantAlt, k.participant); }
    const c = content(m.message); if (!c) return false;
    const jid = canon(a, k.remoteJid), at = Math.min(Date.now(), secs(m.messageTimestamp) || Date.now()), by = isGroup(jid) && !k.fromMe ? bare(k.participant ?? m.participant ?? '') : '';
    if (m.pushName && !k.fromMe) { const who = canon(a, by || k.remoteJid); if (!isGroup(who) && o(q.name.get(a, who)?.push) !== m.pushName) q.push.run(a, who, s(m.pushName)); }
    q.ensure.run(a, jid);
    const st = k.fromMe ? { 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' }[m.status] ?? 'sent' : null;
    if (!q.msg.run(a, jid, k.id, k.fromMe ? 1 : 0, at, st, seal(JSON.stringify({ ...c, by, ...(raw && ['image', 'video', 'audio', 'document', 'sticker'].includes(c.kind) && { raw: raw(m) }) }))).changes) return false;
    q.last.run(s(JSON.stringify({ text: c.text.slice(0, 200), me: !!k.fromMe, status: st })), at, a, jid, at);
    if (live && !k.fromMe) q.inc.run(a, jid); else if (live && k.fromMe) q.unread.run(0, a, jid);
    return true;
  }
  function chat(a, c, fresh) {
    if (!c.id || !keep(bare(c.id))) return;
    if (c.pnJid) map(a, c.id, c.pnJid); if (c.lidJid) map(a, c.lidJid, c.id);
    const jid = canon(a, c.id), at = secs(c.conversationTimestamp), had = q.chat.get(a, jid);
    if (!had && !fresh) return;
    q.ensure.run(a, jid);
    if (c.name || c.subject) q.cname.run(s(c.name || c.subject), a, jid);
    if (fresh && at && !had) P('UPDATE wa_chats SET at=? WHERE account=? AND jid=? AND at=0').run(at, a, jid);
    if (c.unreadCount != null && (fresh ? !had?.unread : c.unreadCount === 0)) q.unread.run(Math.max(0, c.unreadCount), a, jid);
  }
  function contact(a, c) {
    if (!c.id) return;
    if (c.lid) map(a, c.lid, c.id); if (c.phoneNumber) map(a, c.id, c.phoneNumber);
    const jid = canon(a, c.id); if (!keep(jid)) return;
    if (isGroup(jid)) { if (c.name) { q.ensure.run(a, jid); q.cname.run(s(c.name), a, jid); } return; }
    if (c.name) q.saved.run(a, jid, s(c.name)); if (c.notify || c.verifiedName) q.push.run(a, jid, s(c.notify || c.verifiedName));
  }
  const phone = (j) => isPn(j) ? '+' + j.split('@')[0] : null;
  const nameOf = (a, jid) => { const n = q.name.get(a, jid); return o(n?.saved) ?? o(n?.push); };
  function list(a) {
    return P('SELECT * FROM wa_chats WHERE account=? AND (at>0 OR last IS NOT NULL) ORDER BY at DESC').all(a).map((c) => ({ jid: c.jid, group: isGroup(c.jid), phone: phone(c.jid), name: (isGroup(c.jid) ? o(c.name) ?? 'Group' : nameOf(a, c.jid) ?? o(c.name)) ?? phone(c.jid) ?? 'Unknown', at: c.at, unread: c.unread, last: c.last ? JSON.parse(open(c.last)) : null }));
  }
  function messages(a, jid, before = Infinity) {
    const rows = P('SELECT * FROM wa_msgs WHERE account=? AND jid=? AND at<? ORDER BY at DESC, rowid DESC LIMIT 100').all(a, jid, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER).reverse();
    return rows.map((r) => { const b = JSON.parse(open(r.body)), by = b.by ? canon(a, b.by) : ''; return { id: r.id, dir: r.me ? 'out' : 'in', at: r.at, status: r.status, text: b.text, kind: b.kind, file: b.file, media: !!b.raw, edited: !!b.edited, by: by ? nameOf(a, by) ?? phone(by) ?? 'Member' : '' }; });
  }
  function setStatus(a, jid, id, st) { const r = q.one.get(a, canon(a, jid), id); if (r?.me && RANK[st] > (RANK[r.status] ?? 0)) q.status.run(st, a, r.jid, id); }
  function change(a, jid, id, patch) { const r = q.one.get(a, canon(a, jid), id); if (r) { const b = JSON.parse(open(r.body)); q.body.run(seal(JSON.stringify(patch.deleted ? { kind: 'deleted', text: 'This message was deleted', by: b.by } : { ...b, ...patch })), a, r.jid, id); const c = q.chat.get(a, r.jid); if (c.at === r.at) q.last.run(s(JSON.stringify({ text: patch.text ?? 'This message was deleted', me: !!r.me, status: r.status })), r.at, a, r.jid, r.at); } }
  const media = (a, jid, id) => { const r = q.one.get(a, jid, id); if (!r) return null; const b = JSON.parse(open(r.body)); return b.raw ? b : null; };
  const textById = (a, id) => { const r = q.byId.get(a, id); return r ? JSON.parse(open(r.body)).text : null; };
  function removeChat(a, jid) { tx(() => { P('DELETE FROM wa_msgs WHERE account=? AND jid=?').run(a, jid); P('DELETE FROM wa_chats WHERE account=? AND jid=?').run(a, jid); }); onChange(); }
  const clear = (a) => tx(() => { for (const t of ['wa_msgs', 'wa_chats', 'wa_lid', 'wa_names']) P(`DELETE FROM ${t} WHERE account=?`).run(a); });
  const read = (a, jid) => { if (q.chat.get(a, jid)?.unread) { q.unread.run(0, a, jid); onChange(); } };
  const unread = (a) => P('SELECT COUNT(*) c FROM wa_chats WHERE account=? AND unread>0').get(a).c;
  return { add, chat, contact, map, list, messages, setStatus, change, media, textById, removeChat, clear, read, unread, tx, canon, has: (a, j) => !!q.chat.get(a, j) };
}
