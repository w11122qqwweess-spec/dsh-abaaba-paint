/**
 * Pure vector canvas engine for dsh-abaaba-paint.
 *
 * The engine deliberately accepts a small, closed vocabulary of SVG primitives
 * and rejects everything else. All strings that reach the exported SVG are
 * escaped; colors are hex/none/transparent or references to a gradient that
 * this engine itself created.
 */

export const CANVAS_MIN = 64;
export const CANVAS_MAX = 4096;
export const MAX_ELEMENTS = 3000;
export const MAX_ELEMENTS_PER_CALL = 256;
export const MAX_HISTORY = 50;
export const MAX_TEXT = 500;
export const MAX_PATH = 4000;
export const MAX_TITLE = 80;
export const MAX_EXPORT_BYTES = 5 * 1024 * 1024;
export const MAX_STATE_BYTES = 2 * 1024 * 1024;
export const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
export const MAX_STATE_FILE_BYTES = 3 * 1024 * 1024;
export const STATE_FORMAT = 'dsh-abaaba-paint';
export const STATE_VERSION = 1;

const ELEMENT_TYPES = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'text',
  'gradient',
]);

const COMMON_KEYS = new Set([
  'type',
  'opacity',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeLinecap',
  'strokeLinejoin',
]);

const SHAPE_KEYS = {
  rect: new Set(['x', 'y', 'w', 'h', 'rx']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  path: new Set(['d']),
  polygon: new Set(['points']),
  text: new Set(['x', 'y', 'text', 'size', 'anchor', 'weight', 'font', 'letterSpacing']),
  gradient: new Set(['id', 'kind', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'stops']),
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const URL_REF = /^url\(#([A-Za-z][A-Za-z0-9_-]{0,63})\)$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PATH_CHARS = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/;
const POINTS_CHARS = /^[-+0-9eE.,\s]+$/;
const FONT_FAMILIES = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "Inter, 'Segoe UI', Arial, sans-serif",
  mono: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
};

export class PaintError extends Error {
  constructor(message, code = 'PAINT_INVALID') {
    super(message);
    this.name = 'PaintError';
    this.code = code;
  }
}

function fail(message) {
  throw new PaintError(message);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function number(value, name, { min = -10000, max = 10000, fallback, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${name} is required`);
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be a finite number`);
  if (value < min || value > max) fail(`${name} must be between ${min} and ${max}`);
  return value;
}

function integer(value, name, options = {}) {
  const out = number(value, name, options);
  if (out === undefined) return out;
  if (!Number.isInteger(out)) fail(`${name} must be an integer`);
  return out;
}

function textValue(value, name, max, fallback, required = false) {
  if (value === undefined || value === null) {
    if (required) fail(`${name} is required`);
    return fallback;
  }
  if (typeof value !== 'string') fail(`${name} must be a string`);
  const out = value.trim();
  if (out.length === 0) {
    if (required) fail(`${name} must not be empty`);
    return fallback;
  }
  if (out.length > max) fail(`${name} must be at most ${max} characters`);
  if (out.includes('\0')) fail(`${name} must not contain NUL`);
  return out;
}

function colorValue(value, name, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') fail(`${name} must be a color string`);
  const out = value.trim();
  if (out === 'none' || out === 'transparent' || HEX_COLOR.test(out) || URL_REF.test(out)) return out;
  fail(`${name} must be #rgb/#rrggbb/#rrggbbaa, none, transparent, or url(#gradientId)`);
}

function opacityValue(value, name, fallback = 1) {
  return number(value, name, { min: 0, max: 1, fallback });
}

function strokeWidthValue(value, name, fallback = 1.5) {
  return number(value, name, { min: 0, max: 128, fallback });
}

function linecapValue(value, name, fallback = 'round') {
  if (value === undefined || value === null) return fallback;
  if (value !== 'butt' && value !== 'round' && value !== 'square') fail(`${name} must be butt, round, or square`);
  return value;
}

function linejoinValue(value, name, fallback = 'round') {
  if (value === undefined || value === null) return fallback;
  if (value !== 'miter' && value !== 'round' && value !== 'bevel') fail(`${name} must be miter, round, or bevel`);
  return value;
}

function checkKeys(raw, allowed, index) {
  for (const key of Object.keys(raw)) {
    if (!COMMON_KEYS.has(key) && !allowed.has(key)) {
      fail(`element ${index}: unknown field "${key}" for type "${raw.type}"`);
    }
  }
}

function normalizeStops(value, index) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    fail(`element ${index}: gradient.stops must contain 2 to 8 stops`);
  }
  const stops = value.map((stop, stopIndex) => {
    if (!isObject(stop)) fail(`element ${index}: gradient stop ${stopIndex} must be an object`);
    for (const key of Object.keys(stop)) {
      if (key !== 'offset' && key !== 'color' && key !== 'opacity') {
        fail(`element ${index}: gradient stop ${stopIndex} has unknown field "${key}"`);
      }
    }
    return {
      offset: number(stop.offset, `element ${index}: stop.offset`, { min: 0, max: 1, required: true }),
      color: colorValue(stop.color, `element ${index}: stop.color`, undefined),
      opacity: opacityValue(stop.opacity, `element ${index}: stop.opacity`, 1),
    };
  });
  if (stops.some((stop) => stop.color === undefined)) fail(`element ${index}: every gradient stop needs a color`);
  stops.sort((a, b) => a.offset - b.offset);
  return stops;
}

function normalizePoints(value, index) {
  if (typeof value !== 'string') fail(`element ${index}: points must be an SVG points string`);
  if (!POINTS_CHARS.test(value)) fail(`element ${index}: points contains unsupported characters`);
  const nums = value.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length < 6 || nums.length % 2 !== 0) fail(`element ${index}: points needs at least 3 x,y pairs`);
  if (nums.length > 1024) fail(`element ${index}: points has too many coordinates`);
  if (nums.some((n) => !Number.isFinite(n) || Math.abs(n) > 10000)) {
    fail(`element ${index}: points coordinates must be finite and within ±10000`);
  }
  const pairs = [];
  for (let i = 0; i < nums.length; i += 2) pairs.push(`${nums[i]},${nums[i + 1]}`);
  return pairs.join(' ');
}

