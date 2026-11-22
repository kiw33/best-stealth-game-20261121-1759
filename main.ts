// Emberlight — the entry program (Node 22, standard library only). The game
// lives in this directory's game/ folder: plain static files a desktop
// browser loads offline (game/index.html and its ES modules, no library and
// no network request). This program hands the entry in: it copies game/ and
// screenshots/ from beside this file into the output directory and writes
// output/dossier.json, the summary the judge reads, using the vendored
// make.fun library in vendor/makefun-game.ts.
//
// Run it outside the grader with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own: only text_max_bytes shapes the dossier's
// bytes; the others make this program fail where the scorer would refuse the
// entry (more than 4 screenshots or one over 256 KiB; more than 993 entries
// in game/ or 48 MiB of game files in all, or a game path over 1000 bytes).
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
