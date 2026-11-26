import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { io } from 'socket.io-client';
import { LayoutDashboard, Smartphone, ClipboardCheck, Inbox as InboxIcon, Users as U, FileBarChart, Download, Settings as S, CalendarDays, LogOut, Menu, MessageCircleCheck, LogIn } from 'lucide-react';
import { Ctx, api } from './lib.jsx';
import { Overview, Accounts, Users, Settings } from './manage.jsx';
import { Attendance, Reports, Report, ExportReports } from './attendance.jsx';
import { Daily } from './days.jsx';
import { Avatar } from './bubbles.jsx';
import { Chat } from './chat.jsx';
const NAV = [['/', 'Dashboard', LayoutDashboard], ['/accounts', 'WhatsApp Accounts', Smartphone], ['/daily', 'Daily Attendance', CalendarDays], ['/attendance', 'Reminders', ClipboardCheck], ['/inbox', 'Messages', InboxIcon], ['/users', 'Users', U], ['/reports', 'Reports', FileBarChart], ['/export', 'Export', Download], ['/settings', 'Settings', S]];
export default function App({ admin }) {
  const [d, setD] = useState(null), [tick, setTick] = useState(0), [toast, setToast] = useState(null), [open, setOpen] = useState(false), [live, setLive] = useState(true), [socket, setSocket] = useState(null);
  const load = useCallback(() => api('/state').then((x) => { setD({ ...x, skew: x.now - Date.now() }); setTick((n) => n + 1); }).catch((e) => setToast(e.message)), []);
  useEffect(() => { load(); const s = io(); setSocket(s); s.on('changed', load); s.on('connect', () => { setLive(true); load(); }); s.on('disconnect', () => setLive(false)); return () => s.close(); }, [load]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t); } }, [toast]);
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) setToast(ok); await load(); return r ?? true; } catch (e) { setToast(e.message); return false; } };
  if (!d) return <p className="p-10 text-soft">{toast || 'Loading…'}</p>;
  const unread = d.conversations.reduce((n, c) => n + c.unread, 0);
  return <Ctx.Provider value={{ d, run, tick, socket }}>
    <div className="flex h-dvh">
      {open && <div className="fixed inset-0 bg-black/30 z-10 md:hidden" onClick={() => setOpen(false)} />}
      <aside className={`${open ? 'flex' : 'hidden'} md:flex fixed md:static z-20 inset-y-0 w-64 shrink-0 bg-[#0b3d34] text-white flex-col p-3`}>
        <div className="flex items-center gap-3 px-2 pt-2 pb-5"><span className="w-11 h-11 rounded-full rounded-bl-sm bg-[#25d366] text-[#0b3d34] grid place-items-center"><MessageCircleCheck size={25} /></span><div className="font-bold text-[17px] leading-tight">Multi-WhatsApp<br /><span className="text-[#9fe3c8] font-medium text-sm">Attendance</span></div></div>
        <nav className="space-y-0.5 grow">{NAV.map(([to, l, I]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3.5 px-4 py-3 rounded-full font-medium ${isActive ? 'bg-[#d9fdd3] text-[#0b3d34]' : 'text-[#d8ebe4] hover:bg-white/10'}`}><I size={20} />{l}{to === '/inbox' && unread > 0 && <span className="ml-auto bg-[#25d366] text-[#06281f] font-bold text-xs rounded-full px-2 py-0.5">{unread}</span>}</NavLink>)}</nav>
        <a href="/user" target="_blank" rel="noreferrer" className="flex items-center gap-3.5 px-4 py-3 mb-2 rounded-full font-medium text-[#d8ebe4] hover:bg-white/10"><LogIn size={20} />Test chats</a><div className="border-t border-white/15 pt-3 px-2 flex items-center gap-3"><Avatar name={admin.name} size={38} /><div className="leading-tight"><b>{admin.name}</b><p className="text-[13px] text-[#b9d8cd] flex items-center gap-1.5 mt-0.5"><i className={`w-2 h-2 rounded-full ${live ? 'bg-[#25d366]' : 'bg-warn'}`} />{live ? 'Online' : 'Reconnecting…'}</p></div><button aria-label="Sign out" className="ml-auto p-2 rounded-full hover:bg-white/10" onClick={async () => { await api('/auth/logout', 'POST').catch(() => {}); dispatchEvent(new Event('signed-out')); }}><LogOut size={19} /></button></div>
      </aside>
      <main className="wall grow min-w-0 overflow-y-auto">
        <div className="md:hidden flex items-center gap-3 p-3 bg-[#0b3d34] text-white"><button aria-label="Menu" onClick={() => setOpen(true)}><Menu /></button><b>Multi-WhatsApp Attendance</b></div>
        <Routes>
          <Route path="/" element={<Overview />} /><Route path="/accounts" element={<Accounts />} /><Route path="/accounts/:accountId" element={<Chat />} />
          <Route path="/attendance" element={<Attendance />} /><Route path="/daily" element={<Daily />} /><Route path="/inbox" element={<Chat />} /><Route path="/users" element={<Users />} />
          <Route path="/reports" element={<Reports />} /><Route path="/reports/:id" element={<Report />} /><Route path="/export" element={<ExportReports />} /><Route path="/settings" element={<Settings />} />
          <Route path="*" element={<p className="p-10">Page not found.</p>} />
        </Routes>
      </main>
    </div>
    {toast && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-[#111b21] text-white px-5 py-3 rounded-full shadow-lg z-50">{toast}</div>}
  </Ctx.Provider>;
}
