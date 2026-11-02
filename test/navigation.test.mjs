// Navigator groups, without Soundpad: pages, categories, back, several groups, persistence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GroupNavigator, NavigationRegistry } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/navigation.js';
import { Library } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/library.js';
import { parseXml } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/xml.js';
import { SoundpadSimulator, makeSounds } from './support/soundpad-sim.mjs';

function libraryOf(sim) {
  return Library.fromXml(parseXml(sim.answer('GetSoundlist()')), parseXml(sim.answer('GetCategories(true, false)')));
}

const defaultSim = () => new SoundpadSimulator({
  sounds: makeSounds(20),
  categories: [
    { name: 'Memes', sounds: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { name: 'Games', sounds: [10, 11] },
    { name: 'Empty', sounds: [] },
  ],
});

function setup({ sim = defaultSim(), positions = 4 } = {}) {
  let library = libraryOf(sim);
  const changes = [];
  const saved = [];
  const navigator = new GroupNavigator('A', {
    library: () => library,
    onChange: () => changes.push(navigator.state),
    saveState: (id, state) => saved.push([id, state]),
  });
  for (let i = 1; i <= positions; i += 1) navigator.joinSlot(`slot${i}`, i);
  navigator.configure({}, null);
  return { navigator, sim, changes, saved, reload: () => { library = libraryOf(sim); navigator.libraryChanged(); }, setLibrary: (next) => { library = next; } };
}

const titles = (navigator, count = navigator.pageSize) => Array.from({ length: count }, (_, i) => {
  const item = navigator.itemAt(i + 1);
  if (item.kind === 'sound') return item.sound.title;
  if (item.kind === 'category') return item.category.name || '(all)';
  return `<${item.reason}>`;
});

test('a group starts on the category list, with the whole list first', () => {
  const { navigator } = setup();
  assert.deepEqual(titles(navigator), ['(all)', 'Memes', 'Games', 'Empty']);
  assert.equal(navigator.pageCount, 1);
  assert.equal(navigator.pageSize, 4);
});

test('opening a category lists its sounds a page at a time, wrapping at the ends', () => {
  const { navigator } = setup();
  navigator.openCategory(navigator.itemAt(2).category.key);
  assert.deepEqual(titles(navigator), ['Sound 1', 'Sound 2', 'Sound 3', 'Sound 4']);
  assert.equal(navigator.pageCount, 3);
  navigator.press('nextPage');
  navigator.press('nextPage');
  assert.deepEqual(titles(navigator), ['Sound 9', '<end>', '<end>', '<end>']);
  navigator.press('nextPage');
  assert.equal(navigator.state.page, 0, 'wraps to the first page');
  navigator.press('previousPage');
  assert.equal(navigator.state.page, 2, 'and back to the last');
});

test('next and previous category move through every category, wrapping', () => {
  const { navigator } = setup();
  navigator.press('nextCategory');
  assert.equal(navigator.category.name, '', 'from the list, the first press opens the first category');
  navigator.press('nextCategory');
  assert.equal(navigator.category.name, 'Memes');
  navigator.press('previousCategory');
  navigator.press('previousCategory');
  assert.equal(navigator.category.name, 'Empty');
});

test('back returns to the page of the category list that holds the category', () => {
  const sim = new SoundpadSimulator({ sounds: makeSounds(3), categories: Array.from({ length: 9 }, (_, i) => ({ name: `C${i}`, sounds: [1] })) });
  const { navigator } = setup({ sim, positions: 4 });
  navigator.press('nextPage');
  navigator.openCategory(navigator.itemAt(3).category.key);
  assert.equal(navigator.category.name, 'C5');
  assert.ok(navigator.press('back'));
  assert.equal(navigator.state.mode, 'categories');
  assert.equal(navigator.state.page, 1);
  assert.equal(navigator.press('back'), false, 'nothing to go back to');
});

test('an empty category says so on its first position', () => {
  const { navigator } = setup();
  navigator.openCategory(navigator.itemAt(4).category.key);
  assert.deepEqual(titles(navigator), ['<emptyCategory>', '<end>', '<end>', '<end>']);
  assert.equal(navigator.canPress('nextPage'), false);
});

test('a page never shows more than the group has positions, and 0 counts the keys on the deck', () => {
  const { navigator } = setup({ positions: 3 });
  assert.equal(navigator.pageSize, 3);
  navigator.configure({ positions: 2 }, null);
  assert.equal(navigator.pageSize, 2);
  assert.equal(navigator.itemAt(3).kind, 'empty');
  navigator.configure({ positions: 0 }, null);
  assert.equal(navigator.pageSize, 3);
});

test('positions are counted from the keys that joined, and leaving one shrinks the page', () => {
  const { navigator } = setup({ positions: 4 });
  navigator.openCategory(navigator.itemAt(2).category.key);
  navigator.press('nextPage');
  navigator.press('nextPage');
  navigator.leave('slot4');
  navigator.leave('slot3');
  assert.equal(navigator.pageSize, 2);
  assert.ok(navigator.state.page <= navigator.pageCount - 1);
});

test('the starting category and page come from the options', () => {
  const { navigator } = setup();
  const games = navigator.itemAt(3).category.key;
  const fresh = new GroupNavigator('B', { library: navigator.library, onChange: () => {}, saveState: () => {} });
  for (let i = 1; i <= 1; i += 1) fresh.joinSlot(`b${i}`, i);
  fresh.configure({ startCategory: games, startPage: 2 }, null);
  assert.equal(fresh.category.name, 'Games');
  assert.equal(fresh.state.page, 1);
  assert.deepEqual(titles(fresh, 1), ['Sound 11']);
});

test('the saved place wins over the start options when remembering is on, and is ignored when off', () => {
  const { navigator } = setup();
  const memes = navigator.itemAt(2).category.key;
  const games = navigator.itemAt(3).category.key;
  navigator.configure({ startCategory: games, persist: true }, { mode: 'sounds', category: memes, page: 1 });
  // Already moved this session? No: configure before any move takes the saved place.
  const fresh = new GroupNavigator('C', { library: navigator.library, onChange: () => {}, saveState: () => {} });
  fresh.joinSlot('c1', 1);
  fresh.configure({ startCategory: games, persist: true }, { mode: 'sounds', category: memes, page: 1 });
  assert.equal(fresh.category.name, 'Memes');
  assert.equal(fresh.state.page, 1);
  const forgetful = new GroupNavigator('D', { library: navigator.library, onChange: () => {}, saveState: () => {} });
  forgetful.joinSlot('d1', 1);
  forgetful.configure({ startCategory: games, persist: false }, { mode: 'sounds', category: memes, page: 1 });
  assert.equal(forgetful.category.name, 'Games');
});

test('every move is saved when remembering is on, and nothing is saved when off', () => {
  const { navigator, saved } = setup();
  navigator.press('nextCategory');
  assert.deepEqual(saved.at(-1)[0], 'A');
  assert.equal(saved.at(-1)[1].mode, 'sounds');
  navigator.configure({ persist: false }, null);
  assert.deepEqual(saved.at(-1), ['A', null], 'turning it off forgets the saved place');
  const count = saved.length;
  navigator.press('nextCategory');
  assert.equal(saved.length, count);
});

test('a place saved before the library changed is fixed instead of trusted', () => {
  const { navigator, sim, reload } = setup();
  navigator.openCategory(navigator.itemAt(2).category.key);
  navigator.press('previousPage');
  assert.equal(navigator.state.page, 2);
  for (let i = 0; i < 6; i += 1) sim.removeSound(1);
  reload();
  assert.ok(navigator.state.page < navigator.pageCount);
  sim.categories.splice(0, 1);
  reload();
  assert.equal(navigator.state.mode, 'categories', 'a category that is gone sends the group back to the list');
});

test('a deleted sound disappears from its page instead of being replaced by another in place', () => {
  const { navigator, sim, reload } = setup();
  navigator.openCategory(navigator.itemAt(2).category.key);
  sim.removeSound(2);
  reload();
  assert.deepEqual(titles(navigator), ['Sound 1', 'Sound 3', 'Sound 4', 'Sound 5']);
});

test('two sounds with the same name both show, one per position', () => {
  const sim = new SoundpadSimulator({ sounds: [{ url: 'C:\\a\\x.mp3', title: 'Same' }, { url: 'C:\\b\\x.mp3', title: 'Same' }] });
  const { navigator } = setup({ sim });
  navigator.openCategory('all');
  const [first, second] = [navigator.itemAt(1), navigator.itemAt(2)];
  assert.equal(first.sound.title, second.sound.title);
  assert.notEqual(first.sound.id, second.sound.id);
});

test('without a library every position waits and no button moves', () => {
  const { navigator, setLibrary } = setup();
  setLibrary(null);
  assert.deepEqual(navigator.itemAt(1), { kind: 'empty', reason: 'noLibrary' });
  assert.equal(navigator.press('nextPage'), false);
  assert.equal(navigator.canPress('back'), false);
  assert.equal(navigator.pageCount, 1);
});

test('the registry keeps groups apart, and drops a group with its last key', () => {
  const sim = defaultSim();
  const library = libraryOf(sim);
  const moved = [];
  const registry = new NavigationRegistry({ library: () => library, onChange: (navigator) => moved.push(navigator.id), saveState: () => {} });
  const a = registry.join('A');
  const b = registry.join('B');
  a.joinSlot('a1', 1);
  b.joinSlot('b1', 1);
  b.joinControl('b2');
  moved.length = 0;
  a.press('nextCategory');
  assert.deepEqual(moved, ['A']);
  assert.equal(b.state.mode, 'categories');
  registry.applyGlobal({ groups: { B: { positions: 1 } }, nav: {} });
  assert.equal(b.options.positions, 1);
  registry.leave('B', 'b1');
  assert.equal(registry.size, 2);
  registry.leave('B', 'b2');
  assert.equal(registry.size, 1);
  assert.equal(registry.get('B'), null);
  registry.leave('nope', 'x');
});

test('hundreds of sounds page quickly', () => {
  const sim = new SoundpadSimulator({ sounds: makeSounds(1000), categories: [{ name: 'Big', sounds: Array.from({ length: 900 }, (_, i) => i + 1) }] });
  const { navigator } = setup({ sim, positions: 13 });
  navigator.openCategory(navigator.itemAt(2).category.key);
  const start = performance.now();
  for (let i = 0; i < 500; i += 1) {
    navigator.press('nextPage');
    for (let p = 1; p <= 13; p += 1) navigator.itemAt(p);
  }
  assert.ok(performance.now() - start < 500, `${(performance.now() - start).toFixed(0)} ms`);
  assert.equal(navigator.pageCount, 70);
});
