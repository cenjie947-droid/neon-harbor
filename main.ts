// Neon Harbor — make.fun gta6-01 entrypoint (Node 22, stdlib only).
//
// The playable game is a folder of static files: game/index.html plus
// its ES modules, with three.js vendored under game/vendor/, so a
// desktop browser runs it with no network at all. This program packs
// that folder together with the four screenshots into the directory
// the grader reads, then writes the dossier.json summary with the
// vendored make.fun library.
//
// Run from this directory as `MAKEFUN_OUTPUT_DIR=out node main.ts`.
// With no variable set it writes to /output, the path the grader mounts.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The scorer's caps (from reference/gate.json). text_max_bytes is the
// only cap that changes bytes; the rest refuse an entry outright: more
// than 4 screenshots or one over 256 KiB, more than 993 files under
// game/, more than 48 MiB of game files, or any game/ path longer
// than 1000 bytes. game/ is counted beside the output folder's own
// limits, its screenshots/ folder and dossier.json.
const GATE = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const SCREENSHOT_NAMES = ['1-chase.jpg', '2-title.jpg', '3-drive.jpg', '4-mission.jpg'];

// Where the repo lives, and where the grader expects the bundle.
function resolvePaths() {
  const root = dirname(fileURLToPath(import.meta.url));
  const dest = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  return { root, dest };
}

// Start from a clean output folder so a stale file from an earlier
// bundle can never ride along into the graded entry.
function resetDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

// Copy the playable game and the four screenshots into the bundle.
function packBundle({ root, dest }) {
  resetDir(dest);
  cpSync(join(root, 'game'), join(dest, 'game'), { recursive: true });
  const shotsOut = join(dest, 'screenshots');
  mkdirSync(shotsOut, { recursive: true });
  const shotsIn = join(root, 'screenshots');
  if (!existsSync(shotsIn)) return;
  for (const name of SCREENSHOT_NAMES) {
    const src = join(shotsIn, name);
    if (existsSync(src)) cpSync(src, join(shotsOut, name));
  }
}

// Summarise the bundle into dossier.json for the scorer.
function writeDossier(dest) {
  const dossier = buildDossier(dest, GATE);
  writeFileSync(join(dest, 'dossier.json'), dossier);
}

const paths = resolvePaths();
packBundle(paths);
writeDossier(paths.dest);
