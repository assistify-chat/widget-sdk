#!/usr/bin/env node
/**
 * Run "Are The Types Wrong?" against the local package.
 *
 * attw 0.18.2's `extractTarball` uses fflate's streaming `Gunzip`, which emits
 * the decompressed payload in the first callback and then fires a final
 * zero-length callback. The CLI keeps only the LAST chunk via
 * `unzipped = chunk`, so the file array is empty and the CLI crashes with
 * `Cannot read properties of undefined (reading 'filename')` (fflate#207).
 *
 * Workaround: gunzip with the synchronous API, untar by hand, and feed the
 * resulting file map into the `Package` constructor — bypassing the
 * `createPackageFromTarballData` path entirely. Delete this wrapper once
 * upstream switches to `gunzipSync`.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'fflate';
import { untar } from '@andrewbranch/untar.js';
import { Package, checkPackage } from '@arethetypeswrong/core';
import ts from 'typescript';

const pkgDir = resolve(process.cwd());
const tmp = mkdtempSync(join(tmpdir(), 'attw-'));

try {
  execSync(`npm pack --pack-destination ${tmp}`, { cwd: pkgDir, stdio: 'pipe' });
  const tgzName = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  if (!tgzName) throw new Error('attw wrapper: npm pack produced no tarball');

  const gz = new Uint8Array(readFileSync(join(tmp, tgzName)));
  const raw = gunzipSync(gz);
  const files = untar(raw);
  if (!files.length) throw new Error('attw wrapper: untar produced no files');

  const prefix = files[0].filename.slice(0, files[0].filename.indexOf('/') + 1);
  const pkgJsonRaw = files.find((f) => f.filename === prefix + 'package.json')?.fileData;
  if (!pkgJsonRaw) throw new Error('attw wrapper: no package.json in tarball');
  const pkgJson = JSON.parse(new TextDecoder().decode(pkgJsonRaw));

  const fileMap = files.reduce((acc, f) => {
    const path = ts.combinePaths('/node_modules/' + pkgJson.name, f.filename.slice(prefix.length));
    acc[path] = f.fileData;
    return acc;
  }, {});
  const pkg = new Package(fileMap, pkgJson.name, pkgJson.version);

  // ESM-only package: skip CJS/node10 resolution problems (matches attw's
  // built-in `--profile esm-only`).
  const ignoreResolutions = new Set(['node10', 'node16-cjs']);
  const result = await checkPackage(pkg);
  const allProblems = result.problems ?? [];
  const problems = allProblems.filter((p) => !ignoreResolutions.has(p.resolutionKind));
  if (problems.length === 0) {
    console.log(`attw: no problems for ${pkg.packageName}@${pkg.packageVersion}`);
    process.exit(0);
  }
  for (const p of problems) console.error('  •', JSON.stringify(p));
  console.error(`attw: ${problems.length} problem(s)`);
  process.exit(1);
} finally {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
}
