// Solid symbols on a 24x24 grid, drawn by hand for this plugin. Each is a list of parts: filled
// shapes, strokes, and knockouts painted in the background color to cut details out of a shape.

const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** @typedef {{ fill?: string, stroke?: string, knock?: string, width?: number }} Part */

/** @type {Record<string, Part[]>} */
export const SYMBOLS = {
  play: [{ fill: 'M8 5.6v12.8a1 1 0 0 0 1.5.86l10.6-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6Z' }],
  stop: [{ fill: 'M7.5 5.5h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z' }],
  pause: [{ fill: 'M6.5 5h3.5v14H6.5ZM14 5h3.5v14H14Z' }],
  next: [{ fill: 'M5 5.8v12.4a.8.8 0 0 0 1.25.66L15 12.66a.8.8 0 0 0 0-1.32L6.25 5.14A.8.8 0 0 0 5 5.8ZM16 5h3v14h-3Z' }],
  previous: [{ fill: 'M19 5.8v12.4a.8.8 0 0 1-1.25.66L9 12.66a.8.8 0 0 1 0-1.32l8.75-6.2A.8.8 0 0 1 19 5.8ZM5 5h3v14H5Z' }],
  random: [{ stroke: 'M3 7.5h3c4.5 0 6.5 9 11 9h3.5M3 16.5h3c1.7 0 2.9-1.3 4-3M13.6 9.6c1-1.3 2.1-2.1 3.4-2.1h3.5M18 4.5l3 3-3 3M18 13.5l3 3-3 3', width: 2.4 }],
  replay: [{ stroke: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.5H9', width: 2.6 }],
  volumeUp: [{ fill: 'M3 9h3.5L11 5v14l-4.5-4H3Z' }, { stroke: 'M14.5 12h7M18 8.5v7', width: 2.6 }],
  volumeDown: [{ fill: 'M3 9h3.5L11 5v14l-4.5-4H3Z' }, { stroke: 'M14.5 12h7', width: 2.6 }],
  mute: [{ fill: 'M3 9h3.5L11 5v14l-4.5-4H3Z' }, { stroke: 'M15 9l6 6M21 9l-6 6', width: 2.6 }],
  speaker: [{ fill: 'M3 9h3.5L11 5v14l-4.5-4H3Z' }, { stroke: 'M14.5 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11', width: 2.2 }],
  note: [{ stroke: 'M9.5 17V5.5l10-2v11', width: 2.4 }, { fill: circle(7, 17.5, 3) }, { fill: circle(17, 15, 3) }],
  horn: [{ fill: 'M3 10h3.5l9-5.5v15l-9-5.5H3Z' }, { stroke: 'M18.5 9a4.5 4.5 0 0 1 0 6', width: 2.4 }, { fill: 'M7 14.5h3l1 5H8Z' }],
  laugh: [{ fill: circle(12, 12, 9.5) }, { knock: `${circle(8.8, 9.5, 1.4)}${circle(15.2, 9.5, 1.4)}` }, { knock: 'M7 13h10a5 5 0 0 1-10 0Z' }],
  bell: [{ fill: 'M12 3a6 6 0 0 0-6 6v4.2L4 16.5h16L18 13.2V9a6 6 0 0 0-6-6ZM9.5 18h5a2.5 2.5 0 0 1-5 0Z' }],
  mic: [{ fill: 'M9 5.5a3 3 0 0 1 6 0v5.5a3 3 0 0 1-6 0Z' }, { stroke: 'M6 11a6 6 0 0 0 12 0M12 17v3.5M8.5 21h7', width: 2.2 }],
  micOff: [{ fill: 'M9 5.5a3 3 0 0 1 6 0v5.5a3 3 0 0 1-6 0Z' }, { stroke: 'M6 11a6 6 0 0 0 12 0M12 17v3.5M8.5 21h7M3.5 3.5l17 17', width: 2.2 }],
  star: [{ fill: 'M12 2.8l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L3 9.4l6.2-.9Z' }],
  heart: [{ fill: 'M12 20.5S3.5 15.4 3.5 9.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.5 2.4c0 6-8.5 11.1-8.5 11.1Z' }],
  bolt: [{ fill: 'M13.5 2 5 13.5h6L10 22l9-12h-6.2Z' }],
  fire: [{ fill: 'M12 2.5c.6 3.6 6 5.6 6 11.2a6 6 0 0 1-12 0c0-2.6 1.2-4.4 2.7-5.6.1 2 .9 3.2 2.3 3.9-.3-4 .4-6.8 1-9.5Z' }],
  folder: [{ fill: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h5.2l2 2.2h7.8A1.5 1.5 0 0 1 21 8.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z' }],
  all: [{ fill: 'M4 5h4v4H4ZM10 5h4v4h-4ZM16 5h4v4h-4ZM4 11h4v4H4ZM10 11h4v4h-4ZM16 11h4v4h-4ZM4 17h4v4H4ZM10 17h4v4h-4ZM16 17h4v4h-4Z' }],
  pageNext: [{ stroke: 'M9 4.5l7.5 7.5L9 19.5', width: 3.2 }],
  pagePrevious: [{ stroke: 'M15 4.5L7.5 12l7.5 7.5', width: 3.2 }],
  categoryNext: [{ stroke: 'M5 5l7 7-7 7M12 5l7 7-7 7', width: 2.8 }],
  categoryPrevious: [{ stroke: 'M19 5l-7 7 7 7M12 5l-7 7 7 7', width: 2.8 }],
  back: [{ stroke: 'M9.5 5 4 10.5 9.5 16M4 10.5h10a6 6 0 0 1 6 6V19', width: 2.6 }],
  refresh: [{ stroke: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15', width: 2.6 }],
  warning: [{ fill: 'M12 3 22 20.5H2Z' }, { knock: 'M11 9h2v6h-2ZM11 16.5h2v2h-2Z' }],
  offline: [{ fill: 'M8 2.5h2v4H8ZM14 2.5h2v4h-2ZM6 7.5h12v3a6 6 0 0 1-12 0ZM11 15.5h2V21h-2Z' }, { stroke: 'M3.5 3.5l17 17', width: 2.6 }],
  blank: [],
  unavailable: [{ stroke: `${circle(12, 12, 8.5)}M6 6l12 12`, width: 2.6 }],
  playing: [{ fill: 'M4 10h3.2v10H4ZM10.4 4h3.2v16h-3.2ZM16.8 13h3.2v7h-3.2Z' }],
  dots: [{ fill: `${circle(5, 12, 2.2)}${circle(12, 12, 2.2)}${circle(19, 12, 2.2)}` }],
};

/**
 * @param {string} name
 * @param {number} x left edge
 * @param {number} y top edge
 * @param {number} size
 * @param {string} color
 * @param {string} background for knockouts
 */
export function symbol(name, x, y, size, color, background) {
  const parts = Object.hasOwn(SYMBOLS, name) ? SYMBOLS[name] : SYMBOLS.play;
  const body = parts.map((part) => {
    if (part.fill) return `<path d="${part.fill}" fill="${color}"/>`;
    if (part.knock) return `<path d="${part.knock}" fill="${background}"/>`;
    return `<path d="${part.stroke}" fill="none" stroke="${color}" stroke-width="${part.width ?? 2.4}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<g transform="translate(${x} ${y}) scale(${size / 24})">${body}</g>`;
}
