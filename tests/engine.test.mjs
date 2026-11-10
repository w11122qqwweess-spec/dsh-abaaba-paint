import test from 'node:test';
import assert from 'node:assert/strict';

import { PaintStore, PaintError, normalizeElements } from '../lib/engine.js';

function storeWithBasics() {
  const store = new PaintStore();
  store.create({ width: 1200, height: 800, background: '#0E1626', title: '深夜画室' });
  return store;
}

test('creates a canvas, appends elements, and reports a monotonic revision', () => {
  const store = storeWithBasics();
  const first = store.draw([
    { type: 'rect', x: 0, y: 0, w: 1200, h: 800, fill: '#1B2A44' },
    { type: 'circle', cx: 600, cy: 400, r: 80, fill: '#F2C879', opacity: 0.8 },
  ]);
  assert.equal(first.added, 2);
  assert.equal(first.count, 2);
  const second = store.draw([{ type: 'text', x: 64, y: 96, text: '深夜画室', size: 30, fill: '#A9C4D6' }]);
  assert.equal(second.count, 3);
  assert.ok(second.revision > first.revision);
});

test('rejects unsafe colors, unknown fields, and malformed geometry atomically', () => {
  const store = storeWithBasics();
  const before = store.snapshot();
  assert.throws(
    () => store.draw([{ type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'red;}</style><script>' }]),
    (error) => error instanceof PaintError && /fill/.test(error.message),
  );
  assert.throws(
    () => store.draw([{ type: 'rect', x: 0, y: 0, w: 10, h: 10, onload: 'alert(1)' }]),
    /unknown field/,
  );
  assert.throws(
    () => store.draw([{ type: 'rect', x: 0, y: 0, w: Number.NaN, h: 10 }]),
    /finite number/,
  );
  assert.deepEqual(store.snapshot().elements, before.elements);
});

test('escapes text and never emits script or event attributes', () => {
  const store = storeWithBasics();
  store.draw([
    {
      type: 'text',
      x: 20,
      y: 40,
      text: '</text><script>alert(1)</script><img src=x onerror=alert(2)>',
      size: 18,
      fill: '#F7F2E8',
    },
  ]);
  const svg = store.renderSvg();
  assert.match(svg, /&lt;\/text&gt;&lt;script&gt;/);
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /<img/i);
});

test('rejects path data that could introduce markup or external references', () => {
  const store = storeWithBasics();
  assert.throws(
    () => store.draw([{ type: 'path', d: 'M0 0 L10 10" onload="alert(1)', stroke: '#fff' }]),
    /unsupported characters/,
  );
  assert.throws(
    () => store.draw([{ type: 'path', d: 'url(#evil)', stroke: '#fff' }]),
    /start with M/,
  );
});

test('supports gradients and rejects dangling or duplicate references', () => {
  const store = storeWithBasics();
  store.draw([
    {
      type: 'gradient',
      id: 'nightWall',
      kind: 'linear',
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 800,
      stops: [
        { offset: 0, color: '#1B2A44' },
        { offset: 1, color: '#0E1626' },
      ],
    },
    { type: 'rect', x: 0, y: 0, w: 1200, h: 800, fill: 'url(#nightWall)' },
  ]);
  const svg = store.renderSvg();
  assert.match(svg, /<linearGradient id="nightWall"/);
  assert.match(svg, /fill="url\(#nightWall\)"/);
  assert.throws(
    () => store.draw([{ type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'url(#missing)' }]),
    /unknown gradient/,
  );
  assert.throws(
    () => store.draw([
      { type: 'gradient', id: 'nightWall', stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] },
    ]),
    /duplicate gradient id/,
  );
});

test('undo and clear are reversible and bounded', () => {
  const store = storeWithBasics();
  store.draw([{ type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#fff' }]);
  const afterDraw = store.snapshot().revision;
  const undone = store.undo();
  assert.equal(undone.undone, 1);
  assert.equal(undone.count, 0);
  assert.ok(undone.revision > afterDraw);
  const restored = store.undo();
  assert.ok(restored.undone >= 0);
  assert.equal(store.snapshot().count, 0);
});

test('caps a single draw call and the whole canvas', () => {
  const store = new PaintStore({ maxElements: 4 });
  store.create({});
  const rect = { type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#fff' };
  assert.throws(() => store.draw(Array.from({ length: 257 }, () => rect)), /at most 256/);
  store.draw([rect, rect, rect]);
  assert.throws(() => store.draw([rect, rect]), /at most 4 elements/);
});

test('enforces serialized state and history byte budgets', () => {
  const store = new PaintStore({ maxStateBytes: 500, maxHistoryBytes: 300 });
  store.create({});
  const longText = { type: 'text', x: 0, y: 0, text: 'x'.repeat(100), size: 20, fill: '#fff' };
  assert.throws(() => store.draw([longText, longText, longText]), /state may contain at most/);
  const historyStore = new PaintStore({ maxHistoryBytes: 300 });
  historyStore.create({});
  for (let index = 0; index < 6; index += 1) {
    historyStore.draw([{ type: 'rect', x: index, y: index, w: 10, h: 10, fill: '#fff' }]);
  }
  assert.ok(historyStore.historyBytes <= 300, `historyBytes=${historyStore.historyBytes}`);
});

test('reloads a persisted canvas with more than one draw batch', () => {
  const store = new PaintStore();
  store.create({});
  const rect = { type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#fff' };
  store.draw(Array.from({ length: 256 }, () => rect));
  store.draw(Array.from({ length: 44 }, () => rect));
  assert.equal(store.snapshot().count, 300);
  const serialized = store.serialize();
  const restored = new PaintStore();
  restored.loadSerialized(serialized);
  assert.equal(restored.snapshot().count, 300);
  assert.equal(restored.snapshot().revision, store.revision);
});

test('invalidates the ETag when a snapshot is reloaded in-process', () => {
  const store = new PaintStore();
  store.create({});
  store.draw([{ type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#fff' }]);
  const before = store.etag;
  store.loadSerialized(store.serialize());
  assert.notEqual(store.etag, before);
});

test('normalizes points and text deterministically', () => {
  const elements = normalizeElements([
    { type: 'polygon', points: '0,0 10,0 10,10', fill: '#fff' },
    { type: 'text', x: 1, y: 2, text: '  literal  ', size: 20, fill: '#fff' },
  ]);
  assert.equal(elements[0].points, '0,0 10,0 10,10');
  assert.equal(elements[1].text, 'literal');
});