function normalizeElement(raw, index) {
  if (!isObject(raw)) fail(`element ${index} must be an object`);
  if (!ELEMENT_TYPES.has(raw.type)) fail(`element ${index}: unsupported type ${JSON.stringify(raw.type)}`);
  checkKeys(raw, SHAPE_KEYS[raw.type], index);

  const base = {
    type: raw.type,
    opacity: opacityValue(raw.opacity, `element ${index}: opacity`, 1),
  };

  if (raw.type === 'gradient') {
    const id = textValue(raw.id, `element ${index}: id`, 64, undefined, true);
    if (!ID.test(id)) fail(`element ${index}: id must match ${ID}`);
    const kind = raw.kind ?? 'linear';
    if (kind !== 'linear' && kind !== 'radial') fail(`element ${index}: gradient.kind must be linear or radial`);
    const gradient = {
      ...base,
      type: 'gradient',
      id,
      kind,
      stops: normalizeStops(raw.stops, index),
    };
    if (kind === 'linear') {
      gradient.x1 = number(raw.x1, `element ${index}: x1`, { min: -10000, max: 10000, fallback: 0 });
      gradient.y1 = number(raw.y1, `element ${index}: y1`, { min: -10000, max: 10000, fallback: 0 });
      gradient.x2 = number(raw.x2, `element ${index}: x2`, { min: -10000, max: 10000, fallback: 0 });
      gradient.y2 = number(raw.y2, `element ${index}: y2`, { min: -10000, max: 10000, fallback: 1 });
    } else {
      gradient.cx = number(raw.cx, `element ${index}: cx`, { min: -10000, max: 10000, fallback: 0 });
      gradient.cy = number(raw.cy, `element ${index}: cy`, { min: -10000, max: 10000, fallback: 0 });
      gradient.r = number(raw.r, `element ${index}: r`, { min: 0, max: 10000, fallback: 1 });
    }
    return gradient;
  }

  const fillDefault = raw.type === 'line' || raw.type === 'path' ? 'none' : raw.type === 'text' ? '#F7F2E8' : 'none';
  const out = {
    ...base,
    fill: colorValue(raw.fill, `element ${index}: fill`, fillDefault),
    stroke: colorValue(raw.stroke, `element ${index}: stroke`, 'none'),
    strokeWidth: strokeWidthValue(raw.strokeWidth, `element ${index}: strokeWidth`, 1.5),
    strokeLinecap: linecapValue(raw.strokeLinecap, `element ${index}: strokeLinecap`, 'round'),
    strokeLinejoin: linejoinValue(raw.strokeLinejoin, `element ${index}: strokeLinejoin`, 'round'),
  };

  switch (raw.type) {
    case 'rect':
      out.x = number(raw.x, `element ${index}: x`, { required: true });
      out.y = number(raw.y, `element ${index}: y`, { required: true });
      out.w = number(raw.w, `element ${index}: w`, { min: 0, max: 10000, required: true });
      out.h = number(raw.h, `element ${index}: h`, { min: 0, max: 10000, required: true });
      out.rx = number(raw.rx, `element ${index}: rx`, { min: 0, max: 10000, fallback: 0 });
      break;
    case 'circle':
      out.cx = number(raw.cx, `element ${index}: cx`, { required: true });
      out.cy = number(raw.cy, `element ${index}: cy`, { required: true });
      out.r = number(raw.r, `element ${index}: r`, { min: 0, max: 10000, required: true });
      break;
    case 'ellipse':
      out.cx = number(raw.cx, `element ${index}: cx`, { required: true });
      out.cy = number(raw.cy, `element ${index}: cy`, { required: true });
      out.rx = number(raw.rx, `element ${index}: rx`, { min: 0, max: 10000, required: true });
      out.ry = number(raw.ry, `element ${index}: ry`, { min: 0, max: 10000, required: true });
      break;
    case 'line':
      out.x1 = number(raw.x1, `element ${index}: x1`, { required: true });
      out.y1 = number(raw.y1, `element ${index}: y1`, { required: true });
      out.x2 = number(raw.x2, `element ${index}: x2`, { required: true });
      out.y2 = number(raw.y2, `element ${index}: y2`, { required: true });
      break;
    case 'path': {
      const d = textValue(raw.d, `element ${index}: d`, MAX_PATH, undefined, true);
      if (!/^[Mm]/.test(d)) fail(`element ${index}: d must start with M or m`);
      if (!PATH_CHARS.test(d)) fail(`element ${index}: d contains unsupported characters`);
      out.d = d;
      break;
    }
    case 'polygon':
      out.points = normalizePoints(raw.points, index);
      break;
    case 'text': {
      out.x = number(raw.x, `element ${index}: x`, { required: true });
      out.y = number(raw.y, `element ${index}: y`, { required: true });
      out.text = textValue(raw.text, `element ${index}: text`, MAX_TEXT, undefined, true);
      out.size = number(raw.size, `element ${index}: size`, { min: 4, max: 400, fallback: 24 });
      out.anchor = raw.anchor ?? 'start';
      if (out.anchor !== 'start' && out.anchor !== 'middle' && out.anchor !== 'end') {
        fail(`element ${index}: anchor must be start, middle, or end`);
      }
      out.weight = integer(raw.weight, `element ${index}: weight`, { min: 100, max: 900, fallback: 400 });
      if (out.weight % 100 !== 0) fail(`element ${index}: weight must be a multiple of 100`);
      out.font = raw.font ?? 'serif';
      if (!Object.hasOwn(FONT_FAMILIES, out.font)) fail(`element ${index}: font must be serif, sans, or mono`);
      out.letterSpacing = number(raw.letterSpacing, `element ${index}: letterSpacing`, {
        min: -20,
        max: 80,
        fallback: 0,
      });
      break;
    }
    default:
      fail(`element ${index}: unsupported type`);
  }

  return out;
}

