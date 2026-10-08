import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initAtmosphere } from '../src/atmosphere.js';

class Surface {
  constructor() { this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = {}; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, values = {}) {
    for (const callback of [...this.listeners.get(type) || []]) callback({ type, ...values });
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  get listenerCount() { return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0); }
}

function fixture({ coarse = false, reduced = false, paused = false, hidden = false, width = 1440, height = 1000 } = {}) {
  const view = new Surface();
  const doc = new Surface();
  const root = new Surface();
  const canvas = new Surface();
  const element = new Surface();
  const media = { reduced: new Surface(), coarse: new Surface() };
  media.reduced.matches = reduced;
  media.coarse.matches = coarse;
  const frames = new Map();
  const observers = [];
  let frameId = 0;
  let clock = 1000;
  const context = {
    arcs: [], strokes: 0, clears: 0, transforms: [],
    setTransform(...args) { this.transforms.push(args); },
    clearRect() { this.clears++; this.arcs = []; this.strokes = 0; },
    beginPath() {},
    arc(x, y, radius) { this.arcs.push({ x, y, radius }); },
    fill() {}, moveTo() {}, lineTo() {},
    stroke() { this.strokes++; },
  };
  Object.assign(view, { innerWidth: width, innerHeight: height, devicePixelRatio: 2, scrollY: 0 });
  view.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  view.cancelAnimationFrame = id => frames.delete(id);
  view.matchMedia = query => query.includes('reduced-motion') ? media.reduced : media.coarse;
  doc.defaultView = view;
  doc.documentElement = root;
  doc.hidden = hidden;
  root.dataset.motion = paused ? 'paused' : 'running';
  root.querySelectorAll = () => [element];
  element.style.transform = 'rotate(-29deg)';
  element.style.translate = '';
  element.dataset.parallax = '0.04';
  element.getBoundingClientRect = () => ({ top: 100 - view.scrollY, height: 120 });
  canvas.ownerDocument = doc;
  canvas.width = 300;
  canvas.height = 150;
  canvas.style.pointerEvents = 'auto';
  canvas.getContext = () => context;
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  view.MutationObserver = Observer;
  view.ResizeObserver = Observer;
  const run = (count = 1) => {
    for (let i = 0; i < count; i++) {
      clock += 1000 / 60;
      const current = [...frames.values()];
      frames.clear();
      current.forEach(callback => callback(clock));
    }
  };
  return { view, doc, root, canvas, element, media, frames, observers, context, run };
}

test('initial static paint and bounded desktop density precede the first frame', () => {
  const f = fixture();
  const atmosphere = initAtmosphere({ canvas: f.canvas });
  assert.equal(f.context.clears, 1);
  assert.equal(f.context.arcs.filter(arc => arc.radius < 1.6).length, 120);
  assert.equal(f.frames.size, 1);
  assert.equal(f.canvas.getAttribute('aria-hidden'), 'true');
  assert.equal(f.canvas.style.pointerEvents, 'none');
  assert.ok(f.canvas.width * f.canvas.height <= 3500000);
  f.run(20);
  assert.ok(f.context.arcs.every(arc => Number.isFinite(arc.x) && Number.isFinite(arc.y)));
  assert.notEqual(f.element.style.translate, '');
  assert.equal(f.element.style.transform, 'rotate(-29deg)');
  atmosphere.destroy();
});

