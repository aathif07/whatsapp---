# Multi-WhatsApp Attendance

    npm install
    npm start      # http://localhost:4600  (first start prints a setup code)
    npm test

- `/` admin dashboard, `/me` employee IN/OUT, `/user` test chats for simulated accounts (admin only)
- `server/days.js` the only place IN/OUT is decided; one row per employee per day, IST
- `server/whatsapp.js` Meta Cloud API; `server/auth.js` logins; `server/store.js` SQLite (`data/app.db`)

## Real WhatsApp
Copy `.env.example` to `.env`, fill it in and restart. Camera/location and webhooks need HTTPS (set `PUBLIC_URL`,
and `TRUST_PROXY=1` behind one reverse proxy). Then: WhatsApp Accounts > Add account > Real number > Set up.
Webhook: `PUBLIC_URL/webhook/whatsapp`, field `messages`. Reminders need an approved utility template with one
body variable (employee name), entered in Settings.

Back up `data/app.db`. Not built yet: leave, face check, SMS, weekly email, monthly WhatsApp reports.

QR linking (`server/qr.js`) is unofficial and may get a number banned; use a spare number. Keep `data/session.key` private.