function gradientIdsOf(elements) {
  return new Set(elements.filter((element) => element.type === 'gradient').map((element) => element.id));
}

function assertReferencesResolve(elements, knownGradientIds) {
  for (const [index, element] of elements.entries()) {
    if (element.type === 'gradient') continue;
    for (const field of ['fill', 'stroke']) {
      const match = URL_REF.exec(element[field]);
      if (match && !knownGradientIds.has(match[1])) {
        fail(`element ${index}: ${field} references unknown gradient "${match[1]}"`);
      }
    }
  }
}

export function normalizeElements(rawElements, existingElements = [], { limit = MAX_ELEMENTS_PER_CALL } = {}) {
  if (!Array.isArray(rawElements) || rawElements.length === 0) fail('elements must be a non-empty array');
  if (rawElements.length > limit) fail(`elements may contain at most ${limit} items`);
  const known = gradientIdsOf(existingElements);
  const normalized = [];
  for (const [index, raw] of rawElements.entries()) {
    const element = normalizeElement(raw, index);
    if (element.type === 'gradient') {
      if (known.has(element.id)) fail(`element ${index}: duplicate gradient id "${element.id}"`);
      known.add(element.id);
    }
    normalized.push(element);
  }
  assertReferencesResolve(normalized, known);
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return character;
    }
  });
}