test('pause, visibility, DOM attribute and reduced motion cancel frames; resuming schedules once', () => {
  const f = fixture();
  const atmosphere = initAtmosphere({ canvas: f.canvas });
  f.run(3);
  f.view.emit('portfolio:motion', { detail: { paused: true } });
  assert.equal(f.frames.size, 0);
  assert.equal(f.element.style.translate, '');
  f.view.scrollY = 800;
  f.view.emit('scroll');
  assert.equal(f.frames.size, 0);
  f.view.emit('portfolio:motion', { detail: { paused: false } });
  assert.equal(f.frames.size, 1);
  f.doc.hidden = true;
  f.doc.emit('visibilitychange');
  assert.equal(f.frames.size, 0);
  f.doc.hidden = false;
  f.doc.emit('visibilitychange');
  assert.equal(f.frames.size, 1);
  f.root.dataset.motion = 'paused';
  f.observers[0].callback();
  assert.equal(f.frames.size, 0);
  f.view.emit('portfolio:motion', { detail: { paused: false } });
  assert.equal(f.frames.size, 0, 'HTML paused state cannot be bypassed by a stale event');
  f.root.dataset.motion = 'running';
  f.observers[0].callback();
  assert.equal(f.frames.size, 1);
  f.media.reduced.matches = true;
  f.media.reduced.emit('change');
  assert.equal(f.frames.size, 0);
  assert.equal(f.element.style.translate, '');
  assert.ok(f.context.arcs.length > 0);
  f.media.reduced.matches = false;
  f.media.reduced.emit('change');
  assert.equal(f.frames.size, 1);
  atmosphere.destroy();
});

test('initial reduced or paused state retains particles without scheduling animation', () => {
  for (const options of [{ reduced: true }, { paused: true }, { hidden: true }]) {
    const f = fixture(options);
    const atmosphere = initAtmosphere({ canvas: f.canvas });
    assert.equal(f.frames.size, 0);
    assert.ok(f.context.arcs.length > 0);
    assert.equal(f.element.style.translate, '');
    atmosphere.destroy();
  }
});

test('coarse and narrow screens have lower density and no DOM pointer parallax', () => {
  for (const options of [{ coarse: true }, { width: 390, height: 844 }]) {
    const f = fixture(options);
    const atmosphere = initAtmosphere({ canvas: f.canvas });
    assert.ok(f.context.arcs.filter(arc => arc.radius < 1.6).length <= 55);
    assert.equal(f.context.strokes, 0);
    f.view.emit('pointermove', { pointerType: 'mouse', clientX: 10, clientY: 20 });
    f.view.scrollY = 400;
    f.view.emit('scroll');
    f.run(30);
    assert.equal(f.element.style.translate, '');
    atmosphere.destroy();
  }
});

test('pointer softly deflects the field and parallax while preserving transforms', () => {
  const a = fixture();
  const b = fixture();
  const first = initAtmosphere({ canvas: a.canvas });
  const second = initAtmosphere({ canvas: b.canvas });
  a.view.emit('pointermove', { pointerType: 'mouse', clientX: 120, clientY: 130 });
  a.run(30);
  b.run(30);
  assert.notDeepEqual(a.context.arcs, b.context.arcs);
  const [x, y] = a.element.style.translate.split(' ').map(parseFloat);
  assert.ok(Math.abs(x) < 17 && Math.abs(y) < 59);
  assert.equal(a.element.style.transform, 'rotate(-29deg)');
  a.doc.emit('pointerleave');
  a.run(120);
  assert.ok(Math.abs(parseFloat(a.element.style.translate)) < 0.05);
  first.destroy();
  second.destroy();
});

test('destroy is idempotent, restores owned state, removes listeners and disconnects observers', () => {
  const f = fixture();
  f.element.style.translate = '3px 4px';
  const atmosphere = initAtmosphere({ canvas: f.canvas });
  f.run(3);
  atmosphere.destroy();
  atmosphere.destroy();
  assert.equal(f.frames.size, 0);
  assert.equal(f.canvas.getAttribute('aria-hidden'), null);
  assert.equal(f.canvas.style.pointerEvents, 'auto');
  assert.equal(f.canvas.width, 300);
  assert.equal(f.canvas.height, 150);
  assert.equal(f.element.style.translate, '3px 4px');
  for (const target of [f.view, f.doc, f.media.reduced, f.media.coarse]) assert.equal(target.listenerCount, 0);
  assert.ok(f.observers.every(observer => observer.disconnected));
});

test('missing or unavailable canvas context is a harmless enhancement failure', () => {
  assert.doesNotThrow(() => initAtmosphere().destroy());
  const f = fixture();
  f.canvas.getContext = () => null;
  assert.doesNotThrow(() => initAtmosphere({ canvas: f.canvas }).destroy());
  assert.equal(f.frames.size, 0);
  assert.equal(f.view.listenerCount, 0);
  assert.equal(f.canvas.style.pointerEvents, 'auto');
});
