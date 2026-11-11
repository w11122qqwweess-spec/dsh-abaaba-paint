import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('client bundle declares the package id and three live slots', async () => {
  const source = await fs.readFile(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /id:\s*'dsh-abaaba-paint'/);
  assert.match(source, /name:\s*'sidebar\.panellist'/);
  assert.match(source, /id:\s*'abaaba-paint'/);
  assert.match(source, /name:\s*'main'/);
  assert.match(source, /key:\s*'abaaba-paint'/);
  assert.match(source, /name:\s*'conversation\.view'/);
  assert.match(source, /id:\s*'abaaba-paint',\s*order:\s*40/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|new Function|eval\(/);
});

test('manifest exposes a bundle patch, a web client, and compatibility metadata', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'dsh-abaaba-paint');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.client.immediately, true);
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.1-rc.3'], 'compatible');
  assert.equal(manifest.engines.node, '>=22.19.0');
  assert.ok(manifest.files.includes('client.js'));
  assert.ok(manifest.files.includes('README.md'));
});
