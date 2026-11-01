// Reading the list and categories, and finding a saved sound again after the list changes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoryId, fileId, metaId, normalizeLocation, resolveSound } from '../com.ulanzi.soundpad.ulanziPlugin/plugin/soundpad/identity.js';
import { ALL_SOUNDS, Library, searchText } from '../com.ulanzi.soundpad.ulanziPlugin/plugin/soundpad/library.js';
import { parseXml } from '../com.ulanzi.soundpad.ulanziPlugin/plugin/soundpad/xml.js';
import { SoundpadSimulator, makeSounds } from './support/soundpad-sim.mjs';

/** Builds a Library exactly as the plugin would from the simulator's answers. */
function libraryOf(sim) {
  const list = parseXml(sim.answer('GetSoundlist()'));
  const categories = sim.answer('GetCategories(true, false)');
  return Library.fromXml(list, categories.startsWith('<') ? parseXml(categories) : null, 1000);
}

const refOf = (sound) => ({ id: sound.id, alt: sound.alt, index: sound.index });

test('ids are hashes: no path or name is kept, and one file has one id however it is spelled', () => {
  const id = fileId('C:\\Users\\Ana\\Sounds\\horn.mp3');
  assert.match(id, /^[0-9a-f]{24}$/);
  assert.equal(fileId('c:/users/ana/sounds/HORN.mp3'), id);
  assert.equal(fileId('file:///C:/Users/Ana/Sounds/horn.mp3'), id);
  assert.notEqual(fileId('C:\\Users\\Ana\\Sounds\\horn2.mp3'), id);
  assert.equal(fileId(''), '');
  assert.equal(normalizeLocation('https://example.com/A.mp3'), 'https://example.com/A.mp3');
  assert.equal(metaId({ title: '' }), '');
  assert.equal(metaId({ title: 'Horn', artist: 'X', duration: '0:02' }), metaId({ title: ' horn ', artist: 'x', duration: '0:02' }));
  assert.match(categoryId('Memes'), /^c[0-9a-f]{16}$/);
  assert.notEqual(categoryId('Memes', 1), categoryId('Memes', 2));
});

test('the list keeps Soundpad order and positions, with a title for every sound', () => {
  const sim = new SoundpadSimulator({ sounds: [{ url: 'C:\\s\\no-title.wav' }, ...makeSounds(2)] });
  const library = libraryOf(sim);
  assert.equal(library.count, 3);
  assert.deepEqual(library.sounds.map((sound) => sound.index), [1, 2, 3]);
  assert.equal(library.sounds[0].title, 'no-title', 'a sound with no title is named after its file');
  assert.equal(library.category(ALL_SOUNDS).sounds.length, 3);
});

test('nested categories become one list named by path; hidden ones and their children are left out', () => {
  const sim = new SoundpadSimulator({
    sounds: makeSounds(5),
    categories: [
      { name: 'Memes', sounds: [1, 2], children: [{ name: 'Old', sounds: [3] }] },
      { name: 'Secret', hidden: true, sounds: [4], children: [{ name: 'Inside', sounds: [5] }] },
      { name: 'Empty', sounds: [] },
    ],
  });
  const library = libraryOf(sim);
  assert.deepEqual(library.categories.map((category) => category.name), ['', 'Memes', 'Memes › Old', 'Empty']);
  assert.deepEqual(library.categories[1].sounds.map((sound) => sound.index), [1, 2]);
  assert.equal(library.categories[3].sounds.length, 0, 'an empty category is kept, and shown as empty');
  assert.equal(library.categoriesKnown, true);
});

test('categories that share a name stay apart', () => {
  const sim = new SoundpadSimulator({ sounds: makeSounds(2), categories: [{ name: 'Fun', sounds: [1] }, { name: 'Fun', sounds: [2] }] });
  const [, first, second] = libraryOf(sim).categories;
  assert.notEqual(first.key, second.key);
  assert.equal(second.name, 'Fun (2)');
});

test('an older Soundpad with no categories still gives the whole list', () => {
  const sim = new SoundpadSimulator({ rcVersion: '1.0.0', categories: [{ name: 'Memes', sounds: [1] }] });
  const library = libraryOf(sim);
  assert.equal(library.categoriesKnown, false);
  assert.equal(library.categories.length, 1);
});

test('broken entries are skipped instead of trusted', () => {
  const list = parseXml('<Soundlist><Sound index="0" url="a"/><Sound index="x" url="b"/><Sound index="2" url="c"/><Sound index="2" url="d"/><Sound index="3"/><Note/></Soundlist>');
  const library = Library.fromXml(list, null);
  assert.deepEqual(library.sounds.map((sound) => sound.index), [2]);
  assert.throws(() => Library.fromXml(parseXml('<Other/>'), null), TypeError);
});

