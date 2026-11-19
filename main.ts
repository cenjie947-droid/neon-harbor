// Neon Harbor — the gta6-01 entry program (Node 22, standard library
// only). The game is plain static files a desktop browser loads offline:
// game/index.html and its ES modules, with three.js vendored as a minified
// build under game/vendor/, no network request at play time. This program
// gathers that folder plus the screenshots beside it into the output
// directory the grader reads, and writes the dossier.json summary with the
// vendored make.fun library. Run it from this directory with
// `MAKEFUN_OUTPUT_DIR=out node main.ts`; without the variable it writes
// to /output, the path the grader mounts.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Where the game lives, and where the grader expects it.
function resolveDirs() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  return { here, out };
}

// The scorer's own caps (from reference/gate.json): only text_max_bytes
// shapes the bytes; the rest refuse an entry the scorer would refuse —
// more than 4 screenshots or one over 256 KiB, more than 993 files in
// game/ or 48 MiB of game files in all, or a path under game/ over 1000
// bytes (game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function gatherGameFiles(here, out) {
  mkdirSync(out, { recursive: true });
  cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  if (existsSync(join(here, 'screenshots'))) {
    cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
  }
}

function writeDossier(out) {
  const dossier = buildDossier(out, DOSSIER_LIMITS);
  writeFileSync(join(out, 'dossier.json'), dossier);
}

const { here, out } = resolveDirs();
gatherGameFiles(here, out);
writeDossier(out);
