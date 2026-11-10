/**
 * Cross-Session handoff artifacts.
 *
 * An artifact is a single bounded JSON file at the workspace root:
 *   abaaba-paint-handoff-<artifactId>.json
 *
 * It carries only the canonical canvas document. The preview SVG is always
 * regenerated from that document by this plugin's own renderer, never trusted
 * from the file, so a tampered artifact cannot smuggle script markup into the
 * preview route.
 */

import {
  MAX_EXPORT_BYTES,
  MAX_STATE_FILE_BYTES,
  PaintError,
  PaintStore,
} from './engine.js';

export const HANDOFF_FORMAT = 'dsh-abaaba-paint-handoff';
export const HANDOFF_VERSION = 1;
export const HANDOFF_PREFIX = 'abaaba-paint-handoff-';
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_ARTIFACTS = 50;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{8,80}$/;
const SOURCE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export function makeArtifactId(now = Date.now()) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function artifactFilename(artifactId) {
  const id = String(artifactId ?? '');
  if (!ARTIFACT_ID.test(id)) throw new PaintError('invalid handoff artifact id');
  return `${HANDOFF_PREFIX}${id}.json`;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bad(message) {
  throw new PaintError(message);
}

export function createArtifact(store, { agentId, name } = {}) {
  if (typeof agentId !== 'string' || !SOURCE_ID.test(agentId)) bad('handoff source agent id is invalid');
  const canvas = JSON.parse(store.serialize());
  return {
    format: HANDOFF_FORMAT,
    version: HANDOFF_VERSION,
    artifactId: makeArtifactId(),
    createdAt: Date.now(),
    source: {
      agentId,
      ...(typeof name === 'string' && name.trim() !== '' ? { name: name.trim().slice(0, 120) } : {}),
    },
    canvas,
  };
}

export function parseArtifact(raw) {
  if (typeof raw !== 'string') bad('handoff artifact must be text');
  if (Buffer.byteLength(raw, 'utf8') > MAX_ARTIFACT_BYTES) bad('handoff artifact is too large');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    bad('handoff artifact is not valid JSON');
  }
  if (!isObject(data)) bad('handoff artifact must be an object');
  const allowed = new Set(['format', 'version', 'artifactId', 'createdAt', 'source', 'canvas']);
  for (const key of Object.keys(data)) if (!allowed.has(key)) bad(`handoff artifact has unknown field "${key}"`);
  if (data.format !== HANDOFF_FORMAT || data.version !== HANDOFF_VERSION) bad('unsupported handoff artifact format');
  if (typeof data.artifactId !== 'string' || !ARTIFACT_ID.test(data.artifactId)) bad('invalid handoff artifact id');
  if (typeof data.createdAt !== 'number' || !Number.isSafeInteger(data.createdAt) || data.createdAt < 0) {
    bad('invalid handoff createdAt');
  }
  if (!isObject(data.source) || typeof data.source.agentId !== 'string' || !SOURCE_ID.test(data.source.agentId)) {
    bad('invalid handoff source');
  }
  const sourceKeys = Object.keys(data.source);
  if (sourceKeys.some((key) => key !== 'agentId' && key !== 'name')) bad('handoff source has unknown fields');
  if (data.source.name !== undefined && (typeof data.source.name !== 'string' || data.source.name.length > 120)) {
    bad('invalid handoff source name');
  }
  if (!isObject(data.canvas)) bad('handoff canvas must be an object');
  const canvasBytes = Buffer.byteLength(JSON.stringify(data.canvas), 'utf8');
  if (canvasBytes > MAX_STATE_FILE_BYTES) bad('handoff canvas is too large');
  const probe = new PaintStore();
  probe.loadSerialized(JSON.stringify(data.canvas));
  return {
    format: HANDOFF_FORMAT,
    version: HANDOFF_VERSION,
    artifactId: data.artifactId,
    createdAt: data.createdAt,
    source: { agentId: data.source.agentId, ...(data.source.name === undefined ? {} : { name: data.source.name }) },
    canvas: JSON.parse(probe.serialize()),
    summary: probe.summary(),
  };
}

