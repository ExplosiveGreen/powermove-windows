import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // `vite dev` reads bindings and vars from wrangler.jsonc's `local`
    // environment: the API at localhost:8787, no service binding.
    adapter: adapter({ platformProxy: { environment: 'local' } }),
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:'],
        'connect-src': ['self'],
        'form-action': ['self'],
        'frame-ancestors': ['none'],
        'base-uri': ['none'],
        'object-src': ['none'],
      },
    },
  },
};

export default config;
