// Contract between the manifest, the language files, the panel and the code. Mistakes here are
// silent in the host.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  ACCENTS, BACKGROUNDS, CONTROL_ACTIONS, ICONS, NAV_FUNCTIONS, OUTPUTS, PLAY_MODES,
  normalizeControlSettings, normalizeNavSettings, normalizeSlotSettings, normalizeSoundSettings,
} from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/settings.js';

const pluginDir = fileURLToPath(new URL('../com.ulanzi.soundpadpro.ulanziPlugin/', import.meta.url));
const read = (path) => readFileSync(join(pluginDir, path), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const html = read('property-inspector/soundpad/inspector.html');
const inspectorJs = read('property-inspector/soundpad/inspector.js');
const languages = readdirSync(pluginDir).filter((name) => /^[a-z]{2}(_[A-Z]{2})?\.json$/.test(name));
const en = JSON.parse(read('en.json'));

test('UUIDs follow the shape the SDK relies on, and the code agrees', () => {
  assert.equal(manifest.UUID, 'com.ulanzi.soundpadpro.ulanziPlugin');
  assert.equal(manifest.UUID.split('.').length, 4);
  const app = read('plugin/app.js');
  assert.ok(app.includes(`PLUGIN_UUID = '${manifest.UUID}'`));
  assert.deepEqual(manifest.Actions.map((action) => action.UUID.split('.').pop()), ['sound', 'slot', 'nav', 'control']);
  for (const action of manifest.Actions) {
    assert.ok(action.UUID.startsWith(`${manifest.UUID}.`));
    assert.ok(action.UUID.split('.').length > 4);
    assert.ok(app.includes(`[\`\${PLUGIN_UUID}.${action.UUID.split('.').pop()}\`]`), action.UUID);
  }
});

test('names fit the store limits', () => {
  assert.ok(manifest.Name.length <= 40);
  assert.ok(manifest.Category.length <= 30);
  assert.ok(manifest.Description.length <= 300);
  assert.ok(manifest.Detail.length <= 1000);
  for (const action of manifest.Actions) assert.ok(action.Name.length <= 30, action.Name);
});

test('every file the manifest points to exists', () => {
  const paths = [
    manifest.Icon, manifest.CategoryIcon, manifest.CodePath, ...manifest.Banner,
    ...manifest.Actions.flatMap((a) => [a.Icon, a.PropertyInspectorPath, ...a.States.map((s) => s.Image)]),
  ];
  for (const path of paths) assert.ok(existsSync(join(pluginDir, path)), path);
  for (const action of manifest.Actions) {
    for (const state of action.States) assert.ok(existsSync(join(pluginDir, state.Image.replace('.png', '@2x.png'))), `${state.Image} @2x`);
  }
});

test('keys control their own image, are keypad only, and stay out of multi-actions', () => {
  for (const action of manifest.Actions) {
    assert.equal(action.DisableAutomaticStates, true);
    assert.equal(action.SupportedInMultiActions, false);
    assert.deepEqual(action.Controllers, ['Keypad']);
    assert.deepEqual(action.Devices, []);
  }
});

test('Windows only, because the Soundpad remote control is a Windows named pipe', () => {
  assert.deepEqual(manifest.OS.map((os) => os.Platform), ['windows']);
});

test('the debug port never ships, and the version field is the supported one', () => {
  assert.equal(manifest.Inspect, undefined);
  assert.ok(manifest.Software.MinVersion);
  assert.equal(manifest.Software.MinimumVersion, undefined);
});

test('every file agrees on the version, because the release tag must match them all', () => {
  const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(manifest.Version, /^\d+\.\d+\.\d+$/);
  assert.equal(rootPackage.version, manifest.Version);
  assert.equal(JSON.parse(read('package.json')).version, manifest.Version);
});

test('the store text says the plugin is not affiliated with Leppsoft', () => {
  assert.match(manifest.Detail, /not affiliated with Leppsoft/);
  assert.match(manifest.Description, /Not affiliated with Leppsoft/);
});

test('English, Brazilian and European Portuguese are present, and both Portuguese files are the same', () => {
  for (const file of ['en.json', 'pt_BR.json', 'pt_PT.json']) assert.ok(languages.includes(file), file);
  assert.equal(read('pt_BR.json'), read('pt_PT.json'));
});

for (const file of languages) {
  test(`${file}: matches the manifest by position and has every string`, () => {
    const language = JSON.parse(read(file));
    assert.equal(language.Actions.length, manifest.Actions.length);
    for (const action of language.Actions) assert.ok(action.Name.length <= 30, action.Name);
    assert.ok(language.Description.length <= 300);
    assert.deepEqual(Object.keys(language.Localization).sort(), Object.keys(en.Localization).sort());
    for (const [key, value] of Object.entries(language.Localization)) {
      assert.ok(value.trim(), key);
      for (const slot of key.match(/\{\w+\}/g) ?? []) assert.ok(value.includes(slot), `${file} ${key} lost ${slot}`);
      for (const slot of en.Localization[key].match(/\{\w+\}/g) ?? []) assert.ok(value.includes(slot), `${file} ${key} lost ${slot}`);
    }
  });
}

test('the English file repeats the names in the manifest', () => {
  manifest.Actions.forEach((action, i) => assert.equal(en.Actions[i].Name, action.Name));
  assert.equal(en.Name, manifest.Name);
  assert.equal(en.Description, manifest.Description);
});

test('every string marked in the panel, and every one the code asks for, can be translated', () => {
  const keys = new Set();
  for (const match of html.matchAll(/data-localize="([^"]+)"/g)) keys.add(match[1]);
  for (const match of html.matchAll(/data-localize>([^<]+)</g)) keys.add(match[1].trim());
  for (const match of inspectorJs.matchAll(/\bt\('([^']+)'/g)) keys.add(match[1]);
  for (const prefix of ['conn', 'hint', 'sound', 'preview', 'icon']) {
    assert.ok(Object.keys(en.Localization).some((key) => key.startsWith(`${prefix}.`)), prefix);
  }
  const plugin = ['keys/base-key.js', 'keys/sound-key.js', 'keys/slot-key.js', 'keys/nav-key.js', 'keys/control-key.js'].map((file) => read(`plugin/${file}`)).join('\n');
  for (const match of plugin.matchAll(/\bt\('([^']+)'\)/g)) keys.add(match[1]);
  for (const key of keys) assert.ok(en.Localization[key], key);
});

const selectValues = (id) => {
  const block = html.match(new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`))[0];
  return [...block.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
};

test('the panel offers exactly the choices the code accepts', () => {
  assert.deepEqual(selectValues('output'), OUTPUTS);
  assert.deepEqual(selectValues('groupOutput'), OUTPUTS);
  assert.deepEqual(selectValues('controlOutput'), OUTPUTS.filter((output) => output !== 'default'));
  assert.deepEqual(selectValues('mode'), PLAY_MODES);
  assert.deepEqual(selectValues('groupMode'), PLAY_MODES);
  assert.deepEqual(selectValues('accent'), ACCENTS);
  assert.deepEqual(selectValues('controlAccent'), ACCENTS);
  assert.deepEqual(selectValues('background'), BACKGROUNDS);
  assert.deepEqual(selectValues('function'), NAV_FUNCTIONS);
  assert.deepEqual(selectValues('controlAction'), CONTROL_ACTIONS);
  for (const icon of ICONS) assert.ok(existsSync(join(pluginDir, `resources/icons/${icon}.png`)), icon);
});

test('the defaults of the panel are the defaults of the plugin', () => {
  const source = inspectorJs.match(/const DEFAULTS = (\{[\s\S]*?\n\});/)[1];
  // Through JSON, because objects made in another context have another prototype.
  const defaults = JSON.parse(JSON.stringify(vm.runInNewContext(`(${source})`)));
  assert.deepEqual(defaults.sound, normalizeSoundSettings({}));
  assert.deepEqual(defaults.slot, normalizeSlotSettings({}));
  assert.deepEqual(defaults.nav, normalizeNavSettings({}));
  assert.deepEqual(defaults.control, normalizeControlSettings({}));
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(inspectorJs.match(/const ICONS = (\[[^\]]*\]);/)[1]))), ICONS);
});

test('on-off options are checkboxes, as the store guideline asks', () => {
  for (const field of ['feedback', 'showTitle', 'groupPersist', 'slotFeedback']) {
    assert.match(html, new RegExp(`type="checkbox" id="${field}"`), field);
  }
});

test('the panel never builds markup from text', () => {
  assert.doesNotMatch(inspectorJs, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
});

test('the panel has no background of its own, as the store asks, and no copyright line', () => {
  assert.doesNotMatch(read('property-inspector/soundpad/inspector.css'), /body\s*\{[^}]*background/);
  assert.doesNotMatch(html, /©|copyright/i);
});

test('store.json passes the checks of the Community Store, and says the plugin is independent', () => {
  const store = JSON.parse(readFileSync(new URL('../store.json', import.meta.url), 'utf8'));
  const isTextList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
  assert.equal(typeof store.cover, 'string');
  assert.ok(isTextList(store.screenshots));
  assert.ok(isTextList(store.tags));
  for (const image of [store.cover, ...store.screenshots]) assert.ok(existsSync(new URL(`../${image}`, import.meta.url)), image);
  assert.deepEqual(store.deviceTypes, ['deck']);
  assert.match(store.longDescription, /Not affiliated with Leppsoft or Ulanzi/);
  assert.match(store.longDescription, /Sem vínculo com a Leppsoft nem com a Ulanzi/);
  assert.ok(!store.longDescription.includes('**'), 'the store shows this as plain text');
});
