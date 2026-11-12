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

const editJob = wf.slice(wf.indexOf('  announce-edit:'), wf.indexOf('  # mogugi/releases.json'));

test('no webhook or zip attachment remains', () => {
  assert.doesNotMatch(wf, /DISCORD_WEBHOOK_URL|files\[0\]|8000000/);
});

test('announce posts to supermogugi with the release key', () => {
  assert.match(wf, /mogugi\/release/);
  assert.match(wf, /X-Release-Key: \$\{\{ secrets\.MOGUGI_RELEASE_KEY \}\}/);
});

test('edit job sends edited without downloads', () => {
  assert.ok(editJob.length > 0);
  assert.match(editJob, /action: "edited"/);
  assert.doesNotMatch(editJob, /downloads/);
});

test('announce failures alert ops', () => {
  assert.match(wf, /mogugi 公告發送失敗/);
});
