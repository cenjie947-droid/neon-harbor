// Neon Harbor — make.fun gta6-01 entry program (Node 22, stdlib only).
//
// The game is a folder of static files a desktop browser loads with no
// network at all: game/index.html and its ES modules, three.js vendored
// under game/vendor/. This program gathers that folder plus the four
// screenshots into the directory the grader reads, then writes the
// dossier.json summary with the vendored make.fun library.
//
// Run from this directory as `MAKEFUN_OUTPUT_DIR=out node main.ts`.
// With no variable set it writes to /output, the path the grader mounts.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The scorer's caps (from reference/gate.json). text_max_bytes is the
// only one that changes bytes; the rest refuse an entry outright: more
// than 4 screenshots or one over 256 KiB, more than 993 files under
// game/, more than 48 MiB of game files, or any game/ path longer than
// 1000 bytes. game/ is counted beside the output folder's own limits,
// its screenshots/ folder and dossier.json.
const GATE = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function locate() {
  const root = dirname(fileURLToPath(import.meta.url));
  const dest = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  return { root, dest };
}

function gather({ root, dest }) {
  mkdirSync(dest, { recursive: true });
  cpSync(join(root, 'game'), join(dest, 'game'), { recursive: true });
  const shotsIn = join(root, 'screenshots');
  const shotsOut = join(dest, 'screenshots');
  mkdirSync(shotsOut, { recursive: true });
  if (existsSync(shotsIn)) cpSync(shotsIn, shotsOut, { recursive: true });
}

function summarise(dest) {
  const dossier = buildDossier(dest, GATE);
  writeFileSync(join(dest, 'dossier.json'), dossier);
}

const paths = locate();
gather(paths);
summarise(paths.dest);
