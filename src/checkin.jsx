import { useEffect, useState } from 'react';
import { MapPin, CheckCircle2 } from 'lucide-react';
import { api, time } from './lib.jsx';

/** The page behind the "Mark Attendance" button in the WhatsApp message. */
export default function CheckIn({ token }) {
  const [c, set] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  useEffect(() => { api('/checkin/' + token).then(set).catch((e) => setErr(e.message)); }, [token]);
  const send = async (b) => { try { set({ ...c, ...await api('/checkin/' + token, 'POST', b) }); setErr(''); } catch (e) { setErr(e.message); } setBusy(false); };
  const locate = () => {
    setBusy(true); setErr('');
    if (!navigator.geolocation) { setBusy(false); setDenied(true); return setErr('This browser cannot share a location.'); }
    navigator.geolocation.getCurrentPosition((p) => send({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => { setBusy(false); setDenied(true); setErr(e.code === 1 ? 'Allow location access in your browser, then try again.' : 'Could not find your location. Try again.'); },
      { enableHighAccuracy: true, timeout: 15000 });
  };
  const late = c?.lateBy >= 60 ? `Late by : ${String(Math.floor(c.lateBy / 60)).padStart(2, '0')}:${String(c.lateBy % 60).padStart(2, '0')}m!` : 'On time';
  return <main className="wall min-h-dvh grid place-items-center p-4"><section className="card w-full max-w-sm p-7 text-center">
    {!c ? <p>{err || 'Loading…'}</p> : c.status === 'present' ? <><CheckCircle2 size={56} className="text-good mx-auto mb-4" /><h1 className="text-xl font-bold">You've successfully been checked in!</h1><p className="mt-2 text-soft">{late}</p></>
      : !c.open ? <><h1 className="text-xl font-bold">Attendance is closed</h1><p className="mt-2 text-soft">Contact your administrator if you need help.</p></>
        : <><MapPin size={52} className="text-brand mx-auto mb-4" /><h1 className="text-xl font-bold">Hey {c.name}</h1><p className="mt-2 mb-5 text-soft">Share your current location to mark your attendance before {time(c.endsAt)}.</p>
          <button className="btn-main w-full py-3!" disabled={busy} onClick={locate}>{busy ? 'Finding your location…' : 'Mark Attendance'}</button>
          {denied && <button className="btn w-full mt-2" disabled={busy} onClick={() => send({ lat: 13.0827, lng: 80.2707, accuracy: 20 })}>Use a demo location (Chennai)</button>}
          {err && <p role="alert" className="mt-4 text-bad">{err}</p>}</>}
  </section></main>;
}
