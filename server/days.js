// The one place attendance is decided. Every channel (web, WhatsApp, admin) calls punch().
const TZ = 330 * 60_000, HOUR = 3_600_000, CARRY = 16 * HOUR; // IST has no daylight saving
export const day = (t = Date.now()) => new Date(t + TZ).toISOString().slice(0, 10);
export const ist = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);
const addDay = (date, n = 1) => new Date(Date.parse(date + 'T00:00:00Z') + n * 24 * HOUR).toISOString().slice(0, 10);
const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const bad = (m, status = 400) => { throw Object.assign(new Error(m), { status }); };

export function makeDays(sql, getShift) {
  const one = sql.prepare('SELECT * FROM days WHERE user_id = ? AND date = ?');
  const openRow = sql.prepare('SELECT * FROM days WHERE user_id = ? AND out_at IS NULL AND in_at >= ? ORDER BY in_at DESC LIMIT 1');
  const insert = sql.prepare('INSERT INTO days (user_id, code, name, date, in_at, in_source, in_loc, late_min) VALUES (?,?,?,?,?,?,?,?)');
  const close = sql.prepare('UPDATE days SET out_at = ?, out_source = ?, out_loc = ? WHERE id = ? AND out_at IS NULL');
  const loc = (l) => l ? JSON.stringify(l) : null;
  const late = (date, at) => { const s = getShift(), m = Math.floor((at - ist(date, s.start)) / 60_000); return m > s.grace ? m : 0; };

  /** Today's row, or a shift that began before midnight and has not been closed. */
  const current = (userId, at = Date.now()) => one.get(userId, day(at)) ?? openRow.get(userId, at - CARRY) ?? null;
  function next(userId, at = Date.now()) {
    const today = one.get(userId, day(at));
    const open = today ? (today.out_at ? null : today) : openRow.get(userId, at - CARRY);
    return { canIn: !today, canOut: !!open, done: !!today?.out_at, row: today ?? open ?? null };
  }
  function punch(user, type, { source, location = null, at = Date.now() }) {
    if (!user.active) bad('Your account is inactive. Please contact your administrator.', 403);
    const n = next(user.id, at), date = day(at);
    if (type === 'in') {
      if (!n.canIn) bad(n.done ? 'Today’s attendance is already completed.' : 'You have already marked IN today.', 409);
      try { insert.run(user.id, user.code, user.name, date, at, source, loc(location), late(date, at)); }
      catch (e) { if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') bad('You have already marked IN today.', 409); throw e; }
      return one.get(user.id, date);
    }
    if (n.done) bad('You have already marked OUT today.', 409);
    if (!n.canOut) bad('Mark IN first.', 409);
    if (at < n.row.in_at && n.row.in_at - at < 5000) at = n.row.in_at; // WhatsApp times have no milliseconds
    if (at < n.row.in_at) bad('OUT cannot be before IN.');
    if (!close.run(at, source, loc(location), n.row.id).changes) bad('You have already marked OUT today.', 409);
    return one.get(user.id, n.row.date);
  }
  /** Admin correction. Times are HH:MM IST; an OUT earlier than IN means the next day. */
  function correct(user, date, inTime, outTime) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || addDay(date, 0) !== date) bad('Enter a valid date.');
    if (date > day()) bad('You cannot correct a future date.');
    const ok = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    const old = one.get(user.id, date) ?? null;
    if (!inTime && !outTime) { if (!old) bad('There is nothing to clear for that day.'); sql.prepare('DELETE FROM days WHERE id = ?').run(old.id); return { old, now: null }; }
    if (!ok(inTime)) bad('Enter a valid IN time.');
    if (outTime && !ok(outTime)) bad('Enter a valid OUT time.');
    const keep = (t, prev) => prev != null && ist(date, t) === Math.floor(prev / 60_000) * 60_000 ? prev : ist(date, t); // unchanged time keeps its seconds
    const in_at = keep(inTime, old?.in_at);
    let out_at = outTime ? ist(date, outTime) : null;
    if (outTime && outTime < inTime) out_at = ist(addDay(date), outTime);
    if (out_at != null && old?.out_at != null && Math.floor(old.out_at / 60_000) * 60_000 === out_at) out_at = old.out_at;
    if (out_at != null && out_at < in_at) out_at = in_at;
    if (in_at > Date.now() || (out_at ?? 0) > Date.now()) bad('You cannot enter a future time.');
    sql.prepare(`INSERT INTO days (user_id, code, name, date, in_at, out_at, in_source, out_source, late_min, corrected) VALUES (@u,@code,@name,@date,@in_at,@out_at,@is,@os,@late,1)
      ON CONFLICT (user_id, date) DO UPDATE SET in_at = @in_at, out_at = @out_at, in_source = @is, out_source = @os, late_min = @late, corrected = 1`)
      .run({ u: user.id, code: user.code, name: user.name, date, in_at, out_at, is: old?.in_at === in_at ? old.in_source : 'admin', os: out_at == null ? null : old?.out_at === out_at ? old.out_source : 'admin', late: late(date, in_at) });
    return { old, now: one.get(user.id, date) };
  }
  function view(r, at = Date.now()) {
    const working = !r.out_at && current(r.user_id, at)?.id === r.id;
    return { id: r.id, userId: r.user_id, code: r.code, name: r.name, date: r.date, inAt: r.in_at, outAt: r.out_at, inSource: r.in_source, outSource: r.out_source,
      location: r.in_loc ? JSON.parse(r.in_loc) : null, outLocation: r.out_loc ? JSON.parse(r.out_loc) : null, late: r.late_min, corrected: !!r.corrected,
      minutes: r.out_at ? Math.floor((r.out_at - r.in_at) / 60_000) : null, status: r.out_at ? 'completed' : working ? 'working' : 'missing' };
  }
  /** Every employee-day in range, including days with no attendance. */
  function list(users, { from, to, userId } = {}) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    to = re.test(to) ? to : day(); from = re.test(from) ? from : to;
    if (from > to) bad('The From date must be before the To date.');
    if ((Date.parse(to) - Date.parse(from)) / (24 * HOUR) > 366) bad('Choose a range of one year or less.');
    const rows = sql.prepare('SELECT * FROM days WHERE date BETWEEN ? AND ?').all(from, to).filter((r) => !userId || r.user_id === userId), out = rows.map((r) => view(r));
    const have = new Set(rows.map((r) => r.user_id + r.date)), shift = getShift(), today = day();
    for (let d = from; d <= to && d <= today; d = addDay(d)) {
      const work = shift.days.includes(weekday(d));
      for (const u of users) {
        if ((userId && u.id !== userId) || !u.active || have.has(u.id + d) || day(u.createdAt) > d || (!work && d !== today)) continue;
        out.push({ id: `${u.id}:${d}`, userId: u.id, code: u.code, name: u.name, date: d, inAt: null, outAt: null, inSource: null, outSource: null, location: null, outLocation: null, late: 0, corrected: false, minutes: null, status: !work ? 'off' : d === today ? 'notin' : 'absent' });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  }
  return { punch, next, current, correct, view, list };
}
