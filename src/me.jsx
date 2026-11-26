import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { LogIn, LogOut, CheckCircle2 } from 'lucide-react';
import { api, Label, Status, Empty, time, dur, getPlace, dayLabel } from './lib.jsx';
import { Brand } from './login.jsx';

/** The employee's own page: one button for IN, one for OUT. */
export default function Me() {
  const [d, set] = useState(null), [out, setOut] = useState(false), [err, setErr] = useState(''), [busy, setBusy] = useState(''), [sure, setSure] = useState(false), [f, setF] = useState({ phone: '', pin: '' });
  const load = useCallback(() => api('/me').then((x) => { set(x); setOut(false); }).catch((e) => e.status === 401 ? (set(null), setOut(true)) : setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (out || !d) return; const s = io(); s.on('changed', load); return () => s.close(); }, [out, !d, load]);
  if (out) return <Brand title="Employee sign in" sub="Mark your IN and OUT"><form onSubmit={async (e) => { e.preventDefault(); setBusy('login'); try { await api('/me/login', 'POST', f); setErr(''); await load(); } catch (x) { setErr(x.message); } setBusy(''); }}>
    <Label t="Mobile number"><input required inputMode="tel" autoComplete="username" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Label><Label t="6-digit PIN"><input required type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" className="field" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></Label>
    {err && <p role="alert" className="text-bad mb-3">{err}</p>}<button disabled={!!busy} className="btn-main w-full py-3!">Sign in</button><p className="text-soft text-center mt-4">Ask your administrator for your PIN.</p></form></Brand>;
  if (!d) return <p className="p-10">{err || 'Loading…'}</p>;
  const mark = async (type) => { setBusy(type); setErr(''); setSure(false); try { await api('/me/' + type, 'POST', d.requireLocation ? await getPlace() : {}); await load(); } catch (e) { setErr(e.message); load(); } setBusy(''); };
  const t = d.today;
  return <Brand title={`Hi ${d.user.name}`} sub={`${d.user.code}, shift ${d.shift.start} to ${d.shift.end}`}>
    <div className="grid grid-cols-3 text-center mb-5">{[['IN', time(t?.inAt)], ['OUT', time(t?.outAt)], ['Total', t?.minutes == null ? '—' : dur(t.minutes)]].map(([l, v]) => <div key={l}><p className="text-soft">{l}</p><b className="text-lg tabular-nums">{v}</b></div>)}</div>
    {t?.late > 0 && <p className="text-center mb-3 text-[#b27700] font-medium">Late by {dur(t.late)}</p>}
    {d.done ? <p className="flex justify-center items-center gap-2 py-3 font-semibold text-good"><CheckCircle2 />Today is completed</p> : <div className="grid gap-2">
      {d.canIn && <button className="btn-main py-4! text-lg" disabled={!!busy} onClick={() => mark('in')}><LogIn size={22} />{busy === 'in' ? 'Marking IN…' : 'Mark IN'}</button>}
      {d.canOut && (sure ? <div className="grid grid-cols-2 gap-2"><button className="btn py-4!" onClick={() => setSure(false)}>Not yet</button><button className="btn-main py-4!" onClick={() => mark('out')}>Yes, mark OUT</button></div> : <button className={`${d.canIn ? 'btn' : 'btn-main'} py-4! text-lg`} disabled={!!busy} onClick={() => setSure(true)}><LogOut size={22} />{busy === 'out' ? 'Marking OUT…' : d.canIn ? 'Mark OUT for last shift' : 'Mark OUT'}</button>)}</div>}
    {d.requireLocation && !d.done && <p className="text-soft text-center mt-2">Your location is recorded when you mark IN or OUT.</p>}
    {err && <p role="alert" className="mt-3 text-bad text-center">{err}</p>}
    <h2 className="font-bold mt-6 mb-1">Last 30 days</h2><div className="max-h-72 overflow-y-auto">{d.history.map((x) => <div key={x.id} className="flex justify-between gap-2 py-2 border-t border-line"><span>{dayLabel(x.date)}<span className="block text-soft text-[13px]">{time(x.inAt)} to {time(x.outAt)}</span></span><Status s={x.status} /></div>)}{!d.history.length && <Empty>No attendance yet.</Empty>}</div>
    <button className="btn w-full mt-5" onClick={async () => { await api('/me/logout', 'POST').catch(() => {}); load(); }}>Sign out</button>
  </Brand>;
}
