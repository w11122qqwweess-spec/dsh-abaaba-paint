import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { apply } from '../index.js';
import { PaintStore } from '../lib/engine.js';
import { ensureWorkspace, saveWorkspace } from '../lib/workspace.js';
import { createActionHandler, createHandoffListHandler, createHandoffSvgHandler } from '../lib/http.js';
import { createArtifact, writeArtifact } from '../lib/handoff.js';

function makeContext(root) {
  const tools = new Map();
  const routes = [];
  const disposers = [];
  const policyRef = { value: null };
  const ctx = {
    get(name) {
      if (name !== 'sandboxPolicy') return undefined;
      return { resolve: () => ({ mode: 'read-only', workspaceRoot: root }) };
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
          return async () => {};
        },
      },
    },
    workingDirectory: {
      get() {
        return root;
      },
    },
    fs: {
      async resolve(input, options = {}) {
        const base = options.cwd ?? root;
        const target = path.resolve(base, input);
        return { targetKey: target, displayPath: target };
      },
      contains(parent, child) {
        const relative = path.relative(parent.targetKey, child.targetKey);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
      },
      async lstat(input, options = {}) {
        const target = path.resolve(options.cwd ?? root, input);
        try {
          const stat = await fs.lstat(target);
          return {
            version: 'v1',
            type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
            size: stat.size,
          };
        } catch {
          return undefined;
        }
      },
      async stat(target) {
        try {
          const stat = await fs.stat(target.targetKey);
          return { version: 'v1', type: stat.isDirectory() ? 'directory' : 'file', size: stat.size };
        } catch {
          return undefined;
        }
      },
      async listDir(target) {
        const entries = await fs.readdir(target.targetKey, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          target: { targetKey: path.join(target.targetKey, entry.name), displayPath: path.join(target.targetKey, entry.name) },
        }));
      },
      async readText(target) {
        return fs.readFile(target.targetKey, 'utf8');
      },
      async writeText(target, content, intent, _signal, policy) {
        policyRef.value = policy ?? null;
        if (intent.kind === 'createIfAbsent') {
          try {
            await fs.access(target.targetKey);
            const error = new Error('file exists');
            error.code = 'EEXIST';
            throw error;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        await fs.writeFile(target.targetKey, content, 'utf8');
        return { operation: intent.kind === 'createIfAbsent' ? 'create' : 'update', version: 'v2', before: null, after: content };
      },
    },
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
  };
  apply(ctx);
  return { ctx, tools, routes, disposers, policyRef };
}

