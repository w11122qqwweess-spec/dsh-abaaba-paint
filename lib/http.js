/**
 * Authenticated same-origin HTTP surface for the paint panel.
 *
 * These handlers are mounted through ctx.connection.fetch, which authenticates
 * the browser peer and restores Host/Origin checks before the request reaches
 * this module. The extra checks below keep mutations POST-only and reject
 * simple cross-site submissions and prototype-pollution shapes.
 */

import { MAX_EXPORT_BYTES, PaintError, PaintStore } from './engine.js';
import { loadWorkspace, saveWorkspace } from './workspace.js';
import { listArtifacts, readArtifact, renderArtifactSvg } from './handoff.js';

const MAX_BODY_BYTES = 64 * 1024;
const CUSTOM_HEADER = 'x-abaaba-paint';
const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function failure(status, code, message) {
  return json({ ok: false, code, message }, status);
}

function sessionStore(stores, sessionId) {
  if (!(stores instanceof Map)) return { store: stores, sessionId: null };
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    return { error: failure(400, 'PAINT_SESSION_REQUIRED', 'a valid sessionId is required') };
  }
  const store = stores.get(sessionId);
  if (!store) return { error: failure(404, 'PAINT_SESSION_NOT_FOUND', 'paint canvas has not been opened for this Session') };
  return { store, sessionId };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeShape(value, depth = 0) {
  if (depth > 8) throw new PaintError('request body is nested too deeply', 'PAINT_BAD_BODY');
  if (Array.isArray(value)) {
    if (value.length > 1024) throw new PaintError('request body array is too large', 'PAINT_BAD_BODY');
    for (const item of value) assertSafeShape(item, depth + 1);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new PaintError('request body contains a forbidden key', 'PAINT_BAD_BODY');
    }
    assertSafeShape(child, depth + 1);
  }
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return { error: failure(413, 'PAINT_BODY_TOO_LARGE', 'request body is too large') };
  }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return { error: failure(415, 'PAINT_JSON_REQUIRED', 'content-type must be application/json') };
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return { error: failure(413, 'PAINT_BODY_TOO_LARGE', 'request body is too large') };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: failure(400, 'PAINT_BAD_JSON', 'request body is not valid JSON') };
  }
  try {
    assertSafeShape(value);
  } catch {
    return { error: failure(400, 'PAINT_BAD_BODY', 'request body has an unsupported shape') };
  }
  if (!isPlainObject(value)) return { error: failure(400, 'PAINT_BAD_BODY', 'request body must be an object') };
  return { value };
}

