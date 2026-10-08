import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/portfolio-v8.js', import.meta.url), 'utf8');

test('selected page has no composition editor or editor initialization', () => {
  assert.doesNotMatch(html, /id="(?:composition|poster|poster-input|download-composition)"/);
  assert.doesNotMatch(app, /initComposition|typography-editor/);
});

test('all page fragment links resolve and IDs are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, fragment] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(fragment), `Missing anchor: ${fragment}`);
  }
});

test('scene, atmosphere, GitHub and motion control hooks remain present', () => {
  for (const id of ['site-particles', 'motion', 'hero-stage', 'hero-canvas', 'scene-note', 'toggle-scene', 'github-activity', 'motion-toggle']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, /<canvas id="site-particles" aria-hidden="true"/);
  assert.match(html, /id="github-activity" data-github-activity aria-busy="true"/);
  assert.match(html, /class="motion-section" id="motion" tabindex="-1"/);
});
