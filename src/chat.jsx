import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, MessageCircle } from 'lucide-react';
import { useApp, api, fmtPhone, Status, Ticks, Empty, when } from './lib.jsx';
import { AccountTools, QrChats } from './wa.jsx';
import { UserPane } from './user.jsx';
import { Avatar, Composer, Thread } from './bubbles.jsx';

/** /inbox is the administrator's side. /accounts/:accountId is the users' side of that account's chats. */
export function Chat() {
  const { accountId } = useParams(), { d } = useApp(), a = d.accounts.find((x) => x.id === accountId);
  return a?.qr ? <QrChats key={a.id} a={a} /> : <ChatView />;
}
function ChatView() {
  const { accountId } = useParams(), { d, run, tick, socket } = useApp(), [sp, setSp] = useSearchParams(), uid = sp.get('user');
  const [q, setQ] = useState(''), [acc, setAcc] = useState(''), [store, setStore] = useState({ uid: null, list: [] });
  const user = d.users.find((u) => u.id === uid), account = d.accounts.find((a) => a.id === (user?.accountId ?? accountId)), scope = accountId || acc;
  const head = accountId ? d.accounts.find((a) => a.id === accountId) : null, msgs = store.uid === uid ? store.list : [];
  const list = d.conversations.map((c) => (accountId ? { ...c, unread: c.userUnread } : c)).filter((c) => (!scope || c.accountId === scope) && (accountId || q || c.last)).map((c) => ({ ...c, u: d.users.find((u) => u.id === c.userId) })).filter((c) => `${c.u.name} ${c.u.phone} ${c.last?.text ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const unread = d.conversations.find((c) => c.userId === uid)?.unread, isTyping = (id) => d.typing.includes((accountId ? 'bot:' : 'user:') + id);
  useEffect(() => { let live = true; if (uid && !accountId) { api(`/users/${uid}/messages`).then((m) => live && setStore({ uid, list: m })).catch(() => {}); if (unread && !accountId) api(`/users/${uid}/read`, 'POST').catch(() => {}); } return () => { live = false; }; }, [uid, tick, unread]);
  const send = (text) => {
    // Show the bubble at once; the next refresh replaces it with the stored message.
    setStore((s) => ({ ...s, list: [...s.list, { id: 'tmp' + Date.now(), dir: 'out', text, at: Date.now(), status: 'sending' }] }));
    return run(() => api(`/users/${uid}/messages`, 'POST', { text }));
  };
  return <div className="h-[calc(100dvh-49px)] md:h-full flex flex-col">
    <div className="grow min-h-0 grid grid-cols-[minmax(0,1fr)] md:grid-cols-[380px_minmax(0,1fr)]">
      <div className={`${uid ? 'hidden md:flex' : 'flex'} flex-col min-h-0 bg-white border-r border-line`}>
        <header className="px-4 pt-4 pb-1"><div className="flex items-center"><h1 className="text-xl font-bold">{accountId ? head?.name ?? 'Account not found' : 'Chats'}</h1>{head && <AccountTools a={head} />}</div><p className="text-soft">{accountId ? 'User side' : 'Admin side'}</p>{head && <div className="flex gap-3 text-soft mt-1"><span>{fmtPhone(head.phone)}</span><Status s={head.connected ? 'connected' : 'disconnected'} /></div>}</header>
        <div className="p-3 space-y-2"><div className="flex items-center gap-2 bg-[#f0f2f5] rounded-full px-4"><Search size={16} className="text-soft" /><input aria-label="Search conversations" placeholder="Search" className="grow py-2 bg-transparent min-w-0" value={q} onChange={(e) => setQ(e.target.value)} /></div>{!accountId && <select aria-label="Filter by account" className="field" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">All accounts</option>{d.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}</div>
        <div className="overflow-y-auto grow">{list.map((c) => <button key={c.userId} onClick={() => setSp({ user: c.userId })} className={`w-full text-left px-3 flex gap-3 items-center ${c.userId === uid ? 'bg-[#f0f2f5]' : 'hover:bg-[#f5f6f6]'}`}><Avatar name={c.u.name} size={48} /><div className="min-w-0 grow py-3 border-b border-line"><div className="flex justify-between gap-2"><b className="truncate text-[15px]">{c.u.name}</b><span className={`shrink-0 text-xs ${c.unread ? 'text-[#008069] font-semibold' : 'text-soft'}`}>{when(c.last?.at)}</span></div><div className="flex gap-1.5 items-center mt-0.5">{isTyping(c.userId) ? <span className="text-[#008069] grow">typing…</span> : <>{c.last && c.last.dir === (accountId ? 'in' : 'out') && <span className="shrink-0"><Ticks s={accountId ? (c.last.read ? 'read' : 'delivered') : c.last.status} /></span>}<span className="truncate text-soft grow">{c.last?.text ?? 'No messages yet'}</span></>}{c.unread > 0 && <span className="bg-[#008069] text-white text-xs rounded-full min-w-5 text-center px-1.5 py-0.5">{c.unread}</span>}</div>{!accountId && <span className="text-xs text-soft">{d.accounts.find((a) => a.id === c.accountId)?.name}</span>}</div></button>)}{!list.length && <Empty>No conversations found.</Empty>}</div></div>
      {user && accountId && !(head?.phoneNumberId || head?.qr) ? <UserPane key={uid} userId={uid} onBack={() => setSp({})} /> : user ? <div className="flex flex-col min-h-0 min-w-0"><div className="bg-[#f0f2f5] border-b border-line px-4 py-2 flex gap-3 items-center"><button className="md:hidden" aria-label="Back" onClick={() => setSp({})}><ArrowLeft /></button><Avatar name={user.name} size={42} /><div className="min-w-0 grow"><b className="block text-base truncate">{user.name}</b><p className="text-soft text-[13px] truncate">{isTyping(uid) ? <span className="text-[#008069] font-medium">typing…</span> : `${fmtPhone(user.phone)} via ${account?.name}`}</p></div>{!(account?.phoneNumberId || account?.qr) && <a className="btn" target="_blank" rel="noreferrer" href={`/user?id=${uid}`}>Open as user</a>}</div>
        <Thread msgs={msgs} mine="out" typing={isTyping(uid)} botTyping={d.typing.includes('bot:' + uid)} />
        {account?.connected ? <Composer key={uid} onSend={send} placeholder={`Message ${user.name}`} onTyping={() => socket.emit('typing', 'bot:' + uid)} /> : <p className="bg-[#f0f2f5] p-4 text-soft text-center">{account?.name} is disconnected. Connect it to send messages.</p>}
      </div> : <div className="hidden md:grid place-items-center bg-[#f0f2f5] text-soft"><div className="text-center"><MessageCircle size={56} strokeWidth={1} className="mx-auto mb-3" />{accountId ? 'Click a user to open their chat' : 'Select a chat to start messaging'}</div></div>}
    </div></div>;
}
