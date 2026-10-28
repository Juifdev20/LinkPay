// Garde-fou « et sans réseau ? » : `node scripts/check-offline.mjs` (npm run check:offline), lancé avant chaque build.
// Tout fichier de src/ qui écrit sur le serveur doit être déclaré dans scripts/offline-manifest.mjs. Marche à suivre : docs/HORS_LIGNE.md
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from './offline-manifest.mjs';

const SRC = join(fileURLToPath(new URL('..', import.meta.url)), 'src');
const WRITES = /\bapi\s*\.\s*(post|put|patch|delete)\s*\(|\bapi\s*\.\s*request\s*\(/;
const QUEUES = /\benqueue\s*\(/;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(spec|test|d)\.tsx?$/.test(name)) files.push(p);
  }
})(SRC);

const problems = [];
const seen = new Set();
for (const file of files) {
  const rel = relative(SRC, file).split('\\').join('/');
  const code = readFileSync(file, 'utf8');
  const writes = WRITES.test(code);
  const queues = QUEUES.test(code);
  const entry = manifest[rel];
  if (writes) seen.add(rel);
  if (writes && !entry) {
    problems.push(`${rel} écrit sur le serveur sans être déclaré. Que se passe-t-il sans réseau ? Ajoutez-le dans scripts/offline-manifest.mjs ('offline', 'partial' ou 'online' avec la raison). Voir docs/HORS_LIGNE.md.`);
    continue;
  }
  if (!entry) continue;
  if (!writes) { problems.push(`${rel} est déclaré dans le manifeste mais n'écrit plus sur le serveur : retirez-le.`); continue; }
  if ((entry.mode === 'offline' || entry.mode === 'partial') && !queues) problems.push(`${rel} est déclaré '${entry.mode}' mais n'utilise pas enqueue() : où part ce qui est fait hors ligne ?`);
  if (entry.mode === 'online' && queues) problems.push(`${rel} utilise enqueue() mais est déclaré 'online' : déclarez-le 'offline' ou 'partial' et dites ce qui marche sans réseau.`);
  if (entry.mode !== 'offline' && !entry.why) problems.push(`${rel} : la raison ('why') manque.`);
  if ((entry.mode === 'offline' || entry.mode === 'partial') && !entry.offline) problems.push(`${rel} : dites ce qui marche sans réseau ('offline').`);
}
for (const rel of Object.keys(manifest)) if (!seen.has(rel) && !files.some((f) => relative(SRC, f).split('\\').join('/') === rel)) problems.push(`${rel} est dans le manifeste mais le fichier n'existe plus.`);

if (problems.length) {
  console.error(`\nHors ligne : ${problems.length} point(s) à régler\n\n${problems.map((p) => ` - ${p}`).join('\n')}\n`);
  process.exit(1);
}
const count = (m) => Object.values(manifest).filter((e) => e.mode === m).length;
console.log(`Hors ligne : ${seen.size} fichiers qui écrivent, tous déclarés (${count('offline')} sans réseau, ${count('partial')} en partie, ${count('online')} en ligne).`);
