import { useEffect, useState } from 'react';
import { MapPin, CheckCircle2 } from 'lucide-react';
import { api, time, dur, getPlace } from './lib.jsx';

/** The page behind the "Mark Attendance" button in the WhatsApp message. */
export default function CheckIn({ token }) {
  const [c, set] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api('/checkin/' + token).then(set).catch((e) => setErr(e.message)); }, [token]);
  const mark = async () => { setBusy(true); setErr(''); try { set({ ...c, ...await api('/checkin/' + token, 'POST', await getPlace()) }); } catch (e) { setErr(e.message); } setBusy(false); };
  return <main className="wall min-h-dvh grid place-items-center p-4"><section className="card w-full max-w-sm p-7 text-center">
    {!c ? <p>{err || 'Loading…'}</p> : c.done ? <><CheckCircle2 size={56} className="text-good mx-auto mb-4" /><h1 className="text-xl font-bold">You've successfully been checked in!</h1>{c.row && <p className="mt-2 text-soft">IN {time(c.row.inAt)}{c.row.late ? `, late by ${dur(c.row.late)}` : ', on time'}</p>}<p className="mt-2">Send “OUT” on WhatsApp when you leave.</p></>
      : !c.open ? <><h1 className="text-xl font-bold">This link is closed</h1><p className="mt-2 text-soft">Send “IN” on WhatsApp to get a new link, or contact your administrator.</p></>
        : <><MapPin size={52} className="text-brand mx-auto mb-4" /><h1 className="text-xl font-bold">Hey {c.name}</h1><p className="mt-2 mb-5 text-soft">Share your current location to mark your attendance.</p>
          <button className="btn-main w-full py-3!" disabled={busy} onClick={mark}>{busy ? 'Finding your location…' : 'Mark Attendance'}</button>
          {err && <p role="alert" className="mt-4 text-bad">{err}</p>}</>}
  </section></main>;
}
