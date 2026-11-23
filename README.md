# Multi-WhatsApp Attendance (demo)

    npm install
    npm start      # http://localhost:4600

React UI and Express API live in this one folder and run on one port. WhatsApp is simulated, so no credentials are
needed. Data is saved in `data/demo.json`.

- `server.js` API, simulated WhatsApp, attendance rules, exports
- `src/` React UI
- `/user` click a user to open their chat. People reply and check in themselves; nothing is automatic.

To go live, replace `deliver()` with Cloud API calls and call `receive()` from a signature-verified webhook. Also add
administrator login and a real database first: the demo has neither and only listens on this computer.
