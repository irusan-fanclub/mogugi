// Builds mogugi/releases.json for the 魔古工坊 release page from the GitHub
// release list and the keys that already exist on R2. A download link is only
// written when its file is on R2, so the page never points at a missing file.
//
//   node releases-json.mjs <gh-releases.json> <r2-keys.txt>   > releases.json
//   node releases-json.mjs --latest <releases.json>            prints newest tag
//   node releases-json.mjs --latest-gh <gh-releases.json>      newest published tag
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const published = (r) => !r.draft && !r.prerelease && !!r.published_at;

function sortedPublished(ghReleases) {
  return ghReleases.filter(published)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
}

export function buildReleases(ghReleases, r2Keys, { dlBase, prefix, limit = 10, now = new Date() }) {
  const releases = sortedPublished(ghReleases).slice(0, limit).map((r) => {
    const pick = (ext) => {
      const a = (r.assets || []).find((x) => x.name.startsWith('mogugi_') && x.name.endsWith(ext));
      const key = a && `${prefix}/${r.tag_name}/${a.name}`;
      return key && r2Keys.has(key) ? { name: a.name, url: `${dlBase}/${key}` } : null;
    };
    return {
      tag: r.tag_name,
      publishedAt: r.published_at,
      url: r.html_url,
      body: r.body ?? '',
      exe: pick('.exe'),
      zip: pick('.zip'),
    };
  });
  return { schema: 1, generatedAt: now.toISOString(), releases };
}

export function latestTag(json) {
  return json?.releases?.[0]?.tag ?? null;
}

function main(argv) {
  const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
  if (argv[0] === '--latest') return console.log(latestTag(read(argv[1])) ?? '');
  if (argv[0] === '--latest-gh') return console.log(sortedPublished(read(argv[1]))[0]?.tag_name ?? '');
  const [ghFile, keysFile] = argv;
  const keys = new Set(readFileSync(keysFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  const out = buildReleases(read(ghFile), keys, {
    dlBase: process.env.DL_BASE || 'https://cdn.elden-mogu.com',
    prefix: process.env.R2_PREFIX || 'mogugi',
  });
  process.stdout.write(JSON.stringify(out) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
