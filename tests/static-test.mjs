import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { normalizeDraft } from '../src/project-brief.js';

test('draft accepts only known services and bounded plain text', () => {
  assert.deepEqual(normalizeDraft(null), { text: '', services: [] });
  assert.deepEqual(normalizeDraft({text: 'a'.repeat(2100), services:['frontend','frontend','secret','__proto__']}), {text:'a'.repeat(2000),services:['frontend']});
});
test('frontend contains no API endpoint or server demo controls', async () => {
  for (const file of await readdir(new URL('../src/', import.meta.url))) {
    assert.doesNotMatch(await readFile(new URL('../src/' + file, import.meta.url), 'utf8'), /\/api\/|brief-network|SQLite|Idempotency-Key/);
  }
});
test('HTML assets support subdirectory hosting', async () => {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:href|src)="\//);
});
test('published snapshot is aggregate-only and its totals match every day', async () => {
  const data = JSON.parse(await readFile(new URL('../public/github-activity.json', import.meta.url), 'utf8'));
  const kinds = ['commits','pullRequests','issues','reviews','comments'];
  assert.equal(data.status, 'snapshot');
  assert.equal(data.days.length, data.totals.days);
  assert.equal(data.days[0].date, data.range.from);
  assert.equal(data.days.at(-1).date, data.range.to);
  for (const [index, day] of data.days.entries()) {
    assert.deepEqual(Object.keys(day).sort(), ['breakdown','count','date','level']);
    assert.deepEqual(Object.keys(day.breakdown).sort(), [...kinds].sort());
    assert.equal(day.date, new Date(Date.parse(data.range.from) + index * 86400000).toISOString().slice(0,10));
    assert.ok(kinds.every(kind => Number.isSafeInteger(day.breakdown[kind]) && day.breakdown[kind] >= 0));
    assert.equal(day.count, kinds.reduce((sum, kind) => sum + day.breakdown[kind], 0));
  }
  for (const kind of kinds) assert.equal(data.totals[kind], data.days.reduce((sum, day) => sum + day.breakdown[kind], 0));
  assert.equal(data.totals.contributions, data.days.reduce((sum, day) => sum + day.count, 0));
  assert.equal(data.totals.activeDays, data.days.filter(day => day.count > 0).length);
});
