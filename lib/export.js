/**
 * Export confined to the Session's working directory through ctx.fs.
 *
 * The resolver rejects traversal, absolute paths, NTFS alternate data streams,
 * reserved device names, and a final symlink. The write itself is guarded by
 * ctx.fs.createIfAbsent (or replaceIfVersion for an explicit overwrite).
 */

import path from 'node:path';
import { MAX_EXPORT_BYTES, PaintError } from './engine.js';

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function normalizeRelativeSvgPath(raw) {
  if (typeof raw !== 'string') throw new PaintError('path must be a string');
  if (raw.length === 0 || raw.length > 200) throw new PaintError('path must be 1 to 200 characters');
  if (raw.includes('\0')) throw new PaintError('path must not contain NUL');
  if (raw.includes(':')) throw new PaintError('path must not contain a drive or alternate stream');
  if (/^[\\/]/.test(raw) || /^[A-Za-z]:/.test(raw) || /^\\\\/.test(raw)) {
    throw new PaintError('path must be relative to the Session working directory');
  }
  const parts = raw.replaceAll('\\', '/').split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new PaintError('path must not contain empty, . or .. segments');
  }
  for (const part of parts) {
    if (/[\u0000-\u001f<>"|?*]/.test(part)) throw new PaintError('path contains a forbidden character');
    if (part.endsWith('.') || part.endsWith(' ')) throw new PaintError('path segments must not end with a dot or space');
    const stem = part.replace(/\.[^.]*$/, '').trim();
    if (stem.length === 0) throw new PaintError('path segment needs a non-empty name');
    if (RESERVED.test(stem)) throw new PaintError('path uses a reserved device name');
  }
  const filename = parts.at(-1);
  if (!filename.toLowerCase().endsWith('.svg') || filename.toLowerCase() === '.svg') {
    throw new PaintError('export path must end with .svg and have a non-empty name');
  }
  return parts.join('/');
}

export async function exportSvg(ctx, exec, store, { path: rawPath, overwrite = false }) {
  if (!exec.agent) throw new PaintError('paint_export requires an owning agent session');
  const relative = normalizeRelativeSvgPath(rawPath);
  const cwd = ctx.workingDirectory.get(exec.agent.session);
  const root = await ctx.fs.resolve(cwd);
  const target = await ctx.fs.resolve(relative, { cwd });
  if (!ctx.fs.contains(root, target)) throw new PaintError('export target is outside the Session working directory');

  const before = await ctx.fs.lstat(relative, { cwd });
  if (before?.type === 'symlink') throw new PaintError('export target must not be a symbolic link');
  if (before?.type === 'directory') throw new PaintError('export target is a directory');

  const existing = await ctx.fs.stat(target);
  if (existing && !overwrite) throw new PaintError('export target already exists; pass overwrite:true to replace it');
  if (existing && existing.type !== 'file') throw new PaintError('export target is not a regular file');

  const svg = store.renderSvg();
  const bytes = Buffer.byteLength(svg, 'utf8');
  if (bytes > MAX_EXPORT_BYTES) throw new PaintError('rendered SVG exceeds the export size limit');

  const intent = existing ? { kind: 'replaceIfVersion', version: existing.version } : { kind: 'createIfAbsent' };
  // Resolve the Session's own policy; never hard-code a wider mode than the
  // session already has. If the optional service is absent, let the fs backend
  // apply its default rather than inventing one.
  const sandboxPolicy = ctx.get?.('sandboxPolicy')?.resolve({ session: exec.agent.session });
  await ctx.fs.writeText(target, svg, intent, undefined, sandboxPolicy);
  return {
    path: path.posix.normalize(relative),
    bytes,
    revision: store.revision,
    overwritten: Boolean(existing),
  };
}
