import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { initSceneController } from '../src/scene-controller.js';

// A deterministic browser surface: no WebGL, browser process, or dependencies.
class MockEventTarget {
  constructor() {
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = new Map();
    this.textContent = '';
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  emit(type, properties = {}) {
    const event = {
      type, target: this, currentTarget: this,
      button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
    return event;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}

function fixture(t, { reduced = false, coarse = false, hidden = false } = {}) {
  let now = 1000;
  let nextTimer = 0;
  const timers = new Map();
  const originals = new Map();
  const window = new MockEventTarget();
  const document = new MockEventTarget();
  const canvas = new MockEventTarget();
  const stage = new MockEventTarget();
  const note = new MockEventTarget();
  const formLabel = new MockEventTarget();
  const autoLabel = new MockEventTarget();
  const reducedMotion = Object.assign(new MockEventTarget(), { matches: reduced });
  const touchInput = Object.assign(new MockEventTarget(), { matches: coarse });
  const observers = [];
  const calls = { forms: [], energies: [], pauses: [], explosions: [] };

  Object.assign(window, { innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 0 });
  window.matchMedia = query => query.includes('prefers-reduced-motion') ? reducedMotion : touchInput;
  window.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { at: now + delay, callback });
    return id;
  };
  document.hidden = hidden;
  document.documentElement = { dataset: { motion: 'running' } };
  stage.dataset.renderer = 'three';
  stage.getBoundingClientRect = () => ({ width: 800, height: 700, top: 0, bottom: 700, left: 600, right: 1400 });
  stage.closest = selector => selector === '.hero' ? { querySelector: query => query === '.scene-auto' ? autoLabel : null } : null;

  class MockIntersectionObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }

  function replaceGlobal(name, value) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  replaceGlobal('window', window);
  replaceGlobal('document', document);
  replaceGlobal('performance', { now: () => now });
  replaceGlobal('clearTimeout', id => timers.delete(id));
  replaceGlobal('IntersectionObserver', MockIntersectionObserver);

