// The SDK writes every message to the console, including settings and sound names.
for (const method of ['log', 'info', 'debug', 'warn', 'error']) console[method] = () => {};

// Kept in step with plugin/settings.js by test/manifest.test.mjs.
const DEFAULTS = {
  sound: { soundId: '', soundAlt: '', soundIndex: 0, soundTitle: '', label: '', icon: 'play', accent: 'white', output: 'both', mode: 'pause', feedback: true, background: 'black', showTitle: true },
  slot: { group: 'A', position: 1, feedback: true, background: 'black', showTitle: true },
  nav: { group: 'A', function: 'nextPage', background: 'black' },
  control: { action: 'stop', output: 'both', accent: 'white', background: 'black', showTitle: true },
};
const ICONS = ['play', 'note', 'horn', 'laugh', 'bell', 'mic', 'star', 'heart', 'bolt', 'fire', 'none'];
const SEARCH_DELAY_MS = 250;
const SAVE_DELAY_MS = 300;
const VOLUME_ACTIONS = ['volumeUp', 'volumeDown', 'mute'];

const $ = (selector) => document.querySelector(selector);
const form = $('#property-inspector');
const groupSection = $('#groupOptions');

let action = 'sound';
let settings = { ...DEFAULTS.sound };
let lastStatus = { state: 'connecting' };
let library = { ready: false, categories: [] };
let searchSeq = 0;

$UD.connect();
// The UUID comes from the query string, so the action is known before any message.
action = actionOf($UD.uuid);
settings = { ...DEFAULTS[action] };

const t = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, value), $UD.t(key));

/** The action this panel belongs to, from the last part of its UUID. */
function actionOf(uuid) {
  const last = String(uuid ?? '').split('.').pop();
  return Object.hasOwn(DEFAULTS, last) ? last : 'sound';
}

/** The fields of this action: the ones in its own section, plus the shared appearance ones. */
function fields() {
  const own = [...form.querySelectorAll(`section[data-action="${action}"] [data-field]`)];
  const shared = [...form.querySelectorAll('#appearance [data-field]')].filter((el) => el.dataset.field in DEFAULTS[action]);
  return [...own, ...shared];
}

function readField(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return Number.parseInt(el.value, 10) || 0;
  return el.value;
}

function writeField(el, value) {
  if (el.type === 'checkbox') el.checked = value === true || value === 'true' || value === 'on';
  else el.value = value ?? '';
}

const saveSettings = Utils.debounce(() => {
  for (const el of fields()) settings[el.dataset.field] = readField(el);
  if (action === 'sound') settings.icon = form.querySelector('[name=icon]:checked')?.value ?? settings.icon;
  $UD.sendParamFromPlugin({ ...settings });
  syncVisibility();
}, SAVE_DELAY_MS);

function loadSettings(jsn) {
  if (!jsn?.param) return;
  settings = { ...DEFAULTS[action], ...jsn.param };
  fillForm();
}

function fillForm() {
  for (const el of fields()) {
    if (document.activeElement !== el) writeField(el, settings[el.dataset.field]);
  }
  const icon = form.querySelector(`[name=icon][value="${CSS.escape(String(settings.icon))}"]`);
  if (icon) icon.checked = true;
  showChosen();
  syncVisibility();
}

function syncVisibility() {
  for (const section of form.querySelectorAll('section[data-action]')) section.classList.toggle('hidden', section.dataset.action !== action);
  $('#showTitleRow').classList.toggle('hidden', !('showTitle' in DEFAULTS[action]));
  groupSection.classList.toggle('hidden', action !== 'slot' && action !== 'nav');
  if (action === 'control') {
    const value = $('#controlAction').value;
    $('#controlOutputRow').classList.toggle('hidden', value !== 'random');
    $('#volumeNote').classList.toggle('hidden', !VOLUME_ACTIONS.includes(value));
  }
}

// --- connection ---

const TONES = { connected: 'success', connecting: 'info', offline: 'error', incompatible: 'error', disabled: 'info' };

function hintFor({ state, lastError, trial }) {
  if (state === 'incompatible') return t('hint.incompatible');
  if (state === 'connected') return trial ? t('hint.trial') : '';
  const known = ['not-running', 'denied', 'pipe-busy', 'timeout', 'closed', 'unexpected'];
  if (known.includes(lastError)) return t(`hint.${lastError}`);
  if (String(lastError ?? '').startsWith('rejected-')) return t('hint.rejected', { code: lastError.slice(9) });
  return state === 'offline' ? t('hint.not-running') : '';
}

