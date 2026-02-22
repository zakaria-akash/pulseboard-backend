import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Discovery
  roots: ['<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],

  // TypeScript transform
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },

  // Node16 module resolution emits imports with `.js` extensions.
  // ts-jest needs to map those back to the source `.ts` files at test time.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  moduleFileExtensions: ['ts', 'js', 'json'],

  // Coverage
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/types/**',
    '!src/server.ts', // entry point — covered by integration
  ],
  coverageThreshold: {
    // lines/statements/branches reflect the current test suite well.
    // functions is lower because audit, tenant, and streaming utilities
    // have no dedicated tests yet — raise this as coverage is added.
    global: { lines: 70, functions: 55, branches: 60, statements: 70 },
  },

  // Run before each test file to populate process.env before env.ts is imported.
  setupFiles: ['<rootDir>/tests/setup.ts'],

  testTimeout: 15000,
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
};

export default config;