  const scene = {
    setForm(value) { calls.forms.push(value); return value; },
    setEnergy(value) { calls.energies.push(value); return value; },
    setPaused(value) { calls.pauses.push(value); stage.dataset.paused = String(value); return value; },
    setExploded(value) { calls.explosions.push(value); return value; },
  };
  const controller = initSceneController({ scene, canvas, stage, note, formLabel });
  t.after(() => {
    controller.destroy();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  function advance(milliseconds) {
    const end = now + milliseconds;
    let executions = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++executions < 10000, 'A timer loop must not run indefinitely');
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = end;
  }

  function setVisible(value) {
    observers[0].callback([{ isIntersecting: value, intersectionRatio: value ? 1 : 0 }]);
  }

  function tap({ x = 20, y = 30, duration = 30 } = {}) {
    canvas.emit('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y });
    advance(duration);
    canvas.emit('pointerup', { pointerId: 1, clientX: x, clientY: y });
  }

  return { window, document, canvas, stage, note, formLabel, autoLabel, reducedMotion, touchInput, observers, calls, timers, controller, advance, setVisible, tap };
}

// These tests replace globals, so execute this suite sequentially.
describe('scene controller', { concurrency: false }, () => {
  test('cycles knot → orbit → wave → knot exactly every 5000 ms at full energy', t => {
    const f = fixture(t);
    assert.deepEqual(f.calls.forms, ['knot']);
    assert.deepEqual(f.calls.energies, [1]);
    assert.equal(f.stage.dataset.energy, '1.00');
    assert.equal(f.stage.dataset.cycle, 'running');
    assert.equal(f.formLabel.textContent, 'Узел');
    assert.equal(f.autoLabel.textContent, 'Автосмена · 5 сек');
    assert.equal(f.timers.size, 1);
    f.advance(4999);
    assert.deepEqual(f.calls.forms, ['knot']);
    f.advance(1);
    assert.deepEqual(f.calls.forms, ['knot', 'orbit']);
    assert.equal(f.formLabel.textContent, 'Орбита');
    f.advance(5000);
    assert.equal(f.formLabel.textContent, 'Волна');
    f.advance(5000);
    assert.deepEqual(f.calls.forms, ['knot', 'orbit', 'wave', 'knot']);
    assert.equal(f.timers.size, 1, 'Only one cycle timer may exist');
  });

  test('global pause preserves the remaining interval and synchronizes the pause label', t => {
    const f = fixture(t);
    f.advance(2000);
    f.window.emit('portfolio:motion', { detail: { paused: true } });
    assert.equal(f.calls.pauses.at(-1), true);
    assert.equal(f.stage.dataset.cycleReason, 'global');
    assert.equal(f.autoLabel.textContent, 'Автосмена на паузе');
    assert.equal(f.timers.size, 0);
    f.advance(18000);
    assert.deepEqual(f.calls.forms, ['knot']);
    f.window.emit('portfolio:motion', { detail: { paused: false } });
    assert.equal(f.calls.pauses.at(-1), false);
    assert.equal(f.autoLabel.textContent, 'Автосмена · 5 сек');
    f.advance(2999);
    assert.deepEqual(f.calls.forms, ['knot']);
    f.advance(1);
    assert.deepEqual(f.calls.forms, ['knot', 'orbit']);
  });

  test('offscreen, hidden-tab, and reduced-motion pauses preserve active time', t => {
    const f = fixture(t);
    f.advance(1000);
    f.setVisible(false);
    assert.equal(f.stage.dataset.cycleReason, 'offscreen');
    assert.equal(f.timers.size, 0);
    f.advance(8000);
    f.setVisible(true);
    f.advance(1000);
    f.document.hidden = true;
    f.document.emit('visibilitychange');
    assert.equal(f.stage.dataset.cycleReason, 'hidden');
    f.advance(8000);
    f.document.hidden = false;
    f.document.emit('visibilitychange');
    f.advance(1000);
    f.reducedMotion.matches = true;
    f.reducedMotion.emit('change');
    assert.equal(f.stage.dataset.cycleReason, 'reduced-motion');
    f.advance(8000);
    assert.deepEqual(f.calls.forms, ['knot']);
    f.reducedMotion.matches = false;
    f.reducedMotion.emit('change');
    f.advance(1999);
    assert.deepEqual(f.calls.forms, ['knot']);
    f.advance(1);
    assert.deepEqual(f.calls.forms, ['knot', 'orbit']);
  });

  test('initial reduced motion keeps a static scene but permits explicit interactions', t => {
    const f = fixture(t, { reduced: true });
    assert.equal(f.timers.size, 0);
    assert.equal(f.calls.pauses.at(-1), true);
    f.advance(15000);
    assert.deepEqual(f.calls.forms, ['knot']);
    f.canvas.emit('keydown', { key: 'Enter' });
    assert.equal(f.calls.explosions.at(-1), true);
    assert.equal(f.timers.size, 0);
  });

  test('desktop double click updates explosion, ARIA, and the short action hint', t => {
    const f = fixture(t);
    assert.equal(f.canvas.getAttribute('aria-pressed'), 'false');
    assert.match(f.canvas.getAttribute('aria-label'), /Enter или пробел — разобрать/);
    assert.equal(f.note.textContent, 'Двойной клик — разобрать.');
    const event = f.canvas.emit('dblclick');
    assert.equal(event.defaultPrevented, true);
    assert.equal(f.calls.explosions.at(-1), true);
    assert.equal(f.stage.dataset.exploded, 'true');
    assert.equal(f.canvas.getAttribute('aria-pressed'), 'true');
    assert.match(f.canvas.getAttribute('aria-label'), /Enter или пробел — собрать/);
    assert.equal(f.note.textContent, 'Двойной клик — собрать.');
    f.canvas.emit('dblclick');
    assert.equal(f.canvas.getAttribute('aria-pressed'), 'false');
    assert.equal(f.note.textContent, 'Двойной клик — разобрать.');
  });

  test('Enter and Space toggle once; repeat, IME, and unrelated keys do not', t => {
    const f = fixture(t);
    const space = f.canvas.emit('keydown', { key: ' ' });
    assert.equal(space.defaultPrevented, true);
    assert.equal(f.calls.explosions.at(-1), true);
    f.canvas.emit('keydown', { key: ' ', repeat: true });
    f.canvas.emit('keydown', { key: 'Enter', isComposing: true });
    const arrow = f.canvas.emit('keydown', { key: 'ArrowDown' });
    assert.equal(arrow.defaultPrevented, false);
    assert.deepEqual(f.calls.explosions, [false, true]);
    const enter = f.canvas.emit('keydown', { key: 'Enter' });
    assert.equal(enter.defaultPrevented, true);
    assert.deepEqual(f.calls.explosions, [false, true, false]);
  });

  test('drag, scroll, pointer cancellation, and long press cannot trigger explosion', t => {
    const f = fixture(t);
    const down = () => f.canvas.emit('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    down();
    f.canvas.emit('pointermove', { pointerId: 1, clientX: 30, clientY: 10 });
    f.canvas.emit('pointerup', { pointerId: 1, clientX: 30, clientY: 10 });
    f.canvas.emit('dblclick');
    assert.deepEqual(f.calls.explosions, [false]);
    f.advance(600);
    down();
    f.window.scrollY = 20;
    f.canvas.emit('pointerup', { pointerId: 1, clientX: 10, clientY: 10 });
    f.canvas.emit('dblclick');
    assert.deepEqual(f.calls.explosions, [false]);
    f.advance(600);
    down();
    f.canvas.emit('pointercancel', { pointerId: 1 });
    f.canvas.emit('dblclick');
    assert.deepEqual(f.calls.explosions, [false]);
    f.advance(600);
    f.tap({ duration: 700 });
    f.canvas.emit('dblclick');
    assert.deepEqual(f.calls.explosions, [false]);
  });

  test('mobile double tap toggles once and deduplicates the native dblclick', t => {
    const f = fixture(t, { coarse: true });
    assert.equal(f.note.textContent, 'Двойное касание — разобрать.');
    f.tap();
    f.advance(100);
    f.tap();
    assert.deepEqual(f.calls.explosions, [false, true]);
    assert.equal(f.note.textContent, 'Двойное касание — собрать.');
    f.canvas.emit('dblclick');
    assert.deepEqual(f.calls.explosions, [false, true]);
    f.advance(800);
    f.tap();
    f.advance(100);
    f.tap();
    f.canvas.emit('dblclick');
    assert.deepEqual(f.calls.explosions, [false, true, false]);
  });

  test('distant or slow touch taps do not count as a double tap', t => {
    const f = fixture(t, { coarse: true });
    f.tap({ x: 10 });
    f.advance(100);
    f.tap({ x: 80 });
    assert.deepEqual(f.calls.explosions, [false]);
    f.advance(400);
    f.tap({ x: 80 });
    assert.deepEqual(f.calls.explosions, [false]);
  });

  test('destroy is idempotent and removes timers, listeners, and observers', t => {
    const f = fixture(t);
    assert.equal(f.timers.size, 1);
    f.controller.destroy();
    f.controller.destroy();
    assert.equal(f.timers.size, 0);
    assert.equal(f.stage.dataset.cycle, 'stopped');
    assert.equal(f.autoLabel.textContent, 'Автосмена остановлена');
    assert.ok(f.observers.every(observer => observer.disconnected));
    for (const target of [f.window, f.document, f.canvas, f.reducedMotion, f.touchInput]) assert.equal(target.listenerCount, 0);
    f.advance(30000);
    f.canvas.emit('dblclick');
    f.window.emit('portfolio:motion', { detail: { paused: false } });
    assert.deepEqual(f.calls.forms, ['knot']);
    assert.deepEqual(f.calls.explosions, [false]);
  });
});
