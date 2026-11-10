import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { apply } from '../index.js';

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

test('registers six tools and three authenticated routes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-smoke-'));
  const { tools, routes } = makeContext(root);
  assert.deepEqual([...tools.keys()].sort(), [
    'paint_clear',
    'paint_create',
    'paint_draw',
    'paint_export',
    'paint_state',
    'paint_undo',
  ]);
  assert.deepEqual(routes.map((route) => route.path).sort(), [
    '/api/abaaba-paint/action',
    '/api/abaaba-paint/export.svg',
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
  const exec = { agent: { session: {} } };

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

test('rejects traversal, absolute paths, reserved names, and symlinked exports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-smoke-'));
  const { tools } = makeContext(root);
  const exec = { agent: { session: {} } };
  for (const bad of ['../evil.svg', 'C:\\Windows\\evil.svg', 'art/a.svg:evil', 'CON.svg', 'art/name.svg.']) {
    await assert.rejects(() => tools.get('paint_export').execute({ path: bad }, exec), /path|relative|reserved|dot|stream/i);
  }
});

test('mutating tools are exclusive and the state tool is parallel-safe', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abaaba-smoke-'));
  const { tools } = makeContext(root);
  assert.equal(tools.get('paint_draw').isConcurrencySafe(), false);
  assert.equal(tools.get('paint_create').isConcurrencySafe(), false);
  assert.equal(tools.get('paint_state').isConcurrencySafe(), true);
});
