import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  assetsInclude: ['**/local-characters/*.glb', '**/local-rooms/*.glb'],
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

