// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  redirects: {
    '/jsnes/': {
      destination: 'https://jsnes.org',
      status: 301
    },
    '/projects/jsnes': {
      destination: 'https://jsnes.org',
      status: 301
    }
  },

  adapter: cloudflare()
});