import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReleases, latestTag } from './releases-json.mjs';

const opts = { dlBase: 'https://cdn.elden-mogu.com', prefix: 'mogugi', now: new Date('2026-11-07T00:00:00Z') };

function gh(tag, published_at, extra = {}) {
  const v = tag.slice(1);
  return {
    tag_name: tag, published_at, draft: false, prerelease: false, body: `notes ${tag}`,
    html_url: `https://github.com/irusan-fanclub/mogugi/releases/tag/${tag}`,
    assets: [{ name: `mogugi_${v}.exe` }, { name: `mogugi_${v}.zip` }, { name: 'checksums.txt' }],
    ...extra,
  };
}

const keysFor = (...tags) => new Set(tags.flatMap((t) => [`mogugi/${t}/mogugi_${t.slice(1)}.exe`, `mogugi/${t}/mogugi_${t.slice(1)}.zip`]));

test('excludes drafts and prereleases', () => {
  const out = buildReleases([
    gh('v0.6.1', '2026-11-05T16:57:54Z'),
    gh('v0.7.0-beta', '2026-11-06T00:00:00Z', { prerelease: true }),
    gh('v0.7.0', '2026-11-06T01:00:00Z', { draft: true, published_at: null }),
  ], keysFor('v0.6.1'), opts);
  assert.deepEqual(out.releases.map((r) => r.tag), ['v0.6.1']);
});

test('sorts newest first and applies the limit', () => {
  const out = buildReleases([
    gh('v0.5.7', '2026-10-06T13:59:36Z'),
    gh('v0.6.1', '2026-11-05T16:57:54Z'),
    gh('v0.6.0', '2026-10-29T14:13:40Z'),
  ], new Set(), { ...opts, limit: 2 });
  assert.deepEqual(out.releases.map((r) => r.tag), ['v0.6.1', 'v0.6.0']);
});

test('only links files that exist on R2', () => {
  const out = buildReleases([gh('v0.6.1', '2026-11-05T16:57:54Z'), gh('v0.5.4', '2026-09-12T16:58:13Z')], keysFor('v0.6.1'), opts);
  const [newest, old] = out.releases;
  assert.deepEqual(newest.exe, { name: 'mogugi_0.6.1.exe', url: 'https://cdn.elden-mogu.com/mogugi/v0.6.1/mogugi_0.6.1.exe' });
  assert.deepEqual(newest.zip, { name: 'mogugi_0.6.1.zip', url: 'https://cdn.elden-mogu.com/mogugi/v0.6.1/mogugi_0.6.1.zip' });
  assert.equal(old.exe, null);
  assert.equal(old.zip, null);
});

test('ignores assets not named mogugi_*', () => {
  const r = gh('v0.6.1', '2026-11-05T16:57:54Z', { assets: [{ name: 'other.exe' }, { name: 'mogugi_0.6.1.zip' }] });
  const out = buildReleases([r], new Set(['mogugi/v0.6.1/other.exe', 'mogugi/v0.6.1/mogugi_0.6.1.zip']), opts);
  assert.equal(out.releases[0].exe, null);
  assert.equal(out.releases[0].zip.name, 'mogugi_0.6.1.zip');
});

test('keeps body and github url, stamps schema and time', () => {
  const out = buildReleases([gh('v0.6.1', '2026-11-05T16:57:54Z', { body: '### x\n- <b>' })], new Set(), opts);
  assert.equal(out.schema, 1);
  assert.equal(out.generatedAt, '2026-11-07T00:00:00.000Z');
  assert.equal(out.releases[0].body, '### x\n- <b>');
  assert.equal(out.releases[0].publishedAt, '2026-11-05T16:57:54Z');
  assert.equal(out.releases[0].url, 'https://github.com/irusan-fanclub/mogugi/releases/tag/v0.6.1');
});

test('null body becomes empty string', () => {
  const out = buildReleases([gh('v0.6.1', '2026-11-05T16:57:54Z', { body: null })], new Set(), opts);
  assert.equal(out.releases[0].body, '');
});

test('latestTag', () => {
  assert.equal(latestTag({ releases: [{ tag: 'v0.6.1' }, { tag: 'v0.6.0' }] }), 'v0.6.1');
  assert.equal(latestTag({ releases: [] }), null);
  assert.equal(latestTag(null), null);
});
