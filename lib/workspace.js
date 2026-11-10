/**
 * Per-session workspace persistence for dsh-abaaba-paint.
 *
 * Each Session owns its own snapshot pair in its working directory:
 *   abaaba-paint-<sessionId>.json
 *   abaaba-paint-<sessionId>.svg
 *
 * The file names are derived only from a validated Session id; no
 * caller-supplied path reaches the filesystem. Reads and writes go through
 * ctx.fs, so canonical containment, symlink checks and the Session's own
 * sandbox policy apply.
 */

import {
  MAX_EXPORT_BYTES,
  MAX_STATE_FILE_BYTES,
  PaintError,
} from './engine.js';

const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function workspaceFileStem(sessionId) {
  const id = String(sessionId ?? '');
  if (!SAFE_SESSION_ID.test(id)) {
    throw new PaintError('session id is not safe for a workspace file name');
  }
  return id;
}

export function workspaceStateFile(sessionId) {
  return `abaaba-paint-${workspaceFileStem(sessionId)}.json`;
}

export function workspaceSvgFile(sessionId) {
  return `abaaba-paint-${workspaceFileStem(sessionId)}.svg`;
}

function messageOf(error, fallback) {
  return error instanceof PaintError ? error.message : fallback;
}

export async function ensureWorkspace(ctx, store, exec, { load = true, reset = false, replace = false } = {}) {
  if (!exec.agent) throw new PaintError('a paint operation requires an owning agent session');
  const sessionId = workspaceFileStem(exec.agent.id);
  const cwd = ctx.workingDirectory.get(exec.agent.session);
  const stateFile = workspaceStateFile(sessionId);
  const svgFile = workspaceSvgFile(sessionId);
  if (store.workspace?.sessionId !== sessionId || store.workspace?.cwd !== cwd) {
    if (store.workspace) store.resetForWorkspace();
    const root = await ctx.fs.resolve(cwd);
    const jsonTarget = await ctx.fs.resolve(stateFile, { cwd });
    const svgTarget = await ctx.fs.resolve(svgFile, { cwd });
    if (!ctx.fs.contains(root, jsonTarget) || !ctx.fs.contains(root, svgTarget)) {
      throw new PaintError('workspace canvas path is outside the Session working directory');
    }
    store.bindWorkspace({
      sessionId,
      cwd,
      root,
      session: exec.agent.session,
      stateFile,
      svgFile,
      jsonTarget,
      svgTarget,
      loaded: false,
    });
  }
  if (reset) {
    const before = await ctx.fs.lstat(store.workspace.stateFile, { cwd });
    if (before?.type === 'symlink') throw new PaintError('workspace canvas must not be a symbolic link');
    if (before?.type === 'directory') throw new PaintError('workspace canvas path is a directory');
    const existing = await ctx.fs.stat(store.workspace.jsonTarget);
    if (existing && !replace) {
      throw new PaintError('workspace already has a saved canvas for this Session; pass replace:true to start over');
    }
    store.workspace.loaded = true;
    return store.workspace;
  }
  if (load && !store.workspace.loaded) await loadWorkspace(ctx, store);
  return store.workspace;
}

export async function loadWorkspace(ctx, store) {
  if (!store.workspace) return { loaded: false, reason: 'unbound' };
  const { cwd, jsonTarget, stateFile } = store.workspace;
  const before = await ctx.fs.lstat(stateFile, { cwd });
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
    await writeTarget(ctx, store, store.workspace.jsonTarget, store.workspace.stateFile, json, policy);
    await writeTarget(ctx, store, store.workspace.svgTarget, store.workspace.svgFile, svg, policy);
  } catch (error) {
    const message = messageOf(error, 'workspace canvas could not be saved');
    store.markSaveError(message);
    return { saved: false, reason: 'write-failed', error: message };
  }
  store.markSaved(Date.now());
  return {
    saved: true,
    workspace: store.workspace.cwd,
    files: [store.workspace.stateFile, store.workspace.svgFile],
    savedAt: store.savedAt,
  };
}
