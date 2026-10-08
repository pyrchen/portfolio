const FORMS = [
  { id: 'knot', label: 'Узел' },
  { id: 'orbit', label: 'Орбита' },
  { id: 'wave', label: 'Волна' },
];
const CYCLE_MS = 5000;

/**
 * Scene interaction/cycle only; the renderer still owns pointer-driven rotation.
 * Global motion contract: window.dispatchEvent(new CustomEvent('portfolio:motion',
 * { detail: { paused: boolean } })). Pauses preserve the current cycle remainder.
 */
export function initSceneController({ scene, canvas, stage, note, formLabel, autoLabel } = {}) {
  if (!scene || !canvas || !stage || stage.dataset.renderer === 'unavailable') return { destroy() {} };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const touchInput = window.matchMedia('(pointer: coarse)');
  const cycleLabel = autoLabel || stage.closest?.('.hero')?.querySelector('.scene-auto');
  const cleanups = [];
  let index = 0, exploded = false, disposed = false;
  let globallyPaused = document.documentElement.dataset.motion === 'paused';
  let inView = isInViewport();
  let timer = 0, startedAt = 0, remaining = CYCLE_MS;
  let gesture = null, lastTouchTap = null;
  let suppressDoubleUntil = 0, suppressTouchDoubleUntil = 0;

  function listen(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    cleanups.push(() => target.removeEventListener(event, handler, options));
  }

  function isInViewport() {
    const rect = stage.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  }

  function cycleAllowed() {
    return !disposed && !globallyPaused && !reducedMotion.matches && !document.hidden && inView && stage.dataset.renderer !== 'unavailable';
  }

  function updateText() {
    if (stage.dataset.renderer === 'unavailable') return;
    if (formLabel) formLabel.textContent = FORMS[index].label;
    canvas.setAttribute('aria-pressed', String(exploded));
    canvas.setAttribute('aria-label', `Трёхмерная скульптура. Потяни, чтобы повернуть. Enter или пробел — ${exploded ? 'собрать' : 'разобрать'}.`);
    if (note) {
      const action = touchInput.matches ? 'Двойное касание' : 'Двойной клик';
      note.textContent = `${action} — ${exploded ? 'собрать' : 'разобрать'}.`;
    }
  }

  function stopTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    remaining = Math.max(0, remaining - (performance.now() - startedAt));
  }

  function startTimer() {
    if (timer || !cycleAllowed()) return;
    startedAt = performance.now();
    timer = window.setTimeout(() => {
      timer = 0;
      if (!cycleAllowed()) { remaining = Math.max(0, remaining - (performance.now() - startedAt)); syncMotion(); return; }
      index = (index + 1) % FORMS.length;
      scene.setForm(FORMS[index].id);
      stage.dataset.form = FORMS[index].id;
      remaining = CYCLE_MS;
      updateText();
      startTimer();
    }, Math.max(remaining, 1));
  }

  function syncMotion() {
    if (disposed) return;
    const running = cycleAllowed();
    if (!running) stopTimer();
    scene.setPaused(!running);
    stage.dataset.cycle = running ? 'running' : 'paused';
    if (cycleLabel) cycleLabel.textContent = running ? 'Автосмена · 5 сек' : 'Автосмена на паузе';
    stage.dataset.cycleReason = running ? '' : globallyPaused ? 'global' : reducedMotion.matches ? 'reduced-motion' : document.hidden ? 'hidden' : !inView ? 'offscreen' : 'unavailable';
    if (running) startTimer();
  }

  function toggleExplosion() {
    if (disposed || stage.dataset.renderer === 'unavailable') return;
    exploded = !exploded;
    scene.setExploded(exploded);
    stage.dataset.exploded = String(exploded);
    updateText();
  }

  function invalidateGesture() {
    suppressDoubleUntil = performance.now() + 550;
    lastTouchTap = null;
    gesture = null;
  }

  listen(canvas, 'pointerdown', event => {
    if (event.button > 0) return;
    if (event.isPrimary === false || (gesture && gesture.id !== event.pointerId)) { invalidateGesture(); return; }
    gesture = {
      id: event.pointerId, type: event.pointerType,
      x: event.clientX, y: event.clientY,
      scrollX: window.scrollX, scrollY: window.scrollY,
      started: performance.now(), dragged: false,
    };
  }, { passive: true });
  listen(canvas, 'pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) {
      gesture.dragged = true;
      suppressDoubleUntil = performance.now() + 550;
      lastTouchTap = null;
    }
  }, { passive: true });
  listen(canvas, 'pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const current = gesture;
    gesture = null;
    const now = performance.now();
    const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
    const scrolled = Math.abs(window.scrollX - current.scrollX) > 4 || Math.abs(window.scrollY - current.scrollY) > 4;
    if (current.dragged || distance > 8 || scrolled || now - current.started > 500) { invalidateGesture(); return; }
    if (current.type !== 'touch' || now < suppressDoubleUntil) return;
    if (lastTouchTap && now - lastTouchTap.at < 340 && Math.hypot(event.clientX - lastTouchTap.x, event.clientY - lastTouchTap.y) < 28) {
      toggleExplosion();
      lastTouchTap = null;
      // Mobile browsers can emit a native dblclick after the same two taps.
      suppressTouchDoubleUntil = now + 750;
    } else {
      lastTouchTap = { at: now, x: event.clientX, y: event.clientY };
    }
  }, { passive: true });
  listen(canvas, 'pointercancel', invalidateGesture, { passive: true });
  listen(canvas, 'dblclick', event => {
    if (event.button > 0 || performance.now() < suppressDoubleUntil || performance.now() < suppressTouchDoubleUntil) return;
    event.preventDefault();
    toggleExplosion();
  });
  listen(canvas, 'keydown', event => {
    if (event.repeat || event.isComposing || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    toggleExplosion();
  });
  listen(window, 'portfolio:motion', event => {
    if (typeof event.detail?.paused === 'boolean') globallyPaused = event.detail.paused;
    else globallyPaused = document.documentElement.dataset.motion === 'paused';
    syncMotion();
  });
  listen(document, 'visibilitychange', syncMotion);
  listen(reducedMotion, 'change', syncMotion);
  listen(touchInput, 'change', updateText);
  const intersectionObserver = new IntersectionObserver(entries => {
    const entry = entries[0];
    inView = Boolean(entry?.isIntersecting && entry.intersectionRatio >= .08);
    syncMotion();
  }, { threshold: [0, .08] });
  intersectionObserver.observe(stage);

  scene.setEnergy(1);
  scene.setForm(FORMS[index].id);
  scene.setExploded(false);
  stage.dataset.energy = '1.00';
  stage.dataset.form = FORMS[index].id;
  stage.dataset.exploded = 'false';
  updateText();
  syncMotion();

  return {
    destroy() {
      if (disposed) return;
      stopTimer();
      disposed = true;
      intersectionObserver.disconnect();
      cleanups.forEach(cleanup => cleanup());
      stage.dataset.cycle = 'stopped';
      if (cycleLabel) cycleLabel.textContent = 'Автосмена остановлена';
    },
  };
}
