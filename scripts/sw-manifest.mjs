// Vite plugin: writes dist/sw.js with a precache list of the built app shell.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** @returns {import('vite').Plugin} */
export function swManifest() {
  let outDir = 'dist';
  return {
    name: 'sw-manifest',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      /** @type {(dir: string) => string[]} */
      const walk = (dir) =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
        );
      /** @param {string} p */
      const skip = (p) =>
        p === 'sw.js' ||
        p === 'sw-template.js' ||
        p.split('/').pop().startsWith('.') || // dotfiles like .nojekyll
        p.endsWith('.map') ||
        p.endsWith('.ttf') ||
        p.endsWith('.woff') ||
        p.endsWith('.jsonl') ||
        /(^|\/)smiles-drawer[^/]*\.js$/.test(p); // cached on first use instead
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split('\\').join('/'))
        .filter((p) => !skip(p))
        .sort();
      const hash = createHash('sha256');
      for (const p of files) hash.update(p).update(readFileSync(join(outDir, p)));
      const version = hash.digest('hex').slice(0, 12);
      const list = ['./', ...files.map((p) => `./${p}`)];
      const template = readFileSync(join(outDir, 'sw-template.js'), 'utf8');
      writeFileSync(
        join(outDir, 'sw.js'),
        template.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(list, null, 2)),
      );
      rmSync(join(outDir, 'sw-template.js'));
    },
  };
}

