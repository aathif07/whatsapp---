import { Fragment, useEffect, useRef, useState } from 'react';
import { SquareArrowOutUpRight, MapPin, Send, Smile, Lock } from 'lucide-react';
import { Ticks, time } from './lib.jsx';

const TINTS = ['#00897b', '#5e6fd1', '#b5567f', '#b26a00', '#3b7f3f', '#7d55b5', '#2a78a8', '#a8503a'];
export function Avatar({ name, size = 44 }) {
  const n = [...name].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return <span aria-hidden className="rounded-full grid place-items-center text-white font-semibold shrink-0" style={{ width: size, height: size, background: TINTS[n % TINTS.length], fontSize: size * 0.38 }}>{name.match(/\d+$/)?.[0].slice(-2) ?? name.slice(0, 1).toUpperCase()}</span>;
}
const dayName = (t) => { const d = new Date(t), y = new Date(); if (d.toDateString() === y.toDateString()) return 'Today'; y.setDate(y.getDate() - 1); return d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); };

/** WhatsApp-style message list. `mine` is the direction shown on the right in green. */
export function Thread({ msgs, mine, typing, botTyping, onCheckin, extra, note = 'Attendance chat. Visible to administrators.' }) {
  const box = useRef();
  useEffect(() => { box.current.scrollTop = box.current.scrollHeight; }, [msgs.at(-1)?.id, typing, botTyping]);
  return <div ref={box} className="wa-wall grow min-h-0 overflow-y-auto px-3 md:px-[6%] py-3" aria-live="polite">
    <p className="wa-chip bg-[#ffeecd]! max-w-md"><Lock size={11} className="inline mr-1" />{note}</p>
    {msgs.map((m, i) => {
      const prev = msgs[i - 1], newDay = !prev || dayName(prev.at) !== dayName(m.at), out = m.dir === mine, tail = newDay || prev.dir !== m.dir;
      return <Fragment key={m.id}>{newDay && <p className="wa-chip">{dayName(m.at)}</p>}
        <div className={`wa-msg ${out ? 'wa-out' : 'wa-in'} ${tail ? 'wa-tail mt-2.5' : 'mt-0.5'}`}>
          <div className="px-2.5 pt-1.5 pb-1.5">
            {m.kind === 'location' && <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${m.lat},${m.lng}`} className="wa-map"><MapPin size={34} fill="#ea4335" color="#fff" /><span>View on map</span></a>}
            {extra?.(m)}<span className={`whitespace-pre-wrap break-words ${m.kind === 'deleted' ? 'italic text-soft' : ''}`}>{m.kind === 'location' ? 'Current location' : m.text}</span>
            {m.error && <span className="block text-bad text-[13px]">{m.error}</span>}<span className="wa-meta">{m.edited && 'Edited '}{time(m.at)}{out && <Ticks s={m.dir === 'in' ? (m.read ? 'read' : 'delivered') : m.status} />}</span>
          </div>
          {m.kind === 'checkin' && (onCheckin ? <button className="wa-cta w-full" onClick={() => onCheckin(m.token)}><SquareArrowOutUpRight size={17} />Mark Attendance</button> : <span className="wa-cta"><SquareArrowOutUpRight size={17} />Mark Attendance</span>)}
        </div></Fragment>;
    })}
    {botTyping && <div className="wa-msg wa-out wa-tail mt-2.5" aria-label="account typing"><div className="wa-dots"><i /><i /><i /></div></div>}
    {typing && <div className="wa-msg wa-in wa-tail mt-2.5 w-fit" aria-label="typing"><div className="wa-dots"><i /><i /><i /></div></div>}
  </div>;
}
const EMOJI = ['😊', '😃', '😂', '👍', '🙏', '👋', '✅', '📍', '❤️', '🎉', '🚗', '⏰'];
export function Composer({ onSend, quick = [], onTyping, placeholder = 'Type a message' }) {
  const [text, set] = useState(''), [open, setOpen] = useState(false), input = useRef(), last = useRef(0);
  const send = async (t) => { if (!t.trim()) return; set(''); setOpen(false); if (!await onSend(t.trim())) set(t); input.current?.focus(); };
  return <div className="bg-[#f0f2f5]">
    {quick.length > 0 && <div className="flex gap-2 px-3 pt-2 overflow-x-auto">{quick.map((x) => <button key={x} className="rounded-full bg-white border border-line px-3 py-1 text-brand font-medium whitespace-nowrap hover:bg-tint" onClick={() => send(x)}>{x}</button>)}</div>}
    {open && <div className="flex flex-wrap gap-1 px-3 pt-2">{EMOJI.map((x) => <button key={x} type="button" className="text-2xl p-1 rounded hover:bg-white" onClick={() => { set(text + x); input.current.focus(); }}>{x}</button>)}</div>}
    <form className="flex items-end gap-2 p-2.5" onSubmit={(e) => { e.preventDefault(); send(text); }}>
      <button type="button" aria-label="Emoji" aria-expanded={open} className="p-2 text-soft" onClick={() => setOpen(!open)}><Smile size={24} /></button>
      <textarea ref={input} rows={Math.min(5, text.split('\n').length)} aria-label="Message" placeholder={placeholder} maxLength={4096} value={text} onChange={(e) => { set(e.target.value); if (onTyping && Date.now() - last.current > 1200) { last.current = Date.now(); onTyping(); } }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }} className="grow min-w-0 resize-none rounded-lg bg-white px-3.5 py-2.5 text-[15px]" />
      <button aria-label="Send" disabled={!text.trim()} className="rounded-full bg-[#00a884] text-white p-2.5 shrink-0"><Send size={20} /></button>
    </form></div>;
}