function assertNoBooleanRequired(value, at = 'schema') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoBooleanRequired(item, `${at}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Object.hasOwn(value, 'required')) {
    assert.ok(Array.isArray(value.required), `${at}.required must be an array`);
  }
  for (const [key, child] of Object.entries(value)) assertNoBooleanRequired(child, `${at}.${key}`);
}

test('registers eleven tools and five authenticated routes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-smoke-'));
  const { tools, routes } = makeContext(root);
  assert.deepEqual([...tools.keys()].sort(), [
    'paint_clear',
    'paint_create',
    'paint_draw',
    'paint_export',
    'paint_handoff',
    'paint_handoff_import',
    'paint_handoff_list',
    'paint_load',
    'paint_save',
    'paint_state',
    'paint_undo',
  ]);
  assert.deepEqual(routes.map((route) => route.path).sort(), [
    '/api/abaaba-paint/action',
    '/api/abaaba-paint/export.svg',
    '/api/abaaba-paint/handoff.svg',
    '/api/abaaba-paint/handoffs',
    '/api/abaaba-paint/state',
  ]);
  for (const tool of tools.values()) {
    assert.ok(tool.parameters.type === 'object');
    assertNoBooleanRequired(tool.parameters, `${tool.name}.parameters`);
    assertNoBooleanRequired(tool.output.schema, `${tool.name}.output`);
  }
});

test('creates, draws, inspects, undoes, and exports a real SVG', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-smoke-'));
  await fs.mkdir(path.join(root, 'art'));
  const { tools, policyRef } = makeContext(root);
  const exec = { agent: { id: 'session-test', session: {} } };

  const created = await tools.get('paint_create').execute(
    { width: 640, height: 400, background: '#0E1626', title: 'smoke' },
    exec,
  );
  assert.equal(created.ok, true);
  assert.equal(created.width, 640);

  const drawn = await tools.get('paint_draw').execute({
    elements: [
      { type: 'rect', x: 0, y: 0, w: 640, h: 400, fill: '#1B2A44' },
      { type: 'text', x: 32, y: 64, text: '</text><script>alert(1)</script>', size: 24, fill: '#F7F2E8' },
    ],
  }, exec);
  assert.equal(drawn.added, 2);
  assert.equal(drawn.count, 2);

  const state = await tools.get('paint_state').execute({}, exec);
  assert.equal(state.count, 2);
  assert.deepEqual(state.typeCounts, [{ type: 'rect', count: 1 }, { type: 'text', count: 1 }]);

  const exported = await tools.get('paint_export').execute({ path: 'art/smoke.svg' }, exec);
  assert.equal(exported.ok, true);
  assert.equal(exported.path, 'art/smoke.svg');
  assert.deepEqual(policyRef.value, { mode: 'read-only', workspaceRoot: root });
  for (const [name, value] of [
    ['paint_create', created],
    ['paint_draw', drawn],
    ['paint_state', state],
    ['paint_export', exported],
  ]) {
    const declared = tools.get(name).output.schema.properties;
    for (const key of Object.keys(value)) assert.ok(Object.hasOwn(declared, key), `${name} output has undeclared "${key}"`);
  }
  const svg = await fs.readFile(path.join(root, 'art', 'smoke.svg'), 'utf8');
  assert.match(svg, /&lt;\/text&gt;&lt;script&gt;/);
  assert.doesNotMatch(svg, /<script/i);

  await assert.rejects(
    () => tools.get('paint_export').execute({ path: 'art/smoke.svg' }, exec),
    /already exists/,
  );
  const replaced = await tools.get('paint_export').execute({ path: 'art/smoke.svg', overwrite: true }, exec);
  assert.equal(replaced.overwritten, true);

  const beforeUndo = state.revision;
  const undone = await tools.get('paint_undo').execute({ steps: 1 }, exec);
  assert.equal(undone.undone, 1);
  assert.ok(undone.revision > beforeUndo);
});

test('requires replace:true before overwriting an existing workspace canvas', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-replace-'));
  const { tools } = makeContext(root);
  const exec = { agent: { id: 'session-test', session: {} } };
  await tools.get('paint_create').execute({ width: 320, height: 200, title: 'first' }, exec);
  await assert.rejects(
    () => tools.get('paint_create').execute({ width: 320, height: 200, title: 'second' }, exec),
    /replace:true/,
  );
  const replaced = await tools.get('paint_create').execute({ width: 320, height: 200, title: 'second', replace: true }, exec);
  assert.equal(replaced.ok, true);
  assert.equal(replaced.title, 'second');
});

test('auto-saves and reloads the canvas from the workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-persist-'));
  const { tools } = makeContext(root);
  const exec = { agent: { id: 'session-test', session: {} } };
  await tools.get('paint_create').execute({ width: 320, height: 200, title: 'persisted' }, exec);
  await tools.get('paint_draw').execute({
    elements: [{ type: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#F2C879' }],
  }, exec);

  const stateFile = path.join(root, 'abaaba-paint-session-test.json');
  const svgFile = path.join(root, 'abaaba-paint-session-test.svg');
  assert.ok((await fs.stat(stateFile)).size > 0);
  assert.ok((await fs.stat(svgFile)).size > 0);
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert.equal(state.format, 'dsh-abaaba-paint');
  assert.equal(state.version, 1);
  assert.equal(state.elements.length, 1);
  assert.equal(state.title, 'persisted');

  const saved = await tools.get('paint_save').execute({}, exec);
  assert.equal(saved.saved, true);
  assert.equal(saved.workspace, root);

  const restarted = makeContext(root);
  const loaded = await restarted.tools.get('paint_load').execute({}, exec);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.loaded, true);
  assert.equal(loaded.count, 1);
  const summary = await restarted.tools.get('paint_state').execute({}, exec);
  assert.equal(summary.title, 'persisted');
  assert.equal(summary.count, 1);
  assert.equal(summary.persisted, true);
});

test('rejects an oversized workspace snapshot before reading it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-huge-'));
  await fs.writeFile(path.join(root, 'abaaba-paint-session-test.json'), Buffer.alloc(4 * 1024 * 1024, 'a'));
  const { tools } = makeContext(root);
  const exec = { agent: { id: 'session-test', session: {} } };
  await assert.rejects(() => tools.get('paint_load').execute({}, exec), /too large/);
});

test('rejects a corrupted workspace snapshot before mutating', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-corrupt-'));
  await fs.writeFile(path.join(root, 'abaaba-paint-session-test.json'), '{"format":"wrong"}', 'utf8');
  const { tools } = makeContext(root);
  const exec = { agent: { id: 'session-test', session: {} } };
  await assert.rejects(
    () => tools.get('paint_load').execute({}, exec),
    /unsupported format|invalid|format/i,
  );
  await assert.rejects(
    () => tools.get('paint_draw').execute({ elements: [{ type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#fff' }] }, exec),
    /unsupported format|invalid|format/i,
  );
});

test('switching workspaces does not leak one canvas into another', async () => {
  const rootA = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-ws-a-'));
  const rootB = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-ws-b-'));
  const { ctx } = makeContext(rootA);
  const store = new PaintStore();
  const exec = { agent: { id: 'session-test', session: {} } };
  await ensureWorkspace(ctx, store, exec, { reset: true });
  store.create({ width: 320, height: 200, title: 'A' });
  store.draw([{ type: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#F2C879' }]);
  await saveWorkspace(ctx, store);
  assert.equal(store.snapshot().count, 1);

  ctx.workingDirectory.get = () => rootB;
  await ensureWorkspace(ctx, store, exec, { load: true });
  assert.equal(store.snapshot().count, 0, 'B must start empty instead of inheriting A');
  store.create({ width: 320, height: 200, title: 'B' });
  store.draw([{ type: 'rect', x: 1, y: 1, w: 10, h: 10, fill: '#fff' }]);
  await saveWorkspace(ctx, store);

  ctx.workingDirectory.get = () => rootA;
  await ensureWorkspace(ctx, store, exec, { load: true });
  assert.equal(store.snapshot().title, 'A');
  assert.equal(store.snapshot().count, 1);
});

test('keeps canvases independent per Session in the same workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-sessions-'));
  const { tools } = makeContext(root);
  const a = { agent: { id: 'session-a', session: {} } };
  const b = { agent: { id: 'session-b', session: {} } };
  await tools.get('paint_create').execute({ width: 320, height: 200, title: 'A' }, a);
  await tools.get('paint_draw').execute({ elements: [{ type: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#F2C879' }] }, a);
  await tools.get('paint_create').execute({ width: 640, height: 400, title: 'B' }, b);
  await tools.get('paint_draw').execute({ elements: [{ type: 'circle', cx: 20, cy: 20, r: 5, fill: '#fff' }] }, b);
  const stateA = await tools.get('paint_state').execute({}, a);
  const stateB = await tools.get('paint_state').execute({}, b);
  assert.equal(stateA.title, 'A');
  assert.equal(stateA.count, 1);
  assert.equal(stateB.title, 'B');
  assert.equal(stateB.count, 1);
  assert.notEqual(await fs.stat(path.join(root, 'abaaba-paint-session-a.json')).then(() => 'a'), undefined);
  assert.ok((await fs.stat(path.join(root, 'abaaba-paint-session-a.json'))).size > 0);
  assert.ok((await fs.stat(path.join(root, 'abaaba-paint-session-b.json'))).size > 0);
});

test('hands a canvas from one Session to another as an artifact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-handoff-'));
  const { tools } = makeContext(root);
  const a = { agent: { id: 'session-artist', session: {} } };
  const b = { agent: { id: 'session-curator', session: {} } };
  await tools.get('paint_create').execute({ width: 240, height: 160, title: 'handoff source' }, a);
  await tools.get('paint_draw').execute({ elements: [{ type: 'circle', cx: 120, cy: 80, r: 40, fill: '#4E7A5E' }] }, a);
  const handoff = await tools.get('paint_handoff').execute({ name: 'artist v1' }, a);
  assert.equal(handoff.ok, true);
  assert.ok(handoff.artifactId);
  assert.ok((await fs.stat(path.join(root, handoff.path))).size > 0);

  const listed = await tools.get('paint_handoff_list').execute({}, b);
  assert.equal(listed.artifacts.length, 1);
  assert.equal(listed.artifacts[0].title, 'handoff source');
  assert.equal(listed.artifacts[0].source.name, 'artist v1');

  const imported = await tools.get('paint_handoff_import').execute({ artifactId: handoff.artifactId }, b);
  assert.equal(imported.imported, true);
  assert.equal(imported.count, 1);
  assert.equal(imported.title, 'handoff source');
  const bState = await tools.get('paint_state').execute({}, b);
  assert.equal(bState.count, 1);
  const aState = await tools.get('paint_state').execute({}, a);
  assert.equal(aState.count, 1, 'source Session must keep its canvas');

  const artifact = JSON.parse(await fs.readFile(path.join(root, handoff.path), 'utf8'));
  assert.equal(artifact.format, 'dsh-abaaba-paint-handoff');
  assert.equal(artifact.svg, undefined, 'artifact must not store trusted markup');
});

test('serves the handoff inbox and imports an artifact over HTTP', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-handoff-http-'));
  const { ctx } = makeContext(root);
  const artist = new PaintStore();
  const artistExec = { agent: { id: 'session-artist', session: {} } };
  await ensureWorkspace(ctx, artist, artistExec, { reset: true });
  artist.create({ width: 240, height: 160, title: 'http handoff' });
  artist.draw([{ type: 'circle', cx: 120, cy: 80, r: 40, fill: '#4E7A5E' }]);
  const artifact = createArtifact(artist, { agentId: 'session-artist', name: 'http' });
  await writeArtifact(ctx, artist, artifact);

  const curator = new PaintStore();
  const curatorExec = { agent: { id: 'session-curator', session: {} } };
  await ensureWorkspace(ctx, curator, curatorExec, { reset: true });
  const stores = new Map([['session-artist', artist], ['session-curator', curator]]);

  const listed = await createHandoffListHandler(stores, ctx)(new Request('http://127.0.0.1:50833/api/abaaba-paint/handoffs?sessionId=session-curator'));
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).artifacts.length, 1);

  const preview = await createHandoffSvgHandler(stores, ctx)(new Request(`http://127.0.0.1:50833/api/abaaba-paint/handoff.svg?sessionId=session-curator&artifactId=${encodeURIComponent(artifact.artifactId)}`));
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /image\/svg\+xml/);

  const action = createActionHandler(stores, ctx);
  const request = new Request('http://127.0.0.1:50833/api/abaaba-paint/action', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-abaaba-paint': '1',
      origin: 'http://127.0.0.1:50833',
    },
    body: JSON.stringify({ action: 'import', artifactId: artifact.artifactId, replace: true, revision: curator.revision, sessionId: 'session-curator' }),
  });
  const imported = await action(request);
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).imported, true);
  assert.equal(curator.snapshot().count, 1);
});

