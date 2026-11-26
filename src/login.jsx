import { useCallback, useEffect, useState } from 'react';
import { MessageCircleCheck } from 'lucide-react';
import { api, Label } from './lib.jsx';

export const Brand = ({ title, sub, children }) => <main className="wall min-h-dvh"><div className="bg-[#008069] h-44 text-white px-4"><div className="max-w-[420px] mx-auto pt-7 flex items-center gap-3"><span className="w-12 h-12 rounded-full rounded-bl-sm bg-[#25d366] text-[#0b3d34] grid place-items-center"><MessageCircleCheck size={27} /></span><div><h1 className="text-2xl font-bold leading-tight">{title}</h1><p className="text-[#d5efe6]">{sub}</p></div></div></div><section className="card w-[min(94vw,420px)] mx-auto -mt-14 mb-8 p-6">{children}</section></main>;

/** Shows the administrator sign-in (or first-time setup) until there is a session. */
export function Gate({ children }) {
  const [s, set] = useState(null), [f, setF] = useState({ code: '', name: '', email: '', password: '' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/auth').then(set).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); addEventListener('signed-out', load); return () => removeEventListener('signed-out', load); }, [load]);
  if (s?.admin) return children(s.admin);
  if (!s) return <p className="p-10">{err || 'Loading…'}</p>;
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async (e) => { e.preventDefault(); setBusy(true); try { await api(s.setup ? '/auth/setup' : '/auth/login', 'POST', f); setErr(''); await load(); } catch (x) { setErr(x.message); } setBusy(false); };
  return <Brand title={s.setup ? 'First-time setup' : 'Admin sign in'} sub="Multi-WhatsApp Attendance"><form onSubmit={go}>
    {s.setup && <><Label t="Setup code (shown where the server started)"><input required autoComplete="off" className="field" value={f.code} onChange={on('code')} /></Label><Label t="Your name"><input required className="field" value={f.name} onChange={on('name')} /></Label></>}
    <Label t="Email"><input required type="email" autoComplete="username" className="field" value={f.email} onChange={on('email')} /></Label>
    <Label t={s.setup ? 'Password (at least 10 characters)' : 'Password'}><input required type="password" minLength={s.setup ? 10 : 1} autoComplete={s.setup ? 'new-password' : 'current-password'} className="field" value={f.password} onChange={on('password')} /></Label>
    {err && <p role="alert" className="text-bad mb-3">{err}</p>}<button disabled={busy} className="btn-main w-full py-3!">{s.setup ? 'Create administrator' : 'Sign in'}</button>
    <p className="text-center mt-4"><a className="text-brand font-medium" href="/me">Employee sign in</a></p></form></Brand>;
}
