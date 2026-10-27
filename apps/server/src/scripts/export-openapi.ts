// Exportiert die OpenAPI-Spezifikation nach openapi.json (ohne Server zu starten).
import fs from 'node:fs/promises';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

const config = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://x:x@localhost/x' });
const app = await buildApp({ config });
await app.ready();
const out = process.argv[2] ?? 'openapi.json';
await fs.writeFile(out, JSON.stringify(app.swagger(), null, 2));
console.log(`OpenAPI-Spezifikation geschrieben: ${out}`);
await app.close();
