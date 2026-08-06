import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'load-js-as-jsx',
      enforce: 'pre',
      async transform(code, id) {
        if (!/src\/.*\.[jt]sx?$/.test(id)) return null;
        return transformWithEsbuild(code, id, {
          loader: id.endsWith('.ts') || id.endsWith('.tsx') ? 'tsx' : 'jsx',
          jsx: 'automatic',
        });
      },
    },
    react({ include: '**/*.{js,jsx,ts,tsx}' }),
  ],
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.js$/,
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
});
