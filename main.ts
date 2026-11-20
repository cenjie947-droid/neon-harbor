// Round 5 note: the game sources this entrypoint packs were rewritten in the recorded build session.
// Neon Harbor — entry program for the gta6-01 competition (Node 22,
// standard library only). The game itself is a folder of static files a
// desktop browser loads offline: game/index.html plus its ES modules, with
// three.js vendored as a minified build under game/vendor/, so nothing is
// fetched from the network at play time. This program's job is to collect
// that folder and the screenshots beside it into the directory the grader
// reads, then write the dossier.json summary using the vendored make.fun
// library. Run it from this directory as
// `MAKEFUN_OUTPUT_DIR=out node main.ts`; with no variable set it writes
// to /output, the path the grader mounts.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Caps the scorer enforces (from reference/gate.json). Only text_max_bytes
// changes the bytes; the rest are gates that refuse an entry the scorer
// would refuse outright: more than 4 screenshots or one over 256 KiB, more
// than 993 files inside game/, more than 48 MiB of game files in total, or
// any path under game/ longer than 1000 bytes. game/ is counted beside
// /output's own 1000-entry cap, its screenshots/ folder and dossier.json.
const GATE = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function entryPaths() {
  const root = dirname(fileURLToPath(import.meta.url));
  const dest = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  return { root, dest };
}

function copyEntry({ root, dest }) {
  mkdirSync(dest, { recursive: true });
  cpSync(join(root, 'game'), join(dest, 'game'), { recursive: true });
  const shotSrc = join(root, 'screenshots');
  const shotDest = join(dest, 'screenshots');
  mkdirSync(shotDest, { recursive: true });
  if (existsSync(shotSrc)) cpSync(shotSrc, shotDest, { recursive: true });
}

function writeSummary(dest) {
  const summary = buildDossier(dest, GATE);
  writeFileSync(join(dest, 'dossier.json'), summary);
}

const paths = entryPaths();
copyEntry(paths);
writeSummary(paths.dest);
