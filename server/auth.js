import { scryptSync, randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto';
const bad = (m, status = 400) => { throw Object.assign(new Error(m), { status }); };
const HOUR = 3_600_000, TTL = { admin: 12 * HOUR, user: 30 * 24 * HOUR };
export const hash = (p) => { const s = randomBytes(16); return `${s.toString('hex')}:${scryptSync(p, s, 64).toString('hex')}`; };
export const check = (p, h) => { const [s, k] = h.split(':'); return timingSafeEqual(scryptSync(p, Buffer.from(s, 'hex'), 64), Buffer.from(k, 'hex')); };
const DUMMY = hash('no such account');
const digest = (t) => createHash('sha256').update(t).digest('hex');
export const newPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const same = (a, b) => timingSafeEqual(Buffer.from(digest(String(a))), Buffer.from(digest(String(b))));

export function makeAuth(sql, secure) {
  const fails = new Map();
  const cookie = (q, name) => (q.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1) ?? '';
  /** At most 5 wrong tries per login and 30 per address every 15 minutes. */
  function attempt(q, key, fn) {
    const now = Date.now(), keys = [['k:' + key, 5], ['ip:' + q.ip, 30]];
    for (const [k, v] of fails) if (v.until < now) fails.delete(k);
    for (const [k, max] of keys) if ((fails.get(k)?.n ?? 0) >= max) bad('Too many attempts. Try again in 15 minutes.', 429);
    const v = fn();
    if (!v) { for (const [k] of keys) { const f = fails.get(k) ?? { n: 0, until: now + 15 * 60_000 }; f.n++; fails.set(k, f); } bad('Those details are not correct.', 401); }
    fails.delete('k:' + key); return v;
  }
  function start(r, kind, subject) {
    const t = randomBytes(32).toString('base64url');
    sql.prepare('DELETE FROM logins WHERE expires < ?').run(Date.now());
    sql.prepare('INSERT INTO logins VALUES (?,?,?,?)').run(digest(t), kind, subject, Date.now() + TTL[kind]);
    r.cookie(kind + '_session', t, { httpOnly: true, sameSite: 'strict', secure, maxAge: TTL[kind], path: '/' });
  }
  function who(q, kind) {
    const t = cookie(q, kind + '_session');
    return t ? sql.prepare('SELECT subject FROM logins WHERE token = ? AND kind = ? AND expires > ?').get(digest(t), kind, Date.now())?.subject : undefined;
  }
  function end(q, r, kind) { const t = cookie(q, kind + '_session'); if (t) sql.prepare('DELETE FROM logins WHERE token = ?').run(digest(t)); r.clearCookie(kind + '_session', { path: '/' }); }
  const revoke = (kind, subject) => sql.prepare('DELETE FROM logins WHERE kind = ? AND subject = ?').run(kind, subject);
  return { attempt, start, who, end, revoke, verify: (p, h) => check(String(p ?? ''), h ?? DUMMY) && !!h };
}
