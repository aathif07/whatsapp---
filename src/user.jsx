import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ArrowLeft, Pencil, Trash2, MessageCircleCheck } from 'lucide-react';
import { Ctx, api, fmtPhone, Modal, Status, Confirm } from './lib.jsx';
import { UserForm } from './manage.jsx';
import { Avatar, Composer, Thread } from './bubbles.jsx';

/** Test chats: lets an administrator try the WhatsApp flow on simulated accounts. */
export default function UserApp() {
  const [uid, setUid] = useState(new URLSearchParams(location.search).get('id'));
  const open = (x) => { setUid(x); history.replaceState(null, '', x ? '/user?id=' + x : '/user'); };
  return uid ? <UserChat key={uid} userId={uid} out={() => open(null)} /> : <Pick onPick={open} />;
}
function Pick({ onPick }) {
  const [d, setD] = useState(null), [q, setQ] = useState(''), [edit, setEdit] = useState(null), [err, setErr] = useState('');
  const load = useCallback(() => api('/state').then(setD).catch(() => {}), []);
  const run = async (fn) => { try { const r = await fn(); setErr(''); await load(); return r ?? true; } catch (e) { setErr(e.message); return false; } };
  useEffect(() => { load(); const s = io(); s.on('changed', load); return () => s.close(); }, []);
  const acc = (id) => d.accounts.find((a) => a.id === id)?.name;
  const list = d?.users.filter((u) => !d.accounts.some((a) => a.id === u.accountId && (a.phoneNumberId || a.qr))).filter((u) => (u.name + u.phone).toLowerCase().includes(q.toLowerCase())) ?? [];
  return <Ctx.Provider value={{ d, run }}><main className="wall min-h-dvh"><div className="bg-[#008069] h-44 text-white px-4"><div className="max-w-[640px] mx-auto pt-7 flex items-center gap-3"><span className="w-12 h-12 rounded-full rounded-bl-sm bg-[#25d366] text-[#0b3d34] grid place-items-center"><MessageCircleCheck size={27} /></span><div><h1 className="text-2xl font-bold leading-tight">Test chats</h1><p className="text-[#d5efe6]">Try the WhatsApp flow as any employee on a simulated account</p></div></div></div>
    <section className="card w-[min(94vw,640px)] mx-auto -mt-14 mb-8 overflow-hidden"><div className="p-3"><input autoFocus aria-label="Search users" className="field" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {err && <p role="alert" className="text-bad px-5 pb-2">{err}</p>}{list.map((u) => <div key={u.id} className="flex items-center pr-3 hover:bg-[#f0f2f5]"><button onClick={() => onPick(u.id)} className="grow min-w-0 text-left flex items-center gap-4 pl-5 pr-2 py-3"><Avatar name={u.name} size={48} /><div className="grow min-w-0"><b className="text-base">{u.name}</b><p className="text-soft truncate">{fmtPhone(u.phone)} on {acc(u.accountId)}</p></div>{u.today && <Status s={u.today} />}</button><button className="icon-btn" aria-label={`Edit ${u.name}`} onClick={() => setEdit(u)}><Pencil size={16} /></button><Confirm className="icon-btn" label={`Delete ${u.name}`} text={`Delete ${u.name} and their messages? Attendance records are kept.`} onYes={() => api('/users/' + u.id, 'DELETE')}><Trash2 size={16} /></Confirm></div>)}{edit && <UserForm u={edit} close={() => setEdit(null)} />}
      {d && !list.length && <p className="p-8 text-center text-soft">No users match.</p>}</section></main></Ctx.Provider>;
}
/** One simulated chat, placed inside another page. */
export const UserPane = ({ userId, onBack }) => <UserChat userId={userId} out={onBack} embedded />;
function UserChat({ userId, out, embedded }) {
  const [d, setD] = useState(null), [err, setErr] = useState(''), [link, setLink] = useState(null), sock = useRef();
  const call = useCallback((p, m, b) => api('/sim/' + userId + p, m, b), [userId]);
  const load = useCallback(async () => {
    try { const x = await call(''); setD(x); if (!document.hidden && x.messages.some((m) => m.dir === 'out' && m.status === 'delivered')) await call('/read', 'POST'); }
    catch (e) { setErr(e.message); }
  }, [call]);
  useEffect(() => { load(); const s = io(); sock.current = s; s.on('connect', load); s.on('changed', load); document.addEventListener('visibilitychange', load); return () => { s.close(); document.removeEventListener('visibilitychange', load); }; }, [load]);
  if (!d) return <p className="p-10">{err || 'Loading…'}</p>;
  const send = async (text) => { try { await call('/messages', 'POST', { text }); setErr(''); await load(); return true; } catch (e) { setErr(e.message); return false; } };
  return <main className={embedded ? 'flex min-h-0 min-w-0' : 'h-dvh wall flex justify-center md:py-5'}><div className={`flex flex-col w-full h-full overflow-hidden bg-white ${embedded ? '' : 'max-w-[860px] md:rounded-xl shadow-xl'}`}>
    <header className="bg-[#008069] text-white flex items-center gap-3 px-4 py-3"><button aria-label="Back to users" className={`${embedded ? 'md:hidden ' : ''}p-1.5 rounded-full hover:bg-white/15`} onClick={out}><ArrowLeft size={22} /></button><Avatar name={d.account.name} size={44} /><div className="min-w-0 grow"><b className="block truncate text-[17px]">{d.account.name}</b><span className="text-[13px]">{d.typing ? 'typing…' : d.account.connected ? 'online' : 'offline'}</span></div><div className="text-right leading-tight"><p className="text-[13px] text-[#d5efe6]">You are</p><b>{d.user.name}</b></div></header>
    <div className="flex justify-between px-4 py-2 border-b border-line"><span className="text-soft">Today’s attendance</span>{d.today ? <Status s={d.today} /> : <span className="font-medium">Not started</span>}</div>
    <Thread msgs={d.messages} mine="in" typing={d.typing} onCheckin={setLink} />
    {err && <p role="alert" className="text-bad px-4 py-2">{err}</p>}
    <Composer onSend={send} onTyping={() => sock.current?.emit('typing', 'user:' + d.user.id)} placeholder={`Message as ${d.user.name}`} />
  </div>{link && <Modal title="Mark Attendance" onClose={() => setLink(null)}><iframe title="Mark Attendance" src={`/checkin/${link}`} allow="geolocation" className="w-full h-[430px] rounded-md" /></Modal>}</main>;
}
