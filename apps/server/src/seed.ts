/**
 * Seed-Skript: legt den ersten Admin an (oder setzt dessen Passwort zurück) und optional Demo-Daten.
 *
 *   pnpm seed                                   # interaktiv
 *   ADMIN_USERNAME=admin ADMIN_EMAIL=a@b.de ADMIN_PASSWORD=... pnpm seed
 *   pnpm seed -- --username admin --email a@b.de --password ... [--demo]
 *   docker compose exec server node dist/seed.js --username admin --email a@b.de
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from './lib/password.js';
import { slugify } from './lib/slug.js';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    demo: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

async function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Eingabe nicht anzeigen
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(question)) out.output.write(s);
    };
  }
  const answer = await rl.question(question);
  if (hidden) process.stdout.write('\n');
  rl.close();
  return answer.trim();
}

async function main() {
  const db = new PrismaClient();
  try {
    let username = values.username ?? process.env.ADMIN_USERNAME ?? '';
    let email = values.email ?? process.env.ADMIN_EMAIL ?? '';
    let password = values.password ?? process.env.ADMIN_PASSWORD ?? '';
    const interactive = process.stdin.isTTY;
    if (!username) username = interactive ? await ask('Admin-Benutzername [admin]: ') || 'admin' : 'admin';
    if (!email) {
      if (!interactive) throw new Error('ADMIN_EMAIL bzw. --email fehlt');
      email = await ask('Admin-E-Mail: ');
    }
    if (!password) {
      if (!interactive) throw new Error('ADMIN_PASSWORD bzw. --password fehlt');
      password = await ask('Admin-Passwort (min. 10 Zeichen): ', true);
    }
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error('Ungültiger Benutzername (3–32 Zeichen: a-z, 0-9, _ . -)');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Ungültige E-Mail-Adresse');
    if (password.length < 10) throw new Error('Passwort muss mindestens 10 Zeichen haben');

    const passwordHash = await hashPassword(password);
    const existing = await db.user.findFirst({ where: { OR: [{ username: { equals: username, mode: 'insensitive' } }, { email: email.toLowerCase() }] } });
    if (existing) {
      await db.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', passwordHash, disabled: false } });
      console.log(`✔ Bestehender Nutzer "${existing.username}" ist jetzt Admin, Passwort wurde gesetzt.`);
    } else {
      await db.user.create({ data: { username, email: email.toLowerCase(), passwordHash, role: 'ADMIN' } });
      console.log(`✔ Admin "${username}" wurde angelegt.`);
    }

    const genres = ['Action', 'Adventure', 'RPG', 'Strategy', 'Simulation', 'Puzzle', 'Platformer', 'Shooter', 'Racing', 'Indie', 'Casual', 'Sports'];
    for (const name of genres) {
      await db.genre.upsert({ where: { slug: slugify(name) }, create: { slug: slugify(name), name }, update: {} });
    }

    if (values.demo) {
      const admin = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
      const demos = [
        { title: 'SuperTux', genres: ['Platformer'], tags: ['Open Source', '2D', 'Singleplayer'], dev: 'SuperTux Team' },
        { title: '0 A.D.', genres: ['Strategy'], tags: ['Open Source', 'RTS', 'Multiplayer', 'Historical'], dev: 'Wildfire Games' },
        { title: 'Xonotic', genres: ['Shooter', 'Action'], tags: ['Open Source', 'Arena', 'Multiplayer', 'Fast-Paced'], dev: 'Team Xonotic' },
        { title: 'Battle for Wesnoth', genres: ['Strategy', 'RPG'], tags: ['Open Source', 'Turn-Based', 'Fantasy'], dev: 'Wesnoth Team' },
        { title: 'SuperTuxKart', genres: ['Racing', 'Casual'], tags: ['Open Source', 'Kart', 'Multiplayer'], dev: 'SuperTuxKart Team' },
        { title: 'Mindustry', genres: ['Strategy', 'Simulation'], tags: ['Open Source', 'Tower Defense', 'Automation'], dev: 'Anuke' },
      ];
      for (const d of demos) {
        const slug = slugify(d.title);
        if (await db.game.findUnique({ where: { slug } })) continue;
        await db.game.create({
          data: {
            slug,
            title: d.title,
            shortDescription: `${d.title} – ein freies Open-Source-Spiel (Demo-Eintrag ohne Dateien).`,
            description: `# ${d.title}\n\nDies ist ein **Demo-Eintrag**, angelegt vom Seed-Skript. Lade im Admin-Panel eine Version mit Build hoch, um ihn spielbar zu machen.`,
            developer: d.dev,
            visibility: 'PUBLIC',
            publishedAt: new Date(),
            createdById: admin.id,
            maintainers: { create: { userId: admin.id } },
            genres: { connectOrCreate: d.genres.map((n) => ({ where: { slug: slugify(n) }, create: { slug: slugify(n), name: n } })) },
            tags: { connectOrCreate: d.tags.map((n) => ({ where: { slug: slugify(n) }, create: { slug: slugify(n), name: n } })) },
          },
        });
      }
      await db.announcement.create({
        data: { title: 'Willkommen!', body: 'Deine selbst gehostete Spieleplattform ist eingerichtet. Viel Spaß! 🎮', pinned: true, authorId: admin.id },
      });
      console.log('✔ Demo-Daten angelegt.');
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(`✖ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
