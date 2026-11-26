import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default { plugins: [react(), tailwind()], server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/server/**'] }, watch: { ignored: ['**/data/**'] } } };
