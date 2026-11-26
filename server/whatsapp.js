// Meta WhatsApp Cloud API. Secrets come from the environment and are never stored in the database.
import { createHmac, timingSafeEqual } from 'node:crypto';
const env = process.env;
const BASE = () => `${env.WA_GRAPH_URL || 'https://graph.facebook.com'}/${env.WA_GRAPH_VERSION || 'v27.0'}`;
export const ready = () => ({ token: !!env.WA_TOKEN, secret: !!env.WA_APP_SECRET, verify: !!env.WA_VERIFY_TOKEN, publicUrl: /^https:\/\//.test(env.PUBLIC_URL ?? '') });

async function graph(path, method = 'GET', body) {
  if (!env.WA_TOKEN) throw Object.assign(new Error('WhatsApp is not set up: add WA_TOKEN on the server.'), { status: 400 });
  let r;
  try { r = await fetch(`${BASE()}/${path}`, { method, headers: { Authorization: `Bearer ${env.WA_TOKEN}`, ...(body && { 'Content-Type': 'application/json' }) }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(15_000) }); }
  catch { throw Object.assign(new Error('Could not reach WhatsApp. Try again.'), { status: 502 }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`WhatsApp: ${j.error?.error_user_msg || j.error?.error_data?.details || j.error?.message || 'request failed'}`), { status: 400 });
  return j;
}
const enc = encodeURIComponent;
export const numberInfo = (id) => graph(`${enc(id)}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,status`);
export const requestCode = (id, method) => graph(`${enc(id)}/request_code`, 'POST', { code_method: method === 'VOICE' ? 'VOICE' : 'SMS', language: 'en_US' });
export const verifyCode = (id, code) => graph(`${enc(id)}/verify_code`, 'POST', { code });
export const register = (id, pin) => graph(`${enc(id)}/register`, 'POST', { messaging_product: 'whatsapp', pin });
export const subscribe = (waba) => graph(`${enc(waba)}/subscribed_apps`, 'POST');

/** Send one stored message. `open` = the person wrote to this number in the last 24 hours. */
export async function send(account, to, m, { open, template, name }) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/\D/g, '') };
  let body;
  if (open && m.kind === 'checkin') body = { ...base, type: 'interactive', interactive: { type: 'cta_url', body: { text: m.text }, action: { name: 'cta_url', parameters: { display_text: 'Mark Attendance', url: `${env.PUBLIC_URL.replace(/\/$/, '')}/checkin/${m.token}` } } } };
  else if (open) body = { ...base, type: 'text', text: { body: m.text } };
  else if (m.recordId && template?.name) body = { ...base, type: 'template', template: { name: template.name, language: { code: template.lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: name }] }] } };
  else throw new Error(m.recordId ? 'Add an approved reminder template in Settings.' : 'This person has not written in the last 24 hours, so WhatsApp does not allow a free message.');
  const j = await graph(`${enc(account.phoneNumberId)}/messages`, 'POST', body);
  return j.messages?.[0]?.id;
}
export function signed(raw, header) {
  if (!env.WA_APP_SECRET || !raw) return false;
  const a = Buffer.from(String(header ?? '')), b = Buffer.from('sha256=' + createHmac('sha256', env.WA_APP_SECRET).update(raw).digest('hex'));
  return a.length === b.length && timingSafeEqual(a, b);
}
