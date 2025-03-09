// @ts-check
import { defineConfig } from 'astro/config';

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
    },
    '/projects/jsnes/': {
      destination: 'https://jsnes.org',
      status: 301
    }
  }
});