function sameOrigin(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function createStateHandler(stores) {
  return async function stateHandler(request) {
    if (request.method !== 'GET') return failure(405, 'PAINT_METHOD', 'method not allowed');
    const sessionId = new URL(request.url).searchParams.get('sessionId');
    if (!(stores instanceof Map)) {
      const store = stores;
      const etag = store.etag ?? `"paint-${store.revision}"`;
      if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-store' } });
      }
      return json({ ok: true, value: store.snapshot() }, 200, { etag });
    }
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
      return failure(400, 'PAINT_SESSION_REQUIRED', 'a valid sessionId is required');
    }
    let store = stores.get(sessionId);
    if (!store) {
      store = new PaintStore();
      stores.set(sessionId, store);
      if (stores.size > 64) {
        const oldest = stores.keys().next().value;
        if (oldest !== sessionId) stores.delete(oldest);
      }
    }
    const etag = store.etag ?? `"paint-${store.revision}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-store' } });
    }
    return json({ ok: true, value: store.snapshot() }, 200, { etag });
  };
}

export function createActionHandler(stores, ctx = null) {
  return async function actionHandler(request) {
    if (request.method !== 'POST') return failure(405, 'PAINT_METHOD', 'method not allowed');
    if (!sameOrigin(request)) return failure(403, 'PAINT_ORIGIN', 'request origin is not allowed');
    if (request.headers.get(CUSTOM_HEADER) !== '1') return failure(403, 'PAINT_HEADER', 'missing paint request header');
    const parsed = await readJson(request);
    if (parsed.error) return parsed.error;
    const body = parsed.value;
    if (Object.keys(body).some((key) => !['action', 'steps', 'revision', 'sessionId', 'artifactId', 'replace'].includes(key))) {
      return failure(400, 'PAINT_BAD_BODY', 'request body contains unknown fields');
    }
    const resolved = sessionStore(stores, body.sessionId);
    if (resolved.error) return resolved.error;
    const { store } = resolved;
    if (!Number.isInteger(body.revision) || body.revision < 0) {
      return failure(400, 'PAINT_BAD_BODY', 'revision must be a non-negative integer');
    }
    if (body.revision !== store.revision) {
      return json({ ok: false, code: 'PAINT_STALE', revision: store.revision }, 409);
    }
    try {
      if (body.action === 'undo') {
        const steps = body.steps ?? 1;
        if (!Number.isInteger(steps) || steps < 1 || steps > 50) {
          return failure(400, 'PAINT_BAD_BODY', 'steps must be an integer between 1 and 50');
        }
        const result = store.undo(steps);
        const saved = ctx ? await saveWorkspace(ctx, store) : null;
        return json({ ok: true, value: result, ...(saved ? { saved: saved.saved, saveError: store.saveError } : {}) });
      }
      if (body.action === 'clear') {
        const result = store.clear();
        const saved = ctx ? await saveWorkspace(ctx, store) : null;
        return json({ ok: true, value: result, ...(saved ? { saved: saved.saved, saveError: store.saveError } : {}) });
      }
      if (body.action === 'save') {
        if (!ctx) return failure(503, 'PAINT_UNAVAILABLE', 'workspace persistence is unavailable');
        if (!store.workspace) return failure(409, 'PAINT_UNBOUND', 'canvas is not bound to a workspace yet');
        const saved = await saveWorkspace(ctx, store);
        if (!saved.saved) return failure(500, 'PAINT_SAVE_FAILED', saved.error ?? 'workspace save failed');
        return json({ ok: true, saved: true, savedAt: store.savedAt, workspace: store.workspace.cwd });
      }
      if (body.action === 'import') {
        if (typeof body.artifactId !== 'string') return failure(400, 'PAINT_BAD_BODY', 'artifactId is required');
        if (store.elements.length > 0 && body.replace !== true) {
          return failure(409, 'PAINT_REPLACE_REQUIRED', 'current canvas is not empty; pass replace:true');
        }
        const artifact = await readArtifact(ctx, store, body.artifactId);
        store.loadSerialized(JSON.stringify(artifact.canvas));
        const saved = await saveWorkspace(ctx, store);
        return json({ ok: true, imported: true, artifactId: artifact.artifactId, saved: saved.saved, saveError: store.saveError, value: store.summary() });
      }
      if (body.action === 'reload') {
        if (!ctx) return failure(503, 'PAINT_UNAVAILABLE', 'workspace persistence is unavailable');
        if (!store.workspace) return failure(409, 'PAINT_UNBOUND', 'canvas is not bound to a workspace yet');
        const loaded = await loadWorkspace(ctx, store);
        return json({ ok: true, loaded: loaded.loaded, reason: loaded.reason ?? null, value: store.summary() });
      }
      return failure(400, 'PAINT_BAD_ACTION', 'unknown paint action');
    } catch (error) {
      if (error instanceof PaintError) return failure(400, error.code, error.message);
      return failure(500, 'PAINT_INTERNAL', 'paint action failed');
    }
  };
}

export function createHandoffListHandler(stores, ctx) {
  return async function handoffListHandler(request) {
    if (request.method !== 'GET') return failure(405, 'PAINT_METHOD', 'method not allowed');
    const resolved = sessionStore(stores, new URL(request.url).searchParams.get('sessionId'));
    if (resolved.error) return resolved.error;
    const { store } = resolved;
    if (!store.workspace) return failure(409, 'PAINT_UNBOUND', 'canvas is not bound to a workspace yet');
    try {
      return json({ ok: true, ...(await listArtifacts(ctx, store)) });
    } catch (error) {
      if (error instanceof PaintError) return failure(400, error.code, error.message);
      return failure(500, 'PAINT_HANDOFF_FAILED', 'handoff listing failed');
    }
  };
}

export function createHandoffSvgHandler(stores, ctx) {
  return async function handoffSvgHandler(request) {
    if (request.method !== 'GET') return failure(405, 'PAINT_METHOD', 'method not allowed');
    const url = new URL(request.url);
    const resolved = sessionStore(stores, url.searchParams.get('sessionId'));
    if (resolved.error) return resolved.error;
    const { store } = resolved;
    if (!store.workspace) return failure(409, 'PAINT_UNBOUND', 'canvas is not bound to a workspace yet');
    const artifactId = url.searchParams.get('artifactId');
    try {
      const artifact = await readArtifact(ctx, store, artifactId);
      const svg = renderArtifactSvg(artifact);
      return new Response(svg, {
        status: 200,
        headers: {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (error) {
      if (error instanceof PaintError) return failure(400, error.code, error.message);
      return failure(500, 'PAINT_HANDOFF_FAILED', 'handoff preview failed');
    }
  };
}

export function createExportHandler(stores) {
  return async function exportHandler(request) {
    if (request.method !== 'GET') return failure(405, 'PAINT_METHOD', 'method not allowed');
    const resolved = sessionStore(stores, new URL(request.url).searchParams.get('sessionId'));
    if (resolved.error) return resolved.error;
    const { store } = resolved;
    try {
      const svg = store.renderSvg();
      if (Buffer.byteLength(svg, 'utf8') > MAX_EXPORT_BYTES) {
        return failure(413, 'PAINT_EXPORT_TOO_LARGE', 'rendered SVG exceeds the export size limit');
      }
      return new Response(svg, {
        status: 200,
        headers: {
          'content-type': 'image/svg+xml; charset=utf-8',
          'content-disposition': 'attachment; filename="abaaba-paint.svg"',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (error) {
      if (error instanceof PaintError) return failure(400, error.code, error.message);
      return failure(500, 'PAINT_INTERNAL', 'paint export failed');
    }
  };
}