function showConnection(status) {
  const line = $('#connection');
  const text = t(`conn.${status.state}`, { version: status.version ?? '' });
  // Everything here comes from the plugin, and through it from Soundpad: textContent keeps it as text.
  line.textContent = status.state === 'connected' && status.sounds !== null
    ? `${text} · ${t('conn.sounds', { count: status.sounds })}`
    : text;
  line.className = `tip ${TONES[status.state] ?? 'info'}`;
  $('#connectionHint').textContent = hintFor(status);

  const rows = [
    ['diag.rc', status.rcVersion ?? '—'],
    ['diag.version', status.version ?? '—'],
    ['diag.sounds', status.sounds ?? '—'],
    ['diag.categories', status.categoriesSupported === false ? t('diag.notSupported') : status.categories ?? '—'],
    ['diag.age', status.libraryAgeMs === null || status.libraryAgeMs === undefined ? '—' : t('diag.seconds', { n: Math.round(status.libraryAgeMs / 1000) })],
    ['diag.playback', status.playStatus ?? '—'],
    ['diag.attempts', status.attempts ?? 0],
    ['diag.error', status.lastError ?? '—'],
  ];
  $('#diagnosticList').replaceChildren(...rows.flatMap(([key, value]) => [
    Object.assign(document.createElement('dt'), { textContent: t(key) }),
    Object.assign(document.createElement('dd'), { textContent: String(value) }),
  ]));
}

// --- library and search (favorites) ---

function categoryLabel(category) {
  if (category.key === 'all') return t('All sounds');
  return `${'  '.repeat(category.depth)}${category.name}`;
}

function fillCategories(select, keep, withNone) {
  const options = library.categories.map((category) => {
    const option = document.createElement('option');
    option.value = category.key;
    option.textContent = `${categoryLabel(category)} (${category.count})`;
    return option;
  });
  if (withNone) options.unshift(Object.assign(document.createElement('option'), { value: '', textContent: t('Category list') }));
  select.replaceChildren(...options);
  select.value = [...select.options].some((option) => option.value === keep) ? keep : select.options[0]?.value ?? '';
}

function showLibrary(message) {
  library = message;
  if (!message.ready) {
    $('#resultInfo').textContent = t('library.waiting');
    return;
  }
  fillCategories($('#category'), $('#category').value || 'all', false);
  fillCategories($('#groupStartCategory'), $('#groupStartCategory').value, true);
  if (action === 'sound') requestSearch();
}

const requestSearch = () => {
  searchSeq += 1;
  $UD.sendToPlugin({ type: 'search', q: $('#search').value.trim(), category: $('#category').value || 'all' });
};
const requestSearchSoon = Utils.debounce(requestSearch, SEARCH_DELAY_MS);

function soundRow(item) {
  const row = Object.assign(document.createElement('div'), { className: 'result' });
  row.classList.toggle('selected', Boolean(item.id && item.id === settings.soundId) || (!item.id && item.alt === settings.soundAlt));
  const pick = Object.assign(document.createElement('button'), { type: 'button', className: 'pick' });
  // Sound names come from the user's files: textContent keeps them from being read as markup.
  pick.append(
    Object.assign(document.createElement('span'), { className: 'result-title', textContent: item.title }),
    Object.assign(document.createElement('span'), {
      className: 'result-meta',
      textContent: [item.artist, item.duration, item.duplicate ? `#${item.index}` : ''].filter(Boolean).join(' · '),
    }),
  );
  pick.addEventListener('click', () => choose(item));
  const preview = Object.assign(document.createElement('button'), { type: 'button', className: 'preview', textContent: '▶', title: t('Preview on speakers') });
  preview.addEventListener('click', () => $UD.sendToPlugin({ type: 'preview', id: item.id, alt: item.alt, index: item.index }));
  row.append(pick, preview);
  return row;
}

function showResults(message) {
  // A slow reply must not replace the results of a newer search.
  if (message.q !== $('#search').value.trim() || message.category !== ($('#category').value || 'all')) return;
  const info = $('#resultInfo');
  if (!message.ready) {
    info.textContent = t('library.waiting');
    $('#results').replaceChildren();
    return;
  }
  info.className = 'tip info';
  info.textContent = message.total === 0
    ? t(message.q ? 'results.none' : 'results.emptyCategory')
    : message.total > message.items.length
      ? t('results.some', { shown: message.items.length, total: message.total })
      : t('results.all', { total: message.total });
  $('#results').replaceChildren(...message.items.map(soundRow));
}