function attrs(entries) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `${name}="${escapeXml(value)}"`)
    .join(' ');
}

function commonAttrs(element) {
  return [
    ['fill', element.fill],
    ['stroke', element.stroke],
    ['stroke-width', element.strokeWidth],
    ['stroke-linecap', element.strokeLinecap],
    ['stroke-linejoin', element.strokeLinejoin],
    ['opacity', element.opacity],
  ];
}

function renderGradient(gradient) {
  const stops = gradient.stops
    .map((stop) => `<stop offset="${Math.round(stop.offset * 1000) / 10}%" stop-color="${escapeXml(stop.color)}" stop-opacity="${stop.opacity}"/>`)
    .join('');
  if (gradient.kind === 'radial') {
    return `<radialGradient id="${escapeXml(gradient.id)}" cx="${gradient.cx}" cy="${gradient.cy}" r="${gradient.r}" gradientUnits="userSpaceOnUse">${stops}</radialGradient>`;
  }
  return `<linearGradient id="${escapeXml(gradient.id)}" x1="${gradient.x1}" y1="${gradient.y1}" x2="${gradient.x2}" y2="${gradient.y2}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`;
}

function renderElement(element) {
  if (element.type === 'rect') {
    return `<rect ${attrs([
      ['x', element.x],
      ['y', element.y],
      ['width', element.w],
      ['height', element.h],
      ['rx', element.rx || undefined],
      ...commonAttrs(element),
    ])}/>`;
  }
  if (element.type === 'circle') {
    return `<circle ${attrs([
      ['cx', element.cx],
      ['cy', element.cy],
      ['r', element.r],
      ...commonAttrs(element),
    ])}/>`;
  }
  if (element.type === 'ellipse') {
    return `<ellipse ${attrs([
      ['cx', element.cx],
      ['cy', element.cy],
      ['rx', element.rx],
      ['ry', element.ry],
      ...commonAttrs(element),
    ])}/>`;
  }
  if (element.type === 'line') {
    return `<line ${attrs([
      ['x1', element.x1],
      ['y1', element.y1],
      ['x2', element.x2],
      ['y2', element.y2],
      ...commonAttrs(element),
    ])}/>`;
  }
  if (element.type === 'path') {
    return `<path ${attrs([
      ['d', element.d],
      ...commonAttrs(element),
    ])}/>`;
  }
  if (element.type === 'polygon') {
    return `<polygon ${attrs([
      ['points', element.points],
      ...commonAttrs(element),
    ])}/>`;
  }
  if (element.type === 'text') {
    return `<text ${attrs([
      ['x', element.x],
      ['y', element.y],
      ['font-family', FONT_FAMILIES[element.font]],
      ['font-size', element.size],
      ['font-weight', element.weight],
      ['text-anchor', element.anchor],
      ['letter-spacing', element.letterSpacing || undefined],
      ['xml:space', 'preserve'],
      ...commonAttrs(element),
    ])}>${escapeXml(element.text)}</text>`;
  }
  throw new PaintError(`unsupported element type ${element.type}`);
}

