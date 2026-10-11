import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs', 'iife'],
  globalName: 'ConnectedCore',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
});

