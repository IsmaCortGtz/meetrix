import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs', 'iife'],
  globalName: 'MeetrixCore',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
});

