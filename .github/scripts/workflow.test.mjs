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
  const envKeys = wf.match(/RELEASE_KEY: \$\{\{ secrets\.MOGUGI_RELEASE_KEY \}\}/g) ?? [];
  assert.equal(envKeys.length, 2);
  const headers = wf.match(/-H "X-Release-Key: \$RELEASE_KEY"/g) ?? [];
  assert.equal(headers.length, 2);
  assert.doesNotMatch(wf, /X-Release-Key: \$\{\{/);
  assert.equal((wf.match(/--fail-with-body/g) ?? []).length, 2);
  assert.equal((wf.match(/--data-binary @-/g) ?? []).length, 2);
});

test('edit jobs for one tag run serially', () => {
  assert.match(editJob, /group: announce-edit-\$\{\{ github\.event\.release\.tag_name \}\}/);
  assert.match(editJob, /cancel-in-progress: false/);
});

test('publish with no downloads fails before posting', () => {
  assert.match(wf, /::error::沒有可下載的檔案（R2 鏡像與 release 附件都沒有 exe\/zip）/);
});

test('edit job sends edited without downloads', () => {
  assert.ok(editJob.length > 0);
  assert.match(editJob, /action: "edited"/);
  assert.doesNotMatch(editJob, /downloads/);
});

test('announce failures alert ops', () => {
  assert.match(wf, /mogugi 公告發送失敗/);
});
