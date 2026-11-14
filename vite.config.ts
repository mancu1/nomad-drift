import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' — сборка работает из любого подкаталога GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120_000 },
});
