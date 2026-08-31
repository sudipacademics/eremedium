import { execFileSync } from 'node:child_process';

/**
 * Applies migrations to the test database once, before any test file runs.
 *
 * Uses `migrate deploy` rather than `db push` so the suite exercises the same migration SQL that
 * production runs -- including the CHECK constraints on the earnings split, which `db push` would
 * silently omit and which several tests rely on.
 */
export default function setup(): void {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL (or DATABASE_URL) must be set to run the test suite');
  }

  assertDisposableDatabase(databaseUrl);

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

/**
 * Refuses to run against anything that is not obviously a throwaway database.
 *
 * The suite truncates every table between tests. The production database lives on the same
 * PostgreSQL instance as the test one, so a mistyped host or a stale environment variable is the
 * difference between a green test run and deleting real wallets. The name must say so out loud.
 */
export function assertDisposableDatabase(databaseUrl: string): void {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run tests against database "${name}": its name must contain "test", ` +
        'because the suite truncates every table.',
    );
  }
}
