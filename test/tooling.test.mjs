import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { belowFloors, ownFiles, parseLcov, totals } from '../scripts/lib/coverage.mjs';
import { PLUGIN_FOLDER, root } from '../scripts/lib/project.mjs';
import { manifestVersion, setVersion, versionMismatches } from '../scripts/lib/version.mjs';

const VERSION_FILES = ['package.json', 'package-lock.json', `${PLUGIN_FOLDER}/package.json`, `${PLUGIN_FOLDER}/package-lock.json`, `${PLUGIN_FOLDER}/manifest.json`];

function versionFilesCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'soundpad-pro-version-'));
  for (const file of VERSION_FILES) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(root, file), join(dir, file));
  }
  return dir;
}

test('raising the version changes every copy of it and nothing else', () => {
  const dir = versionFilesCopy();
  try {
    const before = manifestVersion(root);
    setVersion(dir, '9.8.7');
    assert.equal(manifestVersion(dir), '9.8.7');
    assert.deepEqual(versionMismatches(dir, '9.8.7'), []);
    for (const file of VERSION_FILES) {
      const changed = readFileSync(join(dir, file), 'utf8').split('\n');
      const original = readFileSync(join(root, file), 'utf8').split('\n');
      assert.equal(changed.length, original.length, file);
      const different = changed.filter((line, i) => line !== original[i]);
      assert.equal(different.length, file.endsWith('package-lock.json') ? 2 : 1, file);
      for (const line of different) assert.ok(line.includes('9.8.7'), `${file}: ${line}`);
    }
    assert.equal(JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages[''].version, '9.8.7');
    assert.deepEqual(versionMismatches(root, before), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file with another version is named', () => {
  const dir = versionFilesCopy();
  try {
    setVersion(dir, '9.8.7');
    assert.deepEqual(versionMismatches(dir, '9.8.7'), []);
    assert.equal(versionMismatches(dir, '1.0.0').length, VERSION_FILES.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const LCOV = [
  'TN:',
  'SF:com.ulanzi.soundpadpro.ulanziPlugin\\plugin\\app.js',
  'FNF:4', 'FNH:2', 'BRF:10', 'BRH:5', 'LF:100', 'LH:50',
  'end_of_record',
  'SF:com.ulanzi.soundpadpro.ulanziPlugin/plugin/navigation.js',
  'FNF:4', 'FNH:4', 'BRF:10', 'BRH:10', 'LF:100', 'LH:100',
  'end_of_record',
  'SF:com.ulanzi.soundpadpro.ulanziPlugin/plugin/ulanzi-api/index.js',
  'FNF:9', 'FNH:0', 'BRF:9', 'BRH:0', 'LF:900', 'LH:0',
  'end_of_record',
  'SF:com.ulanzi.soundpadpro.ulanziPlugin/plugin/render/glyphs/outfit.js',
  'LF:900', 'LH:0',
  'end_of_record',
  'SF:com.ulanzi.soundpadpro.ulanziPlugin/node_modules/ws/index.js',
  'LF:900', 'LH:0',
  'end_of_record',
  'SF:test/view.test.mjs',
  'LF:900', 'LH:0',
  'end_of_record',
].join('\r\n');

test('coverage counts the plugin code of this project, not the SDK, outlines, dependencies or tests', () => {
  const own = ownFiles(parseLcov(LCOV));
  assert.equal(own.length, 2);
  assert.deepEqual(totals(own), { lines: 75, branches: 75, functions: 75 });
});

test('coverage below a floor is named, and at the floor passes', () => {
  const measured = { lines: 75, branches: 60, functions: 75 };
  assert.deepEqual(belowFloors(measured, { lines: 75, branches: 75, functions: 50 }), ['branches coverage is 60.0%, below the floor of 75%']);
  assert.deepEqual(belowFloors(measured, { lines: 75, branches: 60, functions: 75 }), []);
});
