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
    global: { lines: 70, functions: 70, branches: 60, statements: 70 },
  },

  testTimeout: 15000,
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
};

export default config;