export function renderSvg({ title, width, height, background, elements }) {
  const defs = elements.filter((element) => element.type === 'gradient').map(renderGradient).join('');
  const body = elements.filter((element) => element.type !== 'gradient').map(renderElement).join('');
  const label = escapeXml(title || 'Abaaba Paint');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
    defs ? `<defs>${defs}</defs>` : '',
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(background)}"/>`,
    body,
    '</svg>',
  ].join('');
}

export class PaintStore {
  constructor({ maxElements = MAX_ELEMENTS, maxHistory = MAX_HISTORY, maxStateBytes = MAX_STATE_BYTES, maxHistoryBytes = MAX_HISTORY_BYTES } = {}) {
    this.maxElements = maxElements;
    this.maxHistory = maxHistory;
    this.maxStateBytes = maxStateBytes;
    this.maxHistoryBytes = maxHistoryBytes;
    this.historyBytes = 0;
    this.title = 'Abaaba 画室';
    this.width = 1200;
    this.height = 800;
    this.background = '#0E1626';
    this.elements = [];
    this.history = [];
    this.revision = 0;
    this.contentEpoch = 0;
    this.bootNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this.updatedAt = Date.now();
    this.workspace = null;
    this.savedAt = 0;
    this.saveError = '';
  }

  #elementBytes(elements) {
    return Buffer.byteLength(JSON.stringify(elements), 'utf8');
  }

  #pushHistory() {
    const elements = clone(this.elements);
    const bytes = this.#elementBytes(elements);
    this.history.push({
      title: this.title,
      width: this.width,
      height: this.height,
      background: this.background,
      elements,
      bytes,
    });
    this.historyBytes += bytes;
    while (this.history.length > this.maxHistory || this.historyBytes > this.maxHistoryBytes) {
      const removed = this.history.shift();
      this.historyBytes -= removed.bytes;
    }
  }

  create({ width = 1200, height = 800, background = '#0E1626', title = 'Abaaba 画室' } = {}) {
    const w = integer(width, 'width', { min: CANVAS_MIN, max: CANVAS_MAX, required: true });
    const h = integer(height, 'height', { min: CANVAS_MIN, max: CANVAS_MAX, required: true });
    const bg = colorValue(background, 'background', '#0E1626');
    if (URL_REF.test(bg)) fail('background must not reference a gradient');
    const nextTitle = textValue(title, 'title', MAX_TITLE, 'Abaaba 画室');
    this.#pushHistory();
    this.title = nextTitle;
    this.width = w;
    this.height = h;
    this.background = bg;
    this.elements = [];
    this.revision += 1;
    this.updatedAt = Date.now();
    return this.summary();
  }

  draw(rawElements) {
    const normalized = normalizeElements(rawElements, this.elements);
    if (this.elements.length + normalized.length > this.maxElements) {
      fail(`canvas may contain at most ${this.maxElements} elements`);
    }
    const nextElements = [...this.elements, ...normalized];
    if (this.#elementBytes(nextElements) > this.maxStateBytes) {
      fail(`canvas state may contain at most ${this.maxStateBytes} bytes`);
    }
    this.#pushHistory();
    this.elements.push(...normalized);
    this.revision += 1;
    this.updatedAt = Date.now();
    return { added: normalized.length, ...this.summary() };
  }

  undo(steps = 1) {
    const count = integer(steps, 'steps', { min: 1, max: 50, fallback: 1 });
    let undone = 0;
    while (undone < count && this.history.length > 0) {
      const previous = this.history.pop();
      this.historyBytes = Math.max(0, this.historyBytes - previous.bytes);
      this.title = previous.title;
      this.width = previous.width;
      this.height = previous.height;
      this.background = previous.background;
      this.elements = previous.elements;
      undone += 1;
    }
    if (undone > 0) {
      this.revision += 1;
      this.updatedAt = Date.now();
    }
    return { undone, ...this.summary() };
  }

  clear() {
    if (this.elements.length === 0) return { cleared: false, ...this.summary() };
    this.#pushHistory();
    this.elements = [];
    this.revision += 1;
    this.updatedAt = Date.now();
    return { cleared: true, ...this.summary() };
  }

  get etag() {
    return `"paint-${this.bootNonce}-${this.revision}-${this.contentEpoch}"`;
  }

  bindWorkspace(workspace) {
    this.workspace = workspace;
    this.saveError = '';
  }

  markSaved(savedAt = Date.now()) {
    this.savedAt = savedAt;
    this.saveError = '';
  }

  markSaveError(message) {
    this.saveError = String(message ?? 'save failed').slice(0, 300);
  }

  serialize() {
    return JSON.stringify({
      format: STATE_FORMAT,
      version: STATE_VERSION,
      title: this.title,
      width: this.width,
      height: this.height,
      background: this.background,
      elements: this.elements,
      revision: this.revision,
      updatedAt: this.updatedAt,
    }, null, 2);
  }

  loadSerialized(raw) {
    if (typeof raw !== 'string') fail('published canvas must be text');
    if (Buffer.byteLength(raw, 'utf8') > MAX_STATE_FILE_BYTES) fail('published canvas file is too large');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      fail('published canvas is not valid JSON');
    }
    if (!isObject(data)) fail('published canvas must be an object');
    const allowed = new Set(['format', 'version', 'title', 'width', 'height', 'background', 'elements', 'revision', 'updatedAt']);
    for (const key of Object.keys(data)) if (!allowed.has(key)) fail(`published canvas has unknown field "${key}"`);
    if (data.format !== STATE_FORMAT || data.version !== STATE_VERSION) fail('published canvas has an unsupported format');
    const title = textValue(data.title, 'published canvas title', MAX_TITLE, 'Abaaba 画室');
    const width = integer(data.width, 'published canvas width', { min: CANVAS_MIN, max: CANVAS_MAX, required: true });
    const height = integer(data.height, 'published canvas height', { min: CANVAS_MIN, max: CANVAS_MAX, required: true });
    const background = colorValue(data.background, 'published canvas background', '#0E1626');
    if (URL_REF.test(background)) fail('published canvas background must not reference a gradient');
    if (!Array.isArray(data.elements)) fail('published canvas elements must be an array');
    if (data.elements.length > this.maxElements) fail(`published canvas may contain at most ${this.maxElements} elements`);
    const elements = data.elements.length === 0 ? [] : normalizeElements(data.elements, [], { limit: this.maxElements });
    if (this.#elementBytes(elements) > this.maxStateBytes) fail('published canvas exceeds the state byte budget');
    const revision = integer(data.revision, 'published canvas revision', { min: 0, max: Number.MAX_SAFE_INTEGER, required: true });
    const updatedAt = integer(data.updatedAt, 'published canvas updatedAt', { min: 0, max: Number.MAX_SAFE_INTEGER, required: true });
    this.title = title;
    this.width = width;
    this.height = height;
    this.background = background;
    this.elements = elements;
    this.revision = revision;
    this.contentEpoch += 1;
    this.updatedAt = updatedAt;
    this.history = [];
    this.historyBytes = 0;
    return this.summary();
  }

  summary() {
    const types = {};
    for (const element of this.elements) types[element.type] = (types[element.type] || 0) + 1;
    return {
      title: this.title,
      width: this.width,
      height: this.height,
      background: this.background,
      count: this.elements.length,
      typeCounts: Object.entries(types).map(([type, count]) => ({ type, count })),
      revision: this.revision,
      updatedAt: this.updatedAt,
      workspace: this.workspace?.cwd ?? '',
      savedAt: this.savedAt,
      saveError: this.saveError,
      persisted: Boolean(this.workspace && this.savedAt),
    };
  }

  snapshot() {
    return {
      ...this.summary(),
      elements: clone(this.elements),
    };
  }

  renderSvg() {
    return renderSvg({
      title: this.title,
      width: this.width,
      height: this.height,
      background: this.background,
      elements: this.elements,
    });
  }
}
