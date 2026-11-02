// Every package that ships or builds the plugin must carry a license on this list, and everything that
// ships must be credited in THIRD_PARTY_NOTICES.md with its license text where the license asks for it.
// This checks what the lockfiles declare; it does not read each package's own license file.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginDir, root } from './lib/project.mjs';

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'MPL-2.0', 'OFL-1.1', 'BlueOak-1.0.0', 'CC0-1.0']);
// These ship inside the zip, so each needs a line in the notices.
const SHIPPED_NOTICES = { ws: 'licenses/MIT-ws.txt', '@resvg/resvg-wasm': null };
const FONTS = { outfit: 'licenses/OFL-outfit.txt' };

const problems = [];

function packagesOf(lockPath, { runtimeOnly }) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  return Object.entries(lock.packages)
    .filter(([path, info]) => path.startsWith('node_modules/') && (!runtimeOnly || (!info.dev && !info.optional)))
    .map(([path, info]) => ({ name: path.slice(path.lastIndexOf('node_modules/') + 13), license: info.license, version: info.version }));
}

/** "(MIT OR Apache-2.0)" is fine when any one choice is allowed. */
function isAllowed(license) {
  if (!license) return false;
  const choices = String(license).replace(/[()]/g, '').split(/\s+OR\s+/);
  return choices.some((choice) => choice.split(/\s+AND\s+/).every((part) => ALLOWED.has(part.trim())));
}

const runtime = packagesOf(join(pluginDir, 'package-lock.json'), { runtimeOnly: true });
const tooling = packagesOf(join(root, 'package-lock.json'), { runtimeOnly: false });

for (const { name, license, version } of [...runtime, ...tooling]) {
  if (!isAllowed(license)) problems.push(`${name}@${version}: license ${license ?? 'not declared'} is not on the allowed list`);
}

const notices = readFileSync(join(pluginDir, 'THIRD_PARTY_NOTICES.md'), 'utf8');
for (const { name } of runtime) {
  if (!(name in SHIPPED_NOTICES)) problems.push(`${name} ships in the zip but is not known to this check; add it to THIRD_PARTY_NOTICES.md and here`);
  const shortName = name.split('/').pop();
  if (!notices.includes(shortName)) problems.push(`${name} ships in the zip but is not in THIRD_PARTY_NOTICES.md`);
  const text = SHIPPED_NOTICES[name];
  if (text && !existsSync(join(pluginDir, text))) problems.push(`${name}: missing ${text}`);
}
for (const [font, text] of Object.entries(FONTS)) {
  if (!existsSync(join(pluginDir, text))) problems.push(`font ${font}: missing ${text}`);
  if (!notices.toLowerCase().includes(font)) problems.push(`font ${font} is not in THIRD_PARTY_NOTICES.md`);
}
for (const path of ['plugin/ulanzi-api/LICENSE', 'libs/LICENSE']) {
  if (!existsSync(join(pluginDir, path))) problems.push(`the SDK license must ship: ${path}`);
}
const projectLicense = readFileSync(join(root, 'LICENSE'), 'utf8');
if (!projectLicense.includes('Apache License') || !projectLicense.includes('Version 2.0')) problems.push('LICENSE is not the Apache-2.0 text');
for (const file of ['package.json', 'com.ulanzi.soundpadpro.ulanziPlugin/package.json']) {
  if (JSON.parse(readFileSync(join(root, file), 'utf8')).license !== 'Apache-2.0') problems.push(`${file}: license must be Apache-2.0`);
}

if (problems.length) {
  for (const problem of problems) console.error(`FAIL ${problem}`);
  process.exit(1);
}
console.log(`Licenses OK: ${runtime.length} runtime and ${tooling.length} tooling packages, all on the allowed list, and everything shipped is credited.`);
