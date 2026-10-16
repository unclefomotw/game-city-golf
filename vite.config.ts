import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works under GitHub Pages' /<repo>/ path.
  base: './',
  // three.js alone is ~500 kB; a single chunk is fine for this game.
  build: { chunkSizeWarningLimit: 1000 },
});