test('the revision changes when anything shown changes, and only then', () => {
  const sim = new SoundpadSimulator({ sounds: makeSounds(4), categories: [{ name: 'A', sounds: [1] }] });
  const first = libraryOf(sim).revision;
  assert.equal(libraryOf(sim).revision, first);
  sim.moveSound(1, 3);
  assert.notEqual(libraryOf(sim).revision, first);
});

test('a saved sound is found again after sounds are added before it', () => {
  const sim = new SoundpadSimulator({ sounds: makeSounds(5) });
  const saved = refOf(libraryOf(sim).sounds[2]);
  sim.addSound({ url: 'C:\\new.mp3', title: 'New' }, 0);
  const found = libraryOf(sim).resolve(saved);
  assert.equal(found.status, 'ok');
  assert.equal(found.sound.index, 4);
  assert.equal(found.sound.title, 'Sound 3');
});

test('a saved sound is found again after the list is reordered', () => {
  const sim = new SoundpadSimulator({ sounds: makeSounds(5) });
  const saved = refOf(libraryOf(sim).sounds[0]);
  sim.moveSound(1, 5);
  const found = libraryOf(sim).resolve(saved);
  assert.equal(found.sound.index, 5);
  assert.equal(found.sound.title, 'Sound 1');
});

test('a deleted sound is missing, and its old position is never played instead', () => {
  const sim = new SoundpadSimulator({ sounds: makeSounds(5) });
  const saved = refOf(libraryOf(sim).sounds[1]);
  sim.removeSound(2);
  const found = libraryOf(sim).resolve(saved);
  assert.equal(found.status, 'missing');
});

test('a moved file is found by its title, artist and length, but only when exactly one sound matches', () => {
  const sim = new SoundpadSimulator({ sounds: makeSounds(3) });
  const saved = refOf(libraryOf(sim).sounds[0]);
  sim.sounds[0] = { ...sim.sounds[0], url: 'D:\\Moved\\sound-1.mp3' };
  const found = libraryOf(sim).resolve(saved);
  assert.equal(found.status, 'ok');
  assert.equal(found.relinked, true);
  sim.addSound({ ...sim.sounds[0], url: 'E:\\Copy\\sound-1.mp3' });
  assert.equal(libraryOf(sim).resolve(saved).status, 'ambiguous');
});

test('the same file twice plays the copy the key last saw, or else the first', () => {
  const sound = { url: 'C:\\dup.mp3', title: 'Dup' };
  const sim = new SoundpadSimulator({ sounds: [sound, ...makeSounds(2), sound] });
  const library = libraryOf(sim);
  const id = library.sounds[0].id;
  assert.equal(library.resolve({ id, alt: '', index: 4 }).sound.index, 4);
  assert.equal(library.resolve({ id, alt: '', index: 99 }).sound.index, 1);
});

test('two different sounds with the same title stay apart', () => {
  const sim = new SoundpadSimulator({ sounds: [{ url: 'C:\\a\\horn.mp3', title: 'Horn' }, { url: 'C:\\b\\horn.mp3', title: 'Horn' }] });
  const library = libraryOf(sim);
  const [first, second] = library.sounds;
  assert.notEqual(first.id, second.id);
  assert.equal(library.resolve(refOf(second)).sound.index, 2);
});

test('nothing saved, or nothing to match by, is reported as such', () => {
  const library = libraryOf(new SoundpadSimulator());
  assert.equal(resolveSound(null, library).status, 'unset');
  assert.equal(resolveSound({ id: '', alt: '', index: 1 }, library).status, 'unset');
});

test('searching ignores case and accents', () => {
  assert.equal(searchText('Ação Épica'), 'acao epica');
});

test('hundreds of sounds and categories load quickly', () => {
  const sounds = makeSounds(2000);
  const categories = Array.from({ length: 40 }, (_, c) => ({ name: `Category ${c}`, sounds: Array.from({ length: 50 }, (_, i) => c * 50 + i + 1) }));
  const sim = new SoundpadSimulator({ sounds, categories });
  const start = performance.now();
  const library = libraryOf(sim);
  const elapsed = performance.now() - start;
  assert.equal(library.count, 2000);
  assert.equal(library.categories.length, 41);
  assert.ok(elapsed < 1500, `${elapsed.toFixed(0)} ms`);
});
