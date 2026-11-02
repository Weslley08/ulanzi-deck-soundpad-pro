// A small reader for the XML Soundpad answers with: elements and attributes only. Text between
// elements is ignored, because Soundpad puts everything in attributes. Written here instead of
// adding a dependency, and bounded, because the answer comes from another process.

/** @typedef {{ name: string, attrs: Record<string, string>, children: XmlElement[] }} XmlElement */

export const MAX_XML_LENGTH = 32 * 1024 * 1024;
const MAX_DEPTH = 32;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the five named entities and numeric references. Anything else stays as written. */
export function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,4});/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      // Surrogates and out-of-range code points would throw or produce broken strings.
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code === 0) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

export class XmlError extends Error {
  name = 'XmlError';
}

const NAME = /[A-Za-z_][\w.-]*/y;
const SPACE = /\s*/y;
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

/**
 * @param {string} source
 * @returns {XmlElement} the root element
 */
export function parseXml(source) {
  if (typeof source !== 'string') throw new XmlError('not text');
  if (source.length > MAX_XML_LENGTH) throw new XmlError('answer too large');
  let at = 0;
  /** @type {XmlElement[]} */
  const stack = [];
  /** @type {XmlElement | null} */
  let root = null;

  const skipSpace = () => {
    SPACE.lastIndex = at;
    SPACE.exec(source);
    at = SPACE.lastIndex;
  };

  while (at < source.length) {
    const open = source.indexOf('<', at);
    if (open < 0) break;
    at = open;
    if (source.startsWith('<?', at)) {
      const end = source.indexOf('?>', at);
      if (end < 0) throw new XmlError('unterminated declaration');
      at = end + 2;
      continue;
    }
    if (source.startsWith('<!--', at)) {
      const end = source.indexOf('-->', at);
      if (end < 0) throw new XmlError('unterminated comment');
      at = end + 3;
      continue;
    }
    if (source.startsWith('<!', at)) throw new XmlError('declarations are not accepted');
    if (source.startsWith('</', at)) {
      at += 2;
      NAME.lastIndex = at;
      const match = NAME.exec(source);
      if (!match) throw new XmlError('bad closing tag');
      at = NAME.lastIndex;
      skipSpace();
      if (source[at] !== '>') throw new XmlError('bad closing tag');
      at += 1;
      const element = stack.pop();
      if (!element || element.name !== match[0]) throw new XmlError('mismatched closing tag');
      continue;
    }
    at += 1;
    NAME.lastIndex = at;
    const match = NAME.exec(source);
    if (!match) throw new XmlError('bad tag');
    at = NAME.lastIndex;
    /** @type {XmlElement} */
    const element = { name: match[0], attrs: Object.create(null), children: [] };
    for (;;) {
      skipSpace();
      if (source[at] === '>' || source.startsWith('/>', at)) break;
      ATTRIBUTE.lastIndex = at;
      const attribute = ATTRIBUTE.exec(source);
      if (!attribute) throw new XmlError('bad attribute');
      at = ATTRIBUTE.lastIndex;
      element.attrs[attribute[1]] = decodeEntities(attribute[3] ?? attribute[4] ?? '');
    }
    const selfClosing = source[at] === '/';
    at += selfClosing ? 2 : 1;
    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else if (root) throw new XmlError('more than one root element');
    else root = element;
    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) throw new XmlError('nested too deep');
      stack.push(element);
    }
  }
  if (stack.length) throw new XmlError('unterminated element');
  if (!root) throw new XmlError('no element');
  return root;
}

/** True once a streamed answer holds a whole document, so the reader knows when to stop waiting. */
export function isCompleteDocument(text) {
  const trimmed = text.trimEnd();
  const rootMatch = /^(?:\s*<\?[\s\S]*?\?>)?\s*<([A-Za-z_][\w.-]*)/.exec(trimmed);
  if (!rootMatch) return false;
  const rootName = rootMatch[1];
  const firstClose = trimmed.indexOf('>', rootMatch[0].length);
  if (firstClose > 0 && trimmed[firstClose - 1] === '/' && firstClose === trimmed.length - 1) return true;
  return trimmed.endsWith(`</${rootName}>`);
}
