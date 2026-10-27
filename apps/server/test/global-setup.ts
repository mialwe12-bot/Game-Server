import { execSync } from 'node:child_process';

export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST ?? 'postgresql://gs:gs@localhost:5432/gameserver_test';

/** Wendet alle Migrationen auf die Testdatenbank an. */
export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
