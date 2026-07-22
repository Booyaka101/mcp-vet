// Copies the bundled Python AST script into dist/ so the published package can
// spawn it at runtime. Runs after `tsc` in the build step.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'src', 'python');
const dest = join(root, 'dist', 'python');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-assets] copied ${src} -> ${dest}`);
