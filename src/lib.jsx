import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Clock, Ban, X, Check, CheckCheck, AlertCircle } from 'lucide-react';
export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);
export async function api(path, method = 'GET', body, headers = {}) {
  const r = await fetch('/api' + path, { method, headers: { ...headers, ...(body && { 'Content-Type': 'application/json' }) }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { status: r.status });
  return j;
}
export const time = (t) => t ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
export const dateTime = (t) => t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const when = (t) => !t ? '' : new Date(t).toDateString() === new Date().toDateString() ? time(t) : new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const ST = { present: [CheckCircle2, 'text-good', 'Present'], absent: [XCircle, 'text-bad', 'Absent'], pending: [Clock, 'text-[#b27700]', 'Pending'], cancelled: [Ban, 'text-soft', 'Cancelled'], active: [Clock, 'text-brand', 'Active'], completed: [CheckCircle2, 'text-good', 'Completed'], connected: [CheckCircle2, 'text-good', 'Connected'], disconnected: [XCircle, 'text-bad', 'Disconnected'] };
export function Status({ s }) { const [I, c, l] = ST[s]; return <span className="inline-flex items-center gap-1.5 font-medium"><I size={15} className={c} aria-hidden />{l}</span>; }
export function Ticks({ s }) { const I = s === 'failed' ? AlertCircle : s === 'sending' || s === 'queued' ? Clock : s === 'sent' ? Check : CheckCheck; return <I size={14} aria-label={s} className={s === 'failed' ? 'text-bad' : s === 'read' ? 'text-[#1677b8]' : 'text-soft'} />; }
export const fmtPhone = (p) => p?.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
/** Green header band with the page content overlapping it. */
export function Page({ title, sub, actions, children }) { return <div className="wall min-h-full"><div className="bg-[#008069] text-white px-4 md:px-8 pt-6 pb-20"><div className="max-w-[1640px] mx-auto flex flex-wrap gap-3 items-center justify-between"><div><h1 className="text-[26px] font-bold tracking-tight leading-tight">{title}</h1>{sub && <p className="text-[#d5efe6] mt-0.5">{sub}</p>}</div><div className="flex flex-wrap gap-2">{actions}</div></div></div><div className="px-4 md:px-8 -mt-14 pb-10"><div className="max-w-[1640px] mx-auto">{children}</div></div></div>; }
export function Modal({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} onClose={onClose} className="m-auto w-[min(92vw,560px)] rounded-2xl p-6 shadow-2xl backdrop:bg-[#0b141a]/60 max-h-[88vh] overflow-auto"><div className="flex justify-between items-center mb-4"><h2 className="text-lg font-bold">{title}</h2><button aria-label="Close" className="icon-btn" onClick={onClose}><X size={20} /></button></div>{children}</dialog>;
}
export const Empty = ({ children }) => <p className="p-8 text-center text-soft">{children}</p>;
export const Label = ({ t, children }) => <label className="block mb-4"><span className="block mb-1.5 font-semibold">{t}</span>{children}</label>;
export const Toggle = ({ checked, onChange, children }) => <label className="flex items-center justify-between gap-4 py-2.5 mb-2"><span>{children}</span><input type="checkbox" role="switch" className="toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>;
/** Present / absent / pending split with counts. */
export function Split({ s }) {
  const parts = [['present', 'bg-good'], ['absent', 'bg-bad'], ['pending', 'bg-warn']].filter(([k]) => s[k]);
  return <div className="flex gap-0.5 h-2.5 w-full" role="img" aria-label={`${s.present} present, ${s.absent} absent, ${s.pending} pending`}>{parts.length ? parts.map(([k, c]) => <div key={k} title={`${s[k]} ${k}`} className={`${c} rounded-sm transition-all`} style={{ flexGrow: s[k] }} />).concat(s.total > s.present + s.absent + s.pending ? <div key="x" title="Cancelled" className="bg-line rounded-sm" style={{ flexGrow: s.total - s.present - s.absent - s.pending }} /> : []) : <div className="bg-line rounded-sm grow" />}</div>;
}
export function Confirm({ text, label, onYes, className = 'btn', children }) { // asks before doing anything destructive
  const [o, set] = useState(false); const { run } = useApp();
  return <><button className={className} onClick={() => set(true)} aria-label={typeof children === 'string' ? undefined : label}>{children}</button>{o && <Modal title={label} onClose={() => set(false)}><p className="mb-5">{text}</p><div className="flex justify-end gap-2"><button className="btn" onClick={() => set(false)}>Keep</button><button className="btn-main" onClick={() => { set(false); run(onYes); }}>{label}</button></div></Modal>}</>;
}
export const Stats = ({ items }) => <dl className="card grid grid-cols-2 md:grid-cols-4 gap-y-1 p-2">{items.map(([l, v, I, c]) => <div key={l} className="flex items-center gap-3.5 p-3.5">{I && <span className="rounded-full w-11 h-11 grid place-items-center shrink-0" style={{ background: (c ?? '#008069') + '1c', color: c ?? '#008069' }}><I size={21} /></span>}<div className="min-w-0"><dd className="text-[26px] leading-tight font-bold tabular-nums">{v}</dd><dt className="text-soft leading-snug">{l}</dt></div></div>)}</dl>;
export const Table = ({ head, children }) => <div className="card overflow-x-auto"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
export const Exports = ({ query }) => <>{[['xlsx', 'Excel'], ['csv', 'CSV'], ['pdf', 'PDF']].map(([f, l]) => <a key={f} className="btn" href={`/api/export.${f}?${query}`} download>{l}</a>)}</>;
