import test from 'node:test';
import assert from 'node:assert/strict';

import { PaintStore } from '../lib/engine.js';
import { createActionHandler, createExportHandler, createStateHandler } from '../lib/http.js';

function store() {
  const value = new PaintStore();
  value.create({ width: 320, height: 200, title: 'test' });
  value.draw([{ type: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#F2C879' }]);
  return value;
}

function actionRequest(body, headers = {}) {
  return new Request('http://127.0.0.1:50833/api/abaaba-paint/action', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-abaaba-paint': '1',
      origin: 'http://127.0.0.1:50833',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('state is GET-only and side-effect free', async () => {
  const paint = store();
  const before = paint.snapshot();
  const handler = createStateHandler(paint);
  const response = await handler(new Request('http://127.0.0.1:50833/api/abaaba-paint/state'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.value.revision, before.revision);
  const wrong = await handler(new Request('http://127.0.0.1:50833/api/abaaba-paint/state', { method: 'POST' }));
  assert.equal(wrong.status, 405);
  const etag = response.headers.get('etag');
  assert.ok(etag);
  const notModified = await handler(new Request('http://127.0.0.1:50833/api/abaaba-paint/state', {
    headers: { 'if-none-match': etag },
  }));
  assert.equal(notModified.status, 304);
});

test('actions require the custom header and matching revision', async () => {
  const paint = store();
  const handler = createActionHandler(paint);
  const missing = await handler(actionRequest({ action: 'clear', revision: paint.revision }, { 'x-abaaba-paint': '' }));
  assert.equal(missing.status, 403);
  const stale = await handler(actionRequest({ action: 'clear', revision: 0 }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'PAINT_STALE');
  const ok = await handler(actionRequest({ action: 'clear', revision: paint.revision }));
  assert.equal(ok.status, 200);
  assert.equal(paint.snapshot().count, 0);
});

test('actions reject prototype-pollution shapes and oversized bodies', async () => {
  const paint = store();
  const handler = createActionHandler(paint);
  const proto = new Request('http://127.0.0.1:50833/api/abaaba-paint/action', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-abaaba-paint': '1',
      origin: 'http://127.0.0.1:50833',
    },
    body: '{"action":"clear","revision":0,"__proto__":{"polluted":true}}',
  });
  const polluted = await handler(proto);
  assert.equal(polluted.status, 400);
  assert.equal({}.polluted, undefined);
  const big = await handler(actionRequest({ action: 'clear', revision: paint.revision, filler: 'x'.repeat(70 * 1024) }));
  assert.equal(big.status, 413);
});

test('routes state and actions by sessionId', async () => {
  const a = store();
  const b = store();
  b.draw([{ type: 'circle', cx: 1, cy: 1, r: 1, fill: '#fff' }]);
  const stores = new Map([['session-a', a], ['session-b', b]]);
  const state = createStateHandler(stores);
  const ok = await state(new Request('http://127.0.0.1:50833/api/abaaba-paint/state?sessionId=session-a'));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).value.count, 1);
  const missing = await state(new Request('http://127.0.0.1:50833/api/abaaba-paint/state'));
  assert.equal(missing.status, 400);
  const unknown = await state(new Request('http://127.0.0.1:50833/api/abaaba-paint/state?sessionId=nope'));
  assert.equal(unknown.status, 200);
  assert.equal((await unknown.json()).value.count, 0);

  const action = createActionHandler(stores);
  const request = new Request('http://127.0.0.1:50833/api/abaaba-paint/action', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-abaaba-paint': '1',
      origin: 'http://127.0.0.1:50833',
    },
    body: JSON.stringify({ action: 'clear', revision: a.revision, sessionId: 'session-a' }),
  });
  const cleared = await action(request);
  assert.equal(cleared.status, 200);
  assert.equal(a.snapshot().count, 0);
  assert.equal(b.snapshot().count, 2);
});

test('export response is SVG with an inert policy', async () => {
  const paint = store();
  const response = await createExportHandler(paint)(new Request('http://127.0.0.1:50833/api/abaaba-paint/export.svg'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  const svg = await response.text();
  assert.match(svg, /<svg /);
  assert.doesNotMatch(svg, /<script/i);
});
