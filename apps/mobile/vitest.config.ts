import { defineConfig } from 'vitest/config';

// Unit tests cover the platform-independent logic in src/lib (no React Native imports).
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
