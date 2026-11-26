import { useEffect, useState } from 'react';
import { MapPin, Pencil } from 'lucide-react';
import { useApp, api, Page, Table, Status, Modal, Label, Empty, time, dur, today, dayLabel, SOURCE } from './lib.jsx';
import { Avatar } from './bubbles.jsx';

const hhmm = (t) => t ? new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '';
function Correct({ x, close }) {
  const { run } = useApp(), [f, set] = useState({ in: hhmm(x.inAt), out: hhmm(x.outAt), reason: '' }), on = (k) => (e) => set({ ...f, [k]: e.target.value });
  return <Modal title={`Correct ${x.name}, ${dayLabel(x.date)}`} onClose={close}><form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api('/days', 'PUT', { ...f, userId: x.userId, date: x.date }), 'Attendance corrected')) close(); }}>
    <div className="grid grid-cols-2 gap-3"><Label t="IN"><input type="time" className="field" value={f.in} onChange={on('in')} /></Label><Label t="OUT"><input type="time" className="field" value={f.out} onChange={on('out')} /></Label></div><p className="text-soft mb-4">Times are IST. An OUT earlier than IN means the next day. Clear both to remove the record.</p>
    <Label t="Reason"><input required maxLength={200} className="field" value={f.reason} onChange={on('reason')} /></Label><button className="btn-main w-full py-3!">Save correction</button></form></Modal>;
}
const Place = ({ l }) => l ? <a className="inline-flex text-brand align-middle ml-1" target="_blank" rel="noreferrer" aria-label="View location on map" href={`https://www.google.com/maps?q=${l.lat},${l.lng}`}><MapPin size={15} /></a> : null;
export function Daily() {
  const { d, tick } = useApp(), [f, set] = useState({ from: today(), to: today(), user: '' }), [st, setSt] = useState(''), [rows, setRows] = useState(null), [err, setErr] = useState(''), [edit, setEdit] = useState(null);
  const q = new URLSearchParams(f).toString(), on = (k) => (e) => set({ ...f, [k]: e.target.value });
  useEffect(() => { let live = true; api('/days?' + q).then((x) => { if (live) { setRows(x); setErr(''); } }).catch((e) => live && setErr(e.message)); return () => { live = false; }; }, [q, tick]);
  const list = (rows ?? []).filter((r) => !st || (st === 'late' ? r.late : r.status === st));
  const count = (k) => (rows ?? []).filter((r) => !k || (k === 'late' ? r.late : r.status === k)).length;
  return <Page title="Daily Attendance" sub="IN, OUT and working hours from every method" actions={<>{[['xlsx', 'Excel'], ['csv', 'CSV']].map(([x, l]) => <a key={x} className="btn" download href={`/api/days.${x}?${q}`}>{l}</a>)}</>}>
    <div className="card p-3 flex flex-wrap gap-2 mb-4 items-center"><input type="date" aria-label="From" className="field w-auto!" value={f.from} max={today()} onChange={on('from')} /><span className="text-soft">to</span><input type="date" aria-label="To" className="field w-auto!" value={f.to} max={today()} onChange={on('to')} /><select aria-label="Employee" className="field w-auto!" value={f.user} onChange={on('user')}><option value="">All employees</option>{d.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
    <div className="card p-3 flex flex-wrap gap-2 mb-4" role="group" aria-label="Filter by status">{[['', 'All'], ['working', 'Working'], ['completed', 'Completed'], ['late', 'Late'], ['missing', 'Missing OUT'], ['notin', 'Not in yet'], ['absent', 'Absent']].map(([k, l]) => <button key={k} aria-pressed={st === k} className={st === k ? 'btn-main' : 'btn'} onClick={() => setSt(k)}>{l} {count(k)}</button>)}</div>
    {err ? <p role="alert" className="card p-6 text-bad">{err}</p> : <Table head={['Employee', 'Date', 'Status', 'IN', 'OUT', 'Working hours', 'Late', 'Method', '']}>{list.map((r) => <tr key={r.id}><td><span className="flex items-center gap-3 font-semibold"><Avatar name={r.name} size={36} /><span className="leading-tight">{r.name}<span className="block font-normal text-soft text-[13px]">{r.code}</span></span></span></td><td>{dayLabel(r.date)}</td><td><Status s={r.status} />{r.corrected && <span className="block text-soft text-[13px]">Corrected</span>}</td><td>{time(r.inAt)}<Place l={r.location} /></td><td>{time(r.outAt)}<Place l={r.outLocation} /></td><td>{r.minutes == null ? '—' : dur(r.minutes)}</td><td>{r.late ? dur(r.late) : r.inAt ? 'On time' : '—'}</td><td>{r.inSource ? SOURCE[r.inSource] + (r.outSource && r.outSource !== r.inSource ? ` / ${SOURCE[r.outSource]}` : '') : '—'}</td><td className="text-right">{d.users.some((u) => u.id === r.userId) && <button className="icon-btn" aria-label={`Correct ${r.name}`} onClick={() => setEdit(r)}><Pencil size={16} /></button>}</td></tr>)}</Table>}
    {rows && !list.length && !err && <Empty>No attendance matches.</Empty>}{edit && <Correct x={edit} close={() => setEdit(null)} />}
  </Page>;
}
