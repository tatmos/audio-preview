import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  // GitHub Pages ではリポジトリ名がパスになる（例: /audio-preview/）
  base: process.env.BASE_PATH || '/',
});
