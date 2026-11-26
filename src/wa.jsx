import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, MessageCircle, Pencil, Trash2, Power, QrCode, UserPlus, Users, FileDown } from 'lucide-react';
import { useApp, api, fmtPhone, Status, Ticks, Empty, Confirm, when } from './lib.jsx';
import { Avatar, Composer, Thread } from './bubbles.jsx';
import { AccountForm, Scan, UserForm } from './manage.jsx';

/** Edit, connect, disconnect and delete, shown above an account's chats. */
export function AccountTools({ a }) {
  const { d, run } = useApp(), nav = useNavigate(), [edit, setEdit] = useState(false), [scan, setScan] = useState(false), sim = !a.qr && !a.phoneNumberId, n = d.users.filter((u) => u.accountId === a.id).length;
  return <div className="flex gap-1 ml-auto"><button className="icon-btn" aria-label="Edit account" title="Edit account" onClick={() => setEdit(true)}><Pencil size={17} /></button>
    {a.qr && !a.connected && <button className="icon-btn" aria-label="Scan QR" title="Scan QR" onClick={() => setScan(true)}><QrCode size={17} /></button>}
    {a.connected && !sim && <Confirm className="icon-btn" label="Disconnect" text={a.qr ? `Unlink ${a.name} from the phone? You will need to scan the QR again. Saved chats stay here.` : `Disconnect ${a.name}?`} onYes={() => api(`/accounts/${a.id}/toggle`, 'POST')}><Power size={17} /></Confirm>}
    <Confirm className="icon-btn" label="Delete account" text={`Delete ${a.name}${sim && n ? `, its ${n} test users and their messages` : a.qr ? ' and all its saved chats' : ''}? This cannot be undone. Attendance records are kept.`} onYes={async () => { await api(`/accounts/${a.id}${sim ? '?users=1' : ''}`, 'DELETE'); nav('/accounts'); }}><Trash2 size={17} /></Confirm>
    {edit && <AccountForm a={a} close={() => setEdit(false)} />}{scan && <Scan a={a} close={() => setScan(false)} />}</div>;
}
function Media({ src, m }) {
  const [show, set] = useState(m.kind === 'sticker'), [bad, setBad] = useState(false), fail = () => setBad(true);
  if (!m.media) return null;
  if (bad) return <p className="text-soft text-[13px]">This file is no longer available.</p>;
  if (m.kind === 'document') return <a className="btn mb-1" href={src} download><FileDown size={16} />{m.file || 'Download'}</a>;
  if (!show) return <button className="btn mb-1" onClick={() => set(true)}>Show {m.kind === 'image' ? 'photo' : m.kind}</button>;
  return m.kind === 'video' ? <video controls className="max-h-72 rounded-md mb-1 max-w-full" src={src} onError={fail} /> : m.kind === 'audio' ? <audio controls className="mb-1 max-w-full" src={src} onError={fail} /> : <img alt={m.text} className={`rounded-md mb-1 max-w-full ${m.kind === 'sticker' ? 'w-32' : 'max-h-72'}`} src={src} onError={fail} />;
}
/** All chats of a QR-linked number, like a linked WhatsApp. */
export function QrChats({ a }) {
  const { d, run, tick } = useApp(), [sp, setSp] = useSearchParams(), jid = sp.get('chat'), [list, setList] = useState(null), [msgs, setMsgs] = useState({ jid: null, list: [] }), [older, setOlder] = useState([]), [more, setMore] = useState(true), [q, setQ] = useState(''), [f, setF] = useState(''), [add, setAdd] = useState(false), base = `/accounts/${a.id}/chats`, seq = useRef(0);
  useEffect(() => { let live = true; api(base).then((x) => live && setList(x)).catch(() => {}); return () => { live = false; }; }, [base, tick]);
  const at = (j) => `${base}/${encodeURIComponent(j)}`;
  useEffect(() => { if (!jid) return; const n = ++seq.current; api(at(jid)).then((x) => { if (n === seq.current) { setMsgs({ jid, list: x }); if (!document.hidden) api(at(jid) + '/read', 'POST').catch(() => {}); } }).catch(() => {}); }, [jid, tick, base]);
  useEffect(() => { setOlder([]); setMore(true); }, [jid]);
  const employee = (c) => c.phone && d.users.find((u) => u.phone === c.phone), cur = list?.find((c) => c.jid === jid), emp = cur && employee(cur);
  const shown = (list ?? []).filter((c) => `${c.name} ${c.phone ?? ''} ${c.last?.text ?? ''}`.toLowerCase().includes(q.toLowerCase()) && (!f || (f === 'unread' ? c.unread : f === 'groups' ? c.group : employee(c))));
  const all = msgs.jid === jid ? [...older, ...msgs.list.filter((m) => !older.some((x) => x.id === m.id))] : [];
  const loadOlder = async () => { const x = await run(() => api(`${at(jid)}?before=${all[0].at}`)); if (Array.isArray(x)) { x.length ? setOlder((y) => [...x, ...y]) : setMore(false); } };
  const send = (text) => run(() => api(at(jid) + '/messages', 'POST', { text }));
  return <div className="h-[calc(100dvh-49px)] md:h-full grid grid-cols-[minmax(0,1fr)] md:grid-cols-[380px_minmax(0,1fr)]">
    <div className={`${jid ? 'hidden md:flex' : 'flex'} flex-col min-h-0 bg-white border-r border-line`}>
      <header className="px-4 pt-4 pb-1"><div className="flex items-center"><h1 className="text-xl font-bold truncate">{a.name}</h1><AccountTools a={a} /></div><div className="flex gap-3 text-soft"><span>{a.phone ? fmtPhone(a.phone) : 'Not scanned yet'}</span><Status s={a.connected ? 'connected' : 'disconnected'} /></div></header>
      <div className="p-3 space-y-2"><div className="flex items-center gap-2 bg-[#f0f2f5] rounded-full px-4"><Search size={16} className="text-soft" /><input aria-label="Search chats" placeholder="Search" className="grow py-2 bg-transparent min-w-0" value={q} onChange={(e) => setQ(e.target.value)} /></div><div className="flex gap-1.5">{[['', 'All'], ['unread', 'Unread'], ['emp', 'Employees'], ['groups', 'Groups']].map(([k, l]) => <button key={k} aria-pressed={f === k} className={`${f === k ? 'btn-main' : 'btn'} px-3! py-1!`} onClick={() => setF(k)}>{l}</button>)}</div></div>
      <div className="overflow-y-auto grow">{shown.map((c) => <button key={c.jid} onClick={() => setSp({ chat: c.jid })} className={`w-full text-left px-3 flex gap-3 items-center ${c.jid === jid ? 'bg-[#f0f2f5]' : 'hover:bg-[#f5f6f6]'}`}><Avatar name={c.name} size={48} /><div className="min-w-0 grow py-3 border-b border-line"><div className="flex justify-between gap-2"><b className="truncate text-[15px]">{c.name}</b><span className={`shrink-0 text-xs ${c.unread ? 'text-[#008069] font-semibold' : 'text-soft'}`}>{when(c.at)}</span></div><div className="flex gap-1.5 items-center mt-0.5">{c.last?.me && <span className="shrink-0"><Ticks s={c.last.status ?? 'sent'} /></span>}{c.group && <Users size={14} className="shrink-0 text-soft" />}<span className="truncate text-soft grow">{c.last?.text ?? 'No messages here yet'}</span>{employee(c) && <span className="text-xs rounded-full bg-tint text-brand px-2 py-0.5 shrink-0">Employee</span>}{c.unread > 0 && <span className="bg-[#008069] text-white text-xs rounded-full min-w-5 text-center px-1.5 py-0.5">{c.unread}</span>}</div></div></button>)}
        {list && !shown.length && <Empty>{list.length ? 'No chats match.' : a.connected ? 'New messages will appear here. To bring in old chats, disconnect and scan the QR again, then wait a few minutes.' : 'Scan the QR to bring in your chats.'}</Empty>}</div></div>
    {cur ? <div className="flex flex-col min-h-0 min-w-0"><div className="bg-[#f0f2f5] border-b border-line px-4 py-2 flex gap-3 items-center"><button className="md:hidden" aria-label="Back" onClick={() => setSp({})}><ArrowLeft /></button><Avatar name={cur.name} size={42} /><div className="min-w-0 grow"><b className="block text-base truncate">{cur.name}</b><p className="text-soft text-[13px] truncate">{cur.group ? 'Group' : fmtPhone(cur.phone) ?? 'Number hidden by WhatsApp'}{emp && `, ${emp.code}${emp.accountId === a.id ? '' : ', assigned to another account'}`}</p></div>
      {!cur.group && cur.phone && <button className="btn" onClick={() => setAdd(true)}>{emp ? <Pencil size={16} /> : <UserPlus size={16} />}{emp ? 'Edit employee' : 'Add as employee'}</button>}<Confirm className="icon-btn" label="Delete chat" text={`Delete the saved chat with ${cur.name} from this dashboard? It stays on the phone.`} onYes={async () => { await api(at(jid), 'DELETE'); setSp({}); }}><Trash2 size={17} /></Confirm></div>
      {all.length >= 100 && more && <button className="text-brand font-medium py-1.5 bg-white border-b border-line" onClick={loadOlder}>Load older messages</button>}
      <Thread msgs={all} mine="out" note="Messages from your linked WhatsApp." extra={(m) => <><Media src={`/api${at(jid)}/media/${encodeURIComponent(m.id)}`} m={m} />{m.by && <b className="block text-[13px] text-brand">{m.by}</b>}</>} />
      {a.connected ? <Composer key={jid} onSend={send} placeholder={`Message ${cur.name}`} /> : <p className="bg-[#f0f2f5] p-4 text-soft text-center">{a.name} is disconnected. Scan the QR to send messages.</p>}
      {add && <UserForm u={emp ?? { name: cur.name, phone: cur.phone, accountId: a.id }} close={() => setAdd(false)} />}</div>
      : <div className="hidden md:grid place-items-center bg-[#f0f2f5] text-soft"><div className="text-center"><MessageCircle size={56} strokeWidth={1} className="mx-auto mb-3" />Select a chat</div></div>}
  </div>;
}
