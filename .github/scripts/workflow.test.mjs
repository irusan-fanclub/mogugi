import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = readFileSync(new URL('../workflows/discord-release.yml', import.meta.url), 'utf8');
const job = wf.slice(wf.indexOf('  releases-json:'));

test('verify fetch sends the site Origin and requires the CORS header', () => {
  assert.match(job, /-H 'Origin: https:\/\/mabinogi\.elden-mogu\.com'/);
  assert.match(job, /access-control-allow-origin/i);
});

test('verify compares generatedAt, not just the newest tag', () => {
  assert.match(job, /jq -r \.generatedAt live\.json/);
  assert.match(job, /jq -r \.generatedAt releases\.json/);
});
