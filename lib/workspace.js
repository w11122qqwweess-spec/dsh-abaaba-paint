/**
 * Workspace persistence for dsh-abaaba-paint.
 *
 * Source of truth is a JSON document in the Session working directory; a
 * rendered SVG sits beside it for immediate preview and sharing. Both writes go
 * through ctx.fs, so canonical containment, symlink checks and the Session's
 * own sandbox policy apply. The file names are fixed; no user path reaches the
 * filesystem here.
 */

import {
  MAX_EXPORT_BYTES,
  MAX_STATE_FILE_BYTES,
  PaintError,
} from './engine.js';

export const WORKSPACE_STATE_FILE = 'abaaba-paint.json';
export const WORKSPACE_SVG_FILE = 'abaaba-paint.svg';

function messageOf(error, fallback) {
  return error instanceof PaintError ? error.message : fallback;
}

export async function ensureWorkspace(ctx, store, exec, { load = true, reset = false, replace = false } = {}) {
  if (!exec.agent) throw new PaintError('a paint operation requires an owning agent session');
  const cwd = ctx.workingDirectory.get(exec.agent.session);
  if (store.workspace?.cwd !== cwd) {
    if (store.workspace) store.resetForWorkspace();
    const root = await ctx.fs.resolve(cwd);
    const jsonTarget = await ctx.fs.resolve(WORKSPACE_STATE_FILE, { cwd });
    const svgTarget = await ctx.fs.resolve(WORKSPACE_SVG_FILE, { cwd });
    if (!ctx.fs.contains(root, jsonTarget) || !ctx.fs.contains(root, svgTarget)) {
      throw new PaintError('workspace canvas path is outside the Session working directory');
    }
    store.bindWorkspace({
      cwd,
      root,
      session: exec.agent.session,
      jsonTarget,
      svgTarget,
      loaded: false,
    });
  }
  if (reset) {
    const before = await ctx.fs.lstat(WORKSPACE_STATE_FILE, { cwd });
    if (before?.type === 'symlink') throw new PaintError('workspace canvas must not be a symbolic link');
    if (before?.type === 'directory') throw new PaintError('workspace canvas path is a directory');
    const existing = await ctx.fs.stat(store.workspace.jsonTarget);
    if (existing && !replace) {
      throw new PaintError('workspace already has a saved canvas; pass replace:true to start over');
    }
    store.workspace.loaded = true;
    return store.workspace;
  }
  if (load && !store.workspace.loaded) await loadWorkspace(ctx, store);
  return store.workspace;
}

export async function loadWorkspace(ctx, store) {
  if (!store.workspace) return { loaded: false, reason: 'unbound' };
  const { cwd, jsonTarget } = store.workspace;
  const before = await ctx.fs.lstat(WORKSPACE_STATE_FILE, { cwd });
  if (before?.type === 'symlink') throw new PaintError('workspace canvas must not be a symbolic link');
  if (before?.type === 'directory') throw new PaintError('workspace canvas path is a directory');
  const info = await ctx.fs.stat(jsonTarget);
  if (!info) {
    store.workspace.loaded = true;
    return { loaded: false, reason: 'absent' };
  }
  if (info.type !== 'file') throw new PaintError('workspace canvas is not a regular file');
  if (typeof info.size === 'number' && info.size > MAX_STATE_FILE_BYTES) {
    store.workspace.loaded = false;
    throw new PaintError('workspace canvas file is too large');
  }
  let raw;
  try {
    raw = await ctx.fs.readText(jsonTarget);
    store.loadSerialized(raw);
  } catch (error) {
    store.workspace.loaded = false;
    throw new PaintError(messageOf(error, 'workspace canvas could not be read'));
  }
  store.workspace.loaded = true;
  store.markSaved(Date.now());
  return { loaded: true, revision: store.revision, count: store.elements.length };
}

async function writeTarget(ctx, store, target, name, content, policy) {
  const { cwd } = store.workspace;
  const before = await ctx.fs.lstat(name, { cwd });
  if (before?.type === 'symlink') throw new PaintError(`workspace ${name} must not be a symbolic link`);
  if (before?.type === 'directory') throw new PaintError(`workspace ${name} path is a directory`);
  const info = await ctx.fs.stat(target);
  if (info && info.type !== 'file') throw new PaintError(`workspace ${name} is not a regular file`);
  const intent = info ? { kind: 'replaceIfVersion', version: info.version } : { kind: 'createIfAbsent' };
  return ctx.fs.writeText(target, content, intent, undefined, policy);
}

export async function saveWorkspace(ctx, store) {
  if (!store.workspace) return { saved: false, reason: 'unbound' };
  const policy = ctx.get?.('sandboxPolicy')?.resolve({ session: store.workspace.session });
  const json = store.serialize();
  const svg = store.renderSvg();
  if (Buffer.byteLength(json, 'utf8') > MAX_STATE_FILE_BYTES) {
    throw new PaintError('workspace canvas JSON exceeds the size limit');
  }
  if (Buffer.byteLength(svg, 'utf8') > MAX_EXPORT_BYTES) {
    throw new PaintError('rendered workspace SVG exceeds the export size limit');
  }
  try {
    await writeTarget(ctx, store, store.workspace.jsonTarget, WORKSPACE_STATE_FILE, json, policy);
    await writeTarget(ctx, store, store.workspace.svgTarget, WORKSPACE_SVG_FILE, svg, policy);
  } catch (error) {
    const message = messageOf(error, 'workspace canvas could not be saved');
    store.markSaveError(message);
    return { saved: false, reason: 'write-failed', error: message };
  }
  store.markSaved(Date.now());
  return {
    saved: true,
    workspace: store.workspace.cwd,
    files: [WORKSPACE_STATE_FILE, WORKSPACE_SVG_FILE],
    savedAt: store.savedAt,
  };
}
