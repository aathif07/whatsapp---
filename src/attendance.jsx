import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Play, Smartphone, Send, CheckCheck, UserCheck, UserX, Clock, Percent, Users as UsersIcon, FileSpreadsheet, FileText, FileDown, SquareArrowOutUpRight } from 'lucide-react';
import { Avatar } from './bubbles.jsx';
import { useApp, api, fmtPhone, Toggle, Page, Stats, Status, Split, Table, Label, Empty, Confirm, Exports, Ticks, time, dateTime } from './lib.jsx';

function Countdown({ end, skew }) {
  const [, t] = useState(0); useEffect(() => { const i = setInterval(() => t((n) => n + 1), 500); return () => clearInterval(i); }, []);
  const s = Math.max(0, Math.ceil((end - Date.now() - skew) / 1000));
  return <span className="text-5xl font-bold tabular-nums tracking-tight">{String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</span>;
}
function Records({ rows, live }) {
  const [f, setF] = useState('');
  const list = rows.filter((r) => !f || r.status === f);
  return <><div className="card p-3 flex flex-wrap gap-2 my-4" role="group" aria-label="Filter by status">{['', 'present', 'absent', 'pending'].map((k) => <button key={k} aria-pressed={f === k} className={f === k ? 'btn-main' : 'btn'} onClick={() => setF(k)}>{k ? k[0].toUpperCase() + k.slice(1) : 'All'} {rows.filter((r) => !k || r.status === k).length}</button>)}</div>
    <Table head={['User', 'Account', 'Attendance', 'Status', 'Sent', 'Delivery', 'Reply', 'Reply time', 'Location', 'Late by', ...(live ? [''] : [])]}>{list.map((r) => <tr key={r.id}><td><span className="flex items-center gap-3 font-semibold"><Avatar name={r.name} size={36} /><span className="leading-tight">{r.name}<span className="block font-normal text-soft text-[13px]">{fmtPhone(r.phone)}</span></span></span></td><td>{r.account}</td><td>{r.reply ? 'Received' : 'Not received'}</td><td><Status s={r.status} /></td><td>{time(r.sentAt)}</td><td><span className="inline-flex gap-1.5 items-center capitalize"><Ticks s={r.delivery} />{r.delivery}</span></td><td className="max-w-52 truncate">{r.reply || (r.lateReply ? `Late: ${r.lateReply}` : '—')}</td><td>{time(r.repliedAt || r.lateAt)}</td><td>{r.location ? <a className="text-brand font-medium" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.location.lat},${r.location.lng}`}>View map</a> : r.status === 'pending' && r.askedAt ? 'Awaiting' : '—'}</td><td>{r.lateBy == null ? '—' : r.lateBy < 60 ? 'On time' : `${String(Math.floor(r.lateBy / 60)).padStart(2, '0')}:${String(r.lateBy % 60).padStart(2, '0')}`}</td>{live && <td className="text-right"><Link className="btn py-1! px-3!" to={`/accounts/${r.accountId}?user=${r.userId}`}>User chat</Link></td>}</tr>)}</Table>{!list.length && <div className="card mt-3"><Empty>Nobody in this group.</Empty></div>}</>;
}
export function Attendance() {
  const { d, run } = useApp(), active = d.sessions.find((s) => s.status === 'active');
  return active ? <Live s={active} /> : <Start key="start" d={d} run={run} />;
}
function Live({ s }) {
  const { d } = useApp(), rows = d.records.filter((r) => r.sessionId === s.id), x = s.summary;
  return <Page title={s.title} actions={<><a className="btn" href="/user" target="_blank" rel="noreferrer">Open test chats</a><Confirm label="Cancel session" text="Stop without recording anyone as absent?" onYes={() => api(`/sessions/${s.id}/cancel`, 'POST')}>Cancel session</Confirm><Confirm label="Finish now" text={`${x.pending} users who have not checked in will be marked Absent.`} onYes={() => api(`/sessions/${s.id}/finish`, 'POST')}>Finish now</Confirm></>}>
    <section className="card p-6"><div className="flex flex-wrap gap-6 items-end justify-between mb-4"><div><p className="text-soft">Time remaining</p><Countdown end={s.endsAt} skew={d.skew} /></div><div className="flex flex-wrap gap-6">{[['Sent', x.sent], ['Delivered', x.delivered], ['Present', x.present], ['Pending', x.pending], ['Attendance', x.percent + '%']].map(([l, v]) => <div key={l}><p className="text-soft">{l}</p><p className="text-2xl font-semibold tabular-nums">{v}</p></div>)}</div></div><Split s={x} /><p className="text-soft mt-2">Started {time(s.startedAt)}, ends {time(s.endsAt)}. {s.requireLocation ? 'Users must reply and share their location to be Present.' : 'Users who do not reply are marked Absent.'}</p></section>
    <Records rows={rows} live />
  </Page>;
}
function Start({ d, run }) {
  const on = d.accounts.filter((a) => a.connected), [sel, setSel] = useState(on.map((a) => a.id)), [msg, setMsg] = useState(d.settings.message), [min, setMin] = useState(d.settings.minutes), [busy, setBusy] = useState(false), [loc, setLoc] = useState(d.settings.requireLocation);
  const ids = sel.filter((i) => on.some((a) => a.id === i)), users = d.users.filter((u) => u.active && ids.includes(u.accountId)), last = d.sessions[0], all = ids.length === on.length;
  const ex = users[0], preview = msg.replace(/\{\{\s*name\s*\}\}/g, ex?.name ?? 'Aathif').replace(/\{\{\s*date\s*\}\}/g, new Date().toLocaleDateString('en-CA')).replace(/\{\{\s*account\s*\}\}/g, d.accounts.find((a) => a.id === ex?.accountId)?.name ?? '');
  return <Page title="Reminders" sub="Send a reminder and collect check-ins">
    {last?.status === 'completed' && <div className="card p-4 px-5 mb-4 flex flex-wrap gap-3 justify-between items-center"><span>Last session, {dateTime(last.startedAt)}: <b>{last.summary.present} present</b>, <b>{last.summary.absent} absent</b> ({last.summary.percent}%)</span><Link className="btn" to={`/reports/${last.id}`}>View report</Link></div>}
    <div className="grid lg:grid-cols-[1fr_400px] gap-4 items-start"><section className="card p-6">
      <Label t="Attendance message"><textarea rows={4} className="field" value={msg} onChange={(e) => setMsg(e.target.value)} /></Label>
      <div className="flex gap-2 mb-5 items-center text-soft">Insert {['name', 'date', 'account'].map((v) => <button key={v} className="btn py-1!" onClick={() => setMsg(msg + ` {{${v}}}`)}>{v}</button>)}</div>
      <div className="flex justify-between mb-2"><b>WhatsApp accounts</b><button className="text-brand font-medium" onClick={() => setSel(all ? [] : on.map((a) => a.id))}>{all ? 'Clear all' : 'Select all'}</button></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">{d.accounts.map((a) => <label key={a.id} className={`flex items-center gap-3 p-3 rounded-xl ${!a.connected ? 'text-soft bg-[#f7f8f8]' : sel.includes(a.id) ? 'bg-[#d9fdd3]' : 'bg-[#f0f2f5]'}`}><input type="checkbox" disabled={!a.connected} checked={a.connected && sel.includes(a.id)} onChange={(e) => setSel(e.target.checked ? [...sel, a.id] : sel.filter((i) => i !== a.id))} /><Avatar name={a.name} size={34} /><span className="min-w-0 leading-tight"><b className="block">{a.name}</b><span className="text-soft text-[13px]">{a.connected ? `${d.users.filter((u) => u.active && u.accountId === a.id).length} users` : 'Disconnected'}</span></span></label>)}</div>
    </section><section className="card overflow-hidden"><div className="bg-[#008069] text-white flex items-center gap-3 px-4 py-3"><Avatar name={on[0]?.name ?? 'A'} size={38} /><div className="leading-tight"><b>{d.accounts.find((a) => a.id === ex?.accountId)?.name ?? 'Preview'}</b><p className="text-[13px] text-[#d5efe6]">What {ex?.name ?? 'users'} will see</p></div></div><div className="wa-wall px-5 py-4">
      <div className="wa-msg wa-in wa-tail px-3 py-2 whitespace-pre-wrap break-words">{preview}</div><div className="wa-msg wa-out wa-tail px-3 py-2 mt-2.5">In</div>{loc && <div className="wa-msg wa-in wa-tail mt-2.5"><p className="px-3 py-2">Attach your current location 📍 to mark your attendance on below link</p><span className="wa-cta"><SquareArrowOutUpRight size={16} />Mark Attendance</span></div>}<div className="wa-msg wa-in wa-tail px-3 py-2 mt-2.5">You've successfully been checked in!</div></div><div className="p-5">
      <Label t="Reply window"><select className="field" value={min} onChange={(e) => setMin(Number(e.target.value))}>{[...new Set([1, 2, 5, 15, 30, 60, Number(d.settings.minutes)])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} {m === 1 ? 'minute' : 'minutes'}</option>)}</select></Label>
      <Toggle checked={loc} onChange={setLoc}>Ask for location before marking Present</Toggle>
      <button disabled={busy || !users.length || !msg.trim()} className="btn-main w-full py-3!" onClick={async () => { setBusy(true); await run(() => api('/sessions', 'POST', { message: msg, minutes: min, requireLocation: loc, accountIds: ids })); setBusy(false); }}><Play size={17} />Start attendance</button><p className="text-soft mt-2 text-center">Sends to {users.length} users on {ids.length} accounts</p></div></section></div>
  </Page>;
}
export function Reports() {
  const { d } = useApp();
  return <Page title="Attendance Reports" sub={`${d.sessions.length} sessions`} actions={<Link className="btn" to="/export"><FileDown size={17} />Export</Link>}><Table head={['Session', 'State', 'Users', 'Sent', 'Delivered', 'Present', 'Absent', 'Pending', 'Attendance', '']}>{d.sessions.map((s) => <tr key={s.id}><td><Link className="font-semibold text-brand" to={`/reports/${s.id}`}>{dateTime(s.startedAt)}</Link></td><td><Status s={s.status} /></td>{['total', 'sent', 'delivered', 'present', 'absent', 'pending'].map((k) => <td key={k}>{s.summary[k]}</td>)}<td>{s.summary.percent}%</td><td className="min-w-32"><Split s={s.summary} /></td></tr>)}</Table></Page>;
}
export function Report() {
  const { id } = useParams(), { tick } = useApp(), [s, set] = useState(null), [err, setErr] = useState('');
  useEffect(() => { api('/sessions/' + id).then(set).catch((e) => setErr(e.message)); }, [id, tick]);
  if (!s) return <p className="p-10">{err || 'Loading…'}</p>;
  const x = s.summary;
  return <Page title={`Report: ${dateTime(s.startedAt)}`} actions={<Exports query={`session=${s.id}`} />}>
    <Stats items={[['Total users', x.total, UsersIcon], ['WhatsApp accounts', x.accounts, Smartphone], ['Messages sent', x.sent, Send], ['Delivered', x.delivered, CheckCheck], ['Present', x.present, UserCheck], ['Absent', x.absent, UserX, '#d03b3b'], ['Pending', x.pending, Clock, '#b27700'], ['Attendance', x.percent + '%', Percent]]} /><div className="card p-5 mt-4"><Split s={x} /></div><Records rows={s.records} />
  </Page>;
}
export function ExportReports() {
  const { d } = useApp(), [f, set] = useState({ from: '', to: '', account: '' }), on = (k) => (e) => set({ ...f, [k]: e.target.value });
  return <Page title="Export Reports" sub="Download attendance records"><div className="grid lg:grid-cols-[1fr_1fr] gap-4 items-start"><section className="card p-6"><div className="grid sm:grid-cols-2 gap-3"><Label t="From"><input type="date" className="field" value={f.from} onChange={on('from')} /></Label><Label t="To"><input type="date" className="field" value={f.to} onChange={on('to')} /></Label></div><Label t="WhatsApp account"><select className="field" value={f.account} onChange={on('account')}><option value="">All accounts</option>{d.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Label><p className="text-soft">Leave dates blank to include every session.</p></section><section className="card py-2">{[['xlsx', 'Excel', 'Summary sheet and every record', FileSpreadsheet], ['csv', 'CSV', 'Plain data for other tools', FileText], ['pdf', 'PDF', 'Ready to print, English text only', FileDown]].map(([x, l, t, I]) => <a key={x} download href={`/api/export.${x}?${new URLSearchParams(f)}`} className="flex items-center gap-4 px-6 py-4 hover:bg-[#f5f6f6]"><span className="w-12 h-12 rounded-full bg-[#d9fdd3] text-[#027a5b] grid place-items-center"><I size={23} /></span><span className="grow"><b className="text-base">{l}</b><br /><span className="text-soft">{t}</span></span><span className="btn-main">Download</span></a>)}</section></div></Page>;
}
