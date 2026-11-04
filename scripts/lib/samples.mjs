// Made-up faces used for previews, store art and tests. Nothing here comes from Soundpad.
export const SAMPLE_FACES = [
  { background: 'black', state: 'ready', symbol: 'horn', title: 'Air horn' },
  { background: 'black', state: 'playing', symbol: 'laugh', title: 'Risada épica' },
  { background: 'black', state: 'paused', symbol: 'note', title: 'Intro' },
  { background: 'black', state: 'error', symbol: 'offline', title: 'Soundpad closed' },
  { background: 'black', state: 'unavailable', symbol: 'bell', title: 'Sound not found' },
  { background: 'black', state: 'ready', symbol: 'blank', title: 'Risada maligna do vilão' },
  { background: 'black', state: 'ready', symbol: 'note', title: 'Bruh' },
  { background: 'black', state: 'playing', symbol: 'note', title: 'Drum roll' },
  { background: 'black', state: 'ready', symbol: 'horn', title: 'Buzina do caminhão' },
  { background: 'black', state: 'paused', symbol: 'blank', title: 'Pausado agora', accent: 'cyan', progress: 30 },
  { background: 'black', state: 'ready', symbol: 'blank', title: 'Aplausos' },
  { background: 'black', state: 'playing', symbol: 'play', title: 'Tocando', progress: 20 },
  { background: 'black', state: 'playing', symbol: 'stop' },
  { background: 'black', state: 'ready', symbol: 'pause' },
  { background: 'black', state: 'ready', symbol: 'random', accent: 'violet' },
  { background: 'black', state: 'ready', symbol: 'volumeUp', accent: 'cyan', badge: '70%' },
  { background: 'graphite', state: 'ready', symbol: 'star', accent: 'orange', title: 'Victory' },
  { background: 'graphite', state: 'ready', symbol: 'heart', accent: 'pink' },
];

/** Faces that test every symbol, state and length the keys can show. */
export const STRESS_TITLES = [
  '',
  'A',
  'Ação Épica Ñandú Ærø',
  'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch',
  'one two three four five six seven eight nine ten eleven twelve',
  '日本語のタイトル',
  '"/><image href="http://evil.example/x.png"/><script>alert(1)</script>',
];
