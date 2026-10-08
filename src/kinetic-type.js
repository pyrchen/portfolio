/** Spring typography: progressively enhances already-visible letter spans. */
export function initKineticType({ host, word, readout } = {}) {
  if (!host || !word) return { destroy() {} };

  const letters = Array.from(word.children).filter((node) => node.tagName === 'SPAN');
  const view = word.ownerDocument.defaultView;
  if (!letters.length || !view) return { destroy() {} };

  const doc = word.ownerDocument;
  const reduce = view.matchMedia('(prefers-reduced-motion: reduce)');
  const originals = new Map(['role', 'tabindex', 'aria-label', 'aria-pressed', 'data-exploded']
    .map((attribute) => [attribute, word.getAttribute(attribute)]));
  const originalReadout = readout?.textContent;
  const states = letters.map((element) => ({
    element, originalTransform: element.style.transform,
    x: 0, y: 0, rotation: 0, vx: 0, vy: 0, vr: 0,
    tx: 0, ty: 0, tr: 0, center: 0,
  }));
  const removers = [];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const splay = [0.42, -0.8, 0.58, -0.46, 0.75, -0.5, 0.35];
  let width = 1;
  let height = 1;
  let frame = 0;
  let previousTime = 0;
  let exploded = false;
  let paused = false;
  let visible = true;
  let destroyed = false;
  let pointer = null;
  let touchStart = null;
  let lastTap = null;
  let ignoreDoubleClickUntil = 0;

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }

  function canAnimate() {
    return !destroyed && !paused && !reduce.matches && !doc.hidden && visible;
  }

  function render(state) {
    state.element.style.transform = `translate3d(${state.x.toFixed(3)}px, ${state.y.toFixed(3)}px, 0) rotate(${state.rotation.toFixed(3)}deg)`;
  }

  function stop() {
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  }

  function settle() {
    stop();
    for (const state of states) {
      state.x = state.tx;
      state.y = state.ty;
      state.rotation = state.tr;
      state.vx = state.vy = state.vr = 0;
      render(state);
    }
  }

  function tick(time) {
    frame = 0;
    if (!canAnimate()) return;
    const elapsed = previousTime ? clamp((time - previousTime) / 1000, 0.001, 0.04) : 1 / 60;
    previousTime = time;
    const steps = Math.ceil(elapsed / (1 / 120));
    const dt = elapsed / steps;
    let moving = false;

    for (const state of states) {
      for (let step = 0; step < steps; step += 1) {
        state.vx += ((state.tx - state.x) * 235 - state.vx * 24) * dt;
        state.vy += ((state.ty - state.y) * 235 - state.vy * 24) * dt;
        state.vr += ((state.tr - state.rotation) * 205 - state.vr * 23) * dt;
        state.x += state.vx * dt;
        state.y += state.vy * dt;
        state.rotation += state.vr * dt;
      }
      const distance = Math.abs(state.tx - state.x) + Math.abs(state.ty - state.y)
        + Math.abs(state.tr - state.rotation);
      const velocity = Math.abs(state.vx) + Math.abs(state.vy) + Math.abs(state.vr);
      if (distance > 0.015 || velocity > 0.025) {
        moving = true;
      } else {
        state.x = state.tx;
        state.y = state.ty;
        state.rotation = state.tr;
        state.vx = state.vy = state.vr = 0;
      }
      render(state);
    }
    if (moving) frame = view.requestAnimationFrame(tick);
    else previousTime = 0;
  }

  function wake() {
    if (!canAnimate()) {
      settle();
      return;
    }
    if (!frame) frame = view.requestAnimationFrame(tick);
  }

  function updateTargets() {
    const radius = Math.max(80, width * 0.23);
    const midpoint = (states.length - 1) / 2 || 1;
    for (const [index, state] of states.entries()) {
      const spread = (index - midpoint) / midpoint;
      state.tx = exploded ? spread * Math.min(24, width * 0.033) : 0;
      state.ty = exploded ? splay[index % splay.length] * Math.min(48, height * 0.2) : 0;
      state.tr = exploded ? spread * 7 : 0;

      if (pointer && canAnimate()) {
        const dx = pointer.x - state.center;
        const dy = pointer.y - height * 0.5;
        const distance = Math.hypot(dx, dy * 0.6);
        const strength = Math.max(0, 1 - distance / radius) ** 2;
        state.tx += clamp(dx * 0.035, -4, 4) * strength;
        state.ty += clamp(dy * 0.16, -12, 12) * strength;
        state.tr += clamp(dx * 0.035, -4, 4) * strength;
      }
    }
  }

  function measure() {
    const box = word.getBoundingClientRect();
    width = Math.max(box.width, 1);
    height = Math.max(box.height, 1);
    for (const state of states) {
      const bounds = state.element.getBoundingClientRect();
      state.center = (bounds.left + bounds.right) / 2 - box.left - state.x;
    }
    updateTargets();
    wake();
  }

  function isOtherControl(target) {
    const control = target?.closest?.('a, button, input, select, textarea, [contenteditable="true"]');
    return control && control !== word;
  }

  function toggle() {
    exploded = !exploded;
    word.dataset.exploded = String(exploded);
    word.setAttribute('aria-pressed', String(exploded));
    word.setAttribute('aria-label', exploded
      ? 'pyrchen — собрать буквы. Enter или пробел.'
      : 'pyrchen — разобрать буквы. Enter или пробел.');
    if (readout) readout.textContent = exploded ? 'Двойной клик — собрать буквы' : 'Двойной клик — разобрать буквы';
    pointer = null;
    updateTargets();
    wake();
  }

  function ripple(event) {
    if (isOtherControl(event.target)) return;
    // A screen-reader-generated activation has no pointer click count.
    if (event.detail === 0) {
      toggle();
      return;
    }
    if (!canAnimate()) return;
    const box = word.getBoundingClientRect();
    const x = event.clientX - box.left;
    for (const state of states) {
      const influence = Math.exp(-Math.abs(state.center - x) / Math.max(40, width * 0.16));
      state.vy = -48 * influence;
      state.vr = clamp((state.center - x) / width, -0.5, 0.5) * 12 * influence;
    }
    wake();
  }

  function resetPointer() {
    pointer = null;
    updateTargets();
    wake();
  }

  function updateMotion() {
    pointer = null;
    updateTargets();
    if (canAnimate()) wake();
    else settle();
  }

  word.setAttribute('role', 'button');
  if (!word.hasAttribute('tabindex')) word.tabIndex = 0;
  word.setAttribute('aria-pressed', 'false');
  word.setAttribute('aria-label', 'pyrchen — разобрать буквы. Enter или пробел.');
  word.dataset.exploded = 'false';

  listen(host, 'pointermove', (event) => {
    if (event.pointerType === 'touch' || !canAnimate() || isOtherControl(event.target)) return;
    const box = word.getBoundingClientRect();
    pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    updateTargets();
    wake();
  }, { passive: true });
  listen(host, 'pointerleave', resetPointer, { passive: true });
  listen(word, 'click', ripple);
  listen(word, 'dblclick', (event) => {
    if (isOtherControl(event.target) || view.performance.now() < ignoreDoubleClickUntil) return;
    toggle();
  });
  listen(word, 'keydown', (event) => {
    if (event.target !== word || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    if (!event.repeat) toggle();
  });

  listen(word, 'pointerdown', (event) => {
    if (event.pointerType !== 'touch' || isOtherControl(event.target)) return;
    if (!event.isPrimary) {
      touchStart = lastTap = null;
      return;
    }
    touchStart = { id: event.pointerId, x: event.clientX, y: event.clientY, time: view.performance.now() };
  }, { passive: true });
  listen(word, 'pointermove', (event) => {
    if (!touchStart || event.pointerId !== touchStart.id) return;
    if (Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) > 9) touchStart = lastTap = null;
  }, { passive: true });
  listen(word, 'pointerup', (event) => {
    if (!touchStart || event.pointerId !== touchStart.id) return;
    const now = view.performance.now();
    const start = touchStart;
    touchStart = null;
    if (now - start.time > 280 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9) {
      lastTap = null;
      return;
    }
    if (lastTap && now - lastTap.time < 360
      && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30) {
      lastTap = null;
      ignoreDoubleClickUntil = now + 600;
      toggle();
    } else {
      lastTap = { x: event.clientX, y: event.clientY, time: now };
    }
  }, { passive: true });
  listen(word, 'pointercancel', () => { touchStart = lastTap = null; }, { passive: true });
  listen(word, 'pointerleave', () => { touchStart = null; }, { passive: true });
  listen(view, 'portfolio:motion', (event) => {
    paused = Boolean(event.detail?.paused);
    updateMotion();
  });
  listen(doc, 'visibilitychange', updateMotion);
  listen(reduce, 'change', updateMotion);
  listen(view, 'resize', measure, { passive: true });

  const observer = typeof view.IntersectionObserver === 'function'
    ? new view.IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updateMotion();
    }, { threshold: 0 }) : null;
  observer?.observe(word);
  const resizeObserver = typeof view.ResizeObserver === 'function'
    ? new view.ResizeObserver(measure) : null;
  resizeObserver?.observe(word);
  measure();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      observer?.disconnect();
      resizeObserver?.disconnect();
      removers.forEach((remove) => remove());
      for (const state of states) state.element.style.transform = state.originalTransform;
      for (const [attribute, value] of originals) {
        if (value === null) word.removeAttribute(attribute);
        else word.setAttribute(attribute, value);
      }
      if (readout) readout.textContent = originalReadout;
    },
  };
}