export function renderArtifactSvg(artifact) {
  const store = new PaintStore();
  store.loadSerialized(JSON.stringify(artifact.canvas));
  const svg = store.renderSvg();
  if (Buffer.byteLength(svg, 'utf8') > MAX_EXPORT_BYTES) bad('handoff preview exceeds the export size limit');
  return svg;
}

export async function writeArtifact(ctx, store, artifact) {
  if (!store.workspace) bad('handoff requires a bound workspace');
  const path = artifactFilename(artifact.artifactId);
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  if (Buffer.byteLength(json, 'utf8') > MAX_ARTIFACT_BYTES) bad('handoff artifact is too large');
  const target = await ctx.fs.resolve(path, { cwd: store.workspace.cwd });
  if (!ctx.fs.contains(store.workspace.root, target)) bad('handoff path is outside the workspace');
  const before = await ctx.fs.lstat(path, { cwd: store.workspace.cwd });
  if (before?.type === 'symlink') bad('handoff target must not be a symbolic link');
  if (before?.type === 'directory') bad('handoff target is a directory');
  const existing = await ctx.fs.stat(target);
  if (existing) bad('handoff artifact already exists');
  const policy = ctx.get?.('sandboxPolicy')?.resolve({ session: store.workspace.session });
  await ctx.fs.writeText(target, json, { kind: 'createIfAbsent' }, undefined, policy);
  return { path, bytes: Buffer.byteLength(json, 'utf8'), summary: artifact.summary };
}

export async function listArtifacts(ctx, store) {
  if (!store.workspace) bad('handoff requires a bound workspace');
  const entries = await ctx.fs.listDir(store.workspace.root);
  const candidates = entries
    .filter((entry) => entry.type === 'file' && entry.name.startsWith(HANDOFF_PREFIX) && entry.name.endsWith('.json'))
    .slice(0, MAX_ARTIFACTS);
  const artifacts = [];
  let totalBytes = 0;
  for (const entry of candidates) {
    try {
      const info = await ctx.fs.stat(entry.target);
      if (!info || info.type !== 'file' || (typeof info.size === 'number' && info.size > MAX_ARTIFACT_BYTES)) continue;
      const size = typeof info.size === 'number' ? info.size : 0;
      if (totalBytes + size > 16 * 1024 * 1024) continue;
      totalBytes += size;
      const raw = await ctx.fs.readText(entry.target);
      const artifact = parseArtifact(raw);
      artifacts.push({
        artifactId: artifact.artifactId,
        createdAt: artifact.createdAt,
        source: artifact.source,
        title: artifact.summary.title,
        width: artifact.summary.width,
        height: artifact.summary.height,
        count: artifact.summary.count,
        revision: artifact.summary.revision,
        path: entry.name,
      });
    } catch {
      // One damaged artifact must not hide the rest of the handoff inbox.
    }
  }
  artifacts.sort((a, b) => b.createdAt - a.createdAt);
  return { artifacts, workspace: store.workspace.cwd };
}

export async function readArtifact(ctx, store, artifactId) {
  if (!store.workspace) bad('handoff requires a bound workspace');
  const path = artifactFilename(artifactId);
  const target = await ctx.fs.resolve(path, { cwd: store.workspace.cwd });
  if (!ctx.fs.contains(store.workspace.root, target)) bad('handoff path is outside the workspace');
  const before = await ctx.fs.lstat(path, { cwd: store.workspace.cwd });
  if (before?.type === 'symlink') bad('handoff target must not be a symbolic link');
  const info = await ctx.fs.stat(target);
  if (!info) bad('handoff artifact not found');
  if (info.type !== 'file') bad('handoff target is not a regular file');
  if (typeof info.size === 'number' && info.size > MAX_ARTIFACT_BYTES) bad('handoff artifact is too large');
  const raw = await ctx.fs.readText(target);
  return parseArtifact(raw);
}