function choose(item) {
  Object.assign(settings, { soundId: item.id, soundAlt: item.alt, soundIndex: item.index, soundTitle: item.title });
  showChosen();
  for (const row of $('#results').children) row.classList.remove('selected');
  saveSettings();
  requestSearch();
}

function showChosen() {
  $('#chosen').textContent = settings.soundTitle || t('None chosen');
}

const SOUND_STATES = { ok: 'success', missing: 'error', ambiguous: 'warn', unset: 'info', loading: 'info' };

function showSoundState(status) {
  const line = $('#soundState');
  const state = status.relinked ? 'relinked' : status.sound;
  line.textContent = t(`sound.${state}`);
  line.className = `tip ${status.relinked ? 'warn' : SOUND_STATES[status.sound] ?? 'info'}`;
}

// --- navigator groups ---

function showGroup(status) {
  const where = status.mode === 'sounds' ? status.categoryName || t('All sounds') : t('Category list');
  $('#groupState').textContent = t('group.state', { page: status.page ?? 1, pages: status.pages ?? 1, where, keys: status.positionsOnDeck ?? 0 });
  if (groupSection.contains(document.activeElement) || !status.options) return;
  for (const el of groupSection.querySelectorAll('[data-option]')) writeField(el, status.options[el.dataset.option]);
}

const saveGroupOptions = Utils.debounce(() => {
  const options = {};
  for (const el of groupSection.querySelectorAll('[data-option]')) options[el.dataset.option] = readField(el);
  $UD.sendToPlugin({ type: 'groupOptions', group: settings.group, options });
}, SAVE_DELAY_MS);

// --- wiring ---

/** Everything a status message shows. Run again once the language file arrives. */
function showStatus(status) {
  showConnection(status);
  if (status.kind === 'sound') showSoundState(status);
  if (status.kind === 'slot' || status.kind === 'nav') showGroup(status);
}

function whenLocalized(fn, tries = 40) {
  if ($UD.localization || tries <= 0) {
    fn();
    return;
  }
  setTimeout(() => whenLocalized(fn, tries - 1), 50);
}

function buildIconGrid() {
  $('#iconGrid').replaceChildren(...ICONS.map((icon) => {
    const label = Object.assign(document.createElement('label'), { className: 'icon-choice', title: t(`icon.${icon}`) });
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'icon', value: icon });
    const img = Object.assign(document.createElement('img'), { src: `../../resources/icons/${icon}.png`, alt: '' });
    label.append(input, img);
    return label;
  }));
}

$UD.onConnected(() => {
  document.querySelector('.uspi-wrapper').classList.remove('hidden');
  $UD.sendToPlugin({ type: 'hello' });

  // onConnected can fire more than once.
  if (form.dataset.bound) return;
  form.dataset.bound = 'true';
  buildIconGrid();
  fillForm();
  // The SDK loads the language file without waiting, so text written before it arrives is redone.
  whenLocalized(() => {
    showChosen();
    showStatus(lastStatus);
    if (library.ready) {
      fillCategories($('#category'), $('#category').value || 'all', false);
      fillCategories($('#groupStartCategory'), $('#groupStartCategory').value, true);
    } else {
      $('#resultInfo').textContent = t('library.waiting');
    }
  });

  form.addEventListener('input', (event) => {
    if (event.target.id === 'search' || event.target.id === 'category') return;
    saveSettings();
  });
  form.addEventListener('change', (event) => {
    if (event.target.id === 'category') requestSearch();
    else if (event.target.id !== 'search') saveSettings();
  });
  $('#search').addEventListener('input', requestSearchSoon);
  groupSection.addEventListener('input', saveGroupOptions);
  groupSection.addEventListener('change', saveGroupOptions);
  $('#reconnect').addEventListener('click', () => $UD.sendToPlugin({ type: 'reconnect' }));
  $('#refresh').addEventListener('click', () => $UD.sendToPlugin({ type: 'refresh' }));
});

$UD.onAdd(loadSettings);
$UD.onParamFromApp(loadSettings);
$UD.onParamFromPlugin(loadSettings);

$UD.onSendToPropertyInspector((jsn) => {
  const message = jsn.payload;
  switch (message?.type) {
    case 'status':
      lastStatus = message;
      showStatus(message);
      break;
    case 'library':
      showLibrary(message);
      break;
    case 'sounds':
      showResults(message);
      break;
    case 'preview':
      if (message.result !== 'played') $('#resultInfo').textContent = t(`preview.${message.result}`);
      break;
    case 'about':
      $('#version').textContent = `Soundpad Controller v${String(message.version ?? '')}`;
      break;
    default:
  }
});

showConnection(lastStatus);