test('rejects a handoff import if the canvas changes while the artifact is read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-handoff-race-'));
  const { ctx } = makeContext(root);
  const artist = new PaintStore();
  await ensureWorkspace(ctx, artist, { agent: { id: 'session-artist', session: {} } }, { reset: true });
  artist.create({ width: 240, height: 160, title: 'race' });
  artist.draw([{ type: 'circle', cx: 20, cy: 20, r: 5, fill: '#fff' }]);
  const artifact = createArtifact(artist, { agentId: 'session-artist' });
  await writeArtifact(ctx, artist, artifact);

  const curator = new PaintStore();
  await ensureWorkspace(ctx, curator, { agent: { id: 'session-curator', session: {} } }, { reset: true });
  const originalRead = ctx.fs.readText;
  ctx.fs.readText = async (target) => {
    const raw = await originalRead(target);
    curator.draw([{ type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#fff' }]);
    return raw;
  };
  const handler = createActionHandler(new Map([['session-curator', curator]]), ctx);
  const response = await handler(new Request('http://127.0.0.1:50833/api/abaaba-paint/action', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-abaaba-paint': '1',
      origin: 'http://127.0.0.1:50833',
    },
    body: JSON.stringify({ action: 'import', artifactId: artifact.artifactId, replace: true, revision: curator.revision, sessionId: 'session-curator' }),
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PAINT_STALE');
  assert.equal(curator.snapshot().count, 1);
  assert.equal(curator.snapshot().title, 'Abaaba 画室');
});

test('HTTP save and reload operate on the same workspace snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-http-persist-'));
  const { ctx } = makeContext(root);
  const store = new PaintStore();
  const exec = { agent: { id: 'session-test', session: {} } };
  await ensureWorkspace(ctx, store, exec, { reset: true });
  store.create({ width: 320, height: 200, title: 'http persisted' });
  store.draw([{ type: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#F2C879' }]);
  assert.equal((await saveWorkspace(ctx, store)).saved, true);

  const handler = createActionHandler(store, ctx);
  const headers = {
    'content-type': 'application/json',
    'x-abaaba-paint': '1',
    origin: 'http://127.0.0.1:50833',
  };
  const request = (body) => new Request('http://127.0.0.1:50833/api/abaaba-paint/action', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const saved = await handler(request({ action: 'save', revision: store.revision }));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).saved, true);

  store.draw([{ type: 'rect', x: 10, y: 10, w: 20, h: 20, fill: '#fff' }]);
  const reloaded = await handler(request({ action: 'reload', revision: store.revision }));
  assert.equal(reloaded.status, 200);
  const body = await reloaded.json();
  assert.equal(body.loaded, true);
  assert.equal(body.value.count, 1);
});

test('rejects traversal, absolute paths, reserved names, and symlinked exports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-smoke-'));
  const { tools } = makeContext(root);
  const exec = { agent: { id: 'session-test', session: {} } };
  for (const bad of ['../evil.svg', 'C:\\Windows\\evil.svg', 'art/a.svg:evil', 'CON.svg', 'art/name.svg.']) {
    await assert.rejects(() => tools.get('paint_export').execute({ path: bad }, exec), /path|relative|reserved|dot|stream/i);
  }
});

test('mutating tools and state loading are exclusive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-smoke-'));
  const { tools } = makeContext(root);
  assert.equal(tools.get('paint_draw').isConcurrencySafe(), false);
  assert.equal(tools.get('paint_create').isConcurrencySafe(), false);
  assert.equal(tools.get('paint_state').isConcurrencySafe(), false);
});
