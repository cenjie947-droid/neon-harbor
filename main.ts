// main.ts — the Neon Harbor entry program (Node 22, standard library only).
//
// It packs the game folder and the four screenshots into the output
// folder and writes dossier.json, the summary the judge reads, using the
// vendored make.fun library. The output folder starts clean every run, so
// a stale file from an earlier build can never ride along.
//
// Run it with:
//   MAKEFUN_OUTPUT_DIR=out node main.ts
// (Outside the grader's container MAKEFUN_OUTPUT_DIR stands in for
// /output; with no variable set, /output is used.)
//
// The four screenshots, in order, are the submission's cover and scenes:
//   1-chase.jpg    — the cover: Cole driving the Comet GT downtown,
//                    police in pursuit, 3 wanted stars.
//   2-title.jpg    — the title screen over the city.
//   3-drive.jpg    — driving through the streets.
//   4-mission.jpg  — the mission-complete panel after The Pickup:
//                    reward $300, total cash $450.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

// The scorer's caps: text_max_bytes shapes the bytes; the rest refuse an
// entry the scorer would refuse — more than 4 screenshots, one over
// 256 KiB, more than 993 files under game/, more than 48 MiB of game
// files in all, or a game path over 1000 bytes.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const SHOT_ORDER = ['1-chase.jpg', '2-title.jpg', '3-drive.jpg', '4-mission.jpg'];

function fail(message) {
  console.error('main.ts: ' + message);
  process.exit(1);
}

// Check the screenshots exist, in order, and inside the size cap, before
// anything is copied — a missing or oversized shot fails here, loudly,
// instead of producing a dossier the scorer rejects.
function checkShots() {
  if (!existsSync(shotsDir)) fail('screenshots/ folder is missing next to main.ts');
  const found = readdirSync(shotsDir)
    .filter((name) => /\.(jpe?g|png)$/i.test(name))
    .sort();
  if (found.length === 0) fail('no screenshots found in screenshots/');
  if (found.length > CAPS.screenshots.max) {
    fail(`found ${found.length} screenshots, the cap is ${CAPS.screenshots.max}`);
  }
  for (const name of SHOT_ORDER) {
    if (!found.includes(name)) fail(`missing screenshot ${name}`);
  }
  for (const name of found) {
    const size = statSync(join(shotsDir, name)).size;
    if (size > CAPS.screenshots.max_bytes) {
      fail(`screenshot ${name} is ${size} bytes, over the ${CAPS.screenshots.max_bytes} cap`);
    }
  }
  return found;
}

function checkGame() {
  if (!existsSync(gameDir)) fail('game/ folder is missing next to main.ts');
  if (!existsSync(join(gameDir, 'index.html'))) fail('game/index.html is missing');
}

// Start from a clean output folder, then copy the game and the shots in.
function pack(shots) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(gameDir, join(outDir, 'game'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  for (const name of shots) {
    cpSync(join(shotsDir, name), join(outDir, 'screenshots', name));
  }
}

function main() {
  const shots = checkShots();
  checkGame();
  pack(shots);
  const dossier = buildDossier(outDir, CAPS);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(`Neon Harbor packed to ${outDir}`);
  console.log(`  game files copied from game/`);
  console.log(`  screenshots: ${shots.join(', ')}`);
  console.log(`  dossier.json written`);
}

main();
