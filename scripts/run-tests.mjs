// Lists the test files explicitly: `node --test <dir>` behaves differently across Node versions.
// With --coverage it also measures the plugin's own code and fails below FLOORS.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { belowFloors, coverageTable, ownFiles, parseLcov, totals } from './lib/coverage.mjs';

// Just under what the suite reached on Linux with Node 20.12.2 when these were set: 96.6% of lines,
// 89.6% of branches and 94.0% of functions. Losing tests fails, and small changes do not.
const FLOORS = { lines: 94, branches: 87, functions: 91 };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'test'))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => join('test', name));

const coverage = process.argv.includes('--coverage');
const lcov = join(root, 'coverage', 'lcov.info');
if (coverage) mkdirSync(dirname(lcov), { recursive: true });
const options = coverage
  ? ['--experimental-test-coverage', '--test-reporter=lcov', `--test-reporter-destination=${lcov}`, '--test-reporter=spec', '--test-reporter-destination=stdout']
  : [];

// A test that hangs fails with its name after two minutes, instead of holding CI until its own limit.
const { status } = spawnSync(process.execPath, [...options, '--test-timeout=120000', '--test', ...files], { cwd: root, stdio: 'inherit' });
if (!coverage || status !== 0) process.exit(status ?? 1);

const own = ownFiles(parseLcov(readFileSync(lcov, 'utf8')));
const measured = totals(own);
console.log(coverageTable(own));
console.log(`${own.length} files: ${measured.lines.toFixed(1)}% of lines, ${measured.branches.toFixed(1)}% of branches, ${measured.functions.toFixed(1)}% of functions`);
const problems = own.length ? belowFloors(measured, FLOORS) : ['no plugin code was measured'];
for (const problem of problems) console.error(`FAIL ${problem}`);
process.exit(problems.length ? 1 : 0);
