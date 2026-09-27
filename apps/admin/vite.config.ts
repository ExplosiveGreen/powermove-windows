import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// 5174 is the ADMIN_ORIGIN in apps/cloud/.dev.vars.example.
export default defineConfig({
  plugins: [sveltekit()],
  server: { port: 5174, strictPort: true },
});
