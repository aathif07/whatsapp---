import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default { plugins: [react(), tailwind()], server: { watch: { ignored: ['**/data/**'] } } };
