/** Decorative viewport particles and opt-in parallax; independent of the 3D scene. */
export function initAtmosphere({ canvas, root } = {}) {
  const noop = { destroy() {} };
  const doc = canvas?.ownerDocument;
  const view = doc?.defaultView;
  if (!canvas || !doc || !view) return noop;
  let context;
  try { context = canvas.getContext('2d', { alpha: true }); } catch { return noop; }
  if (!context) return noop;

  root ||= doc.documentElement;
  const motionRoot = doc.documentElement;
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = view.matchMedia('(pointer: coarse)');
  const palette = ['255,93,177', '66,85,255', '181,168,255'];
  const original = {
    hidden: canvas.getAttribute('aria-hidden'),
    pointerEvents: canvas.style.pointerEvents,
    width: canvas.width,
    height: canvas.height,
  };
  const listeners = [];
  const particles = [];
  const parallax = Array.from(root.querySelectorAll('[data-parallax]')).map((element) => ({
    element,
    factor: Math.max(-0.15, Math.min(0.15, Number.isFinite(Number(element.dataset.parallax))
      ? Number(element.dataset.parallax) : 0.04)),
    original: element.style.translate,
    center: 0, x: 0, y: 0,
  }));
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let mobile = false;
  let scroll = view.scrollY || 0;
  let scrollTarget = scroll;
  let pointer = { x: 0, y: 0, tx: 0, ty: 0, strength: 0, active: false };
  let elapsed = 0;
  let previousTime = 0;
  let frame = 0;
  let destroyed = false;
  let paused = motionRoot.dataset.motion === 'paused';
  let seed = 0x707972;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const wrap = (value, max) => ((value % max) + max) % max;
  const color = (rgb, alpha) => `rgba(${rgb},${alpha.toFixed(3)})`;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }
  function moving() {
    return !destroyed && !paused && motionRoot.dataset.motion !== 'paused' && !reduced.matches && !doc.hidden;
  }
  function stop() {
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  }
  function schedule() {
    if (moving() && !frame) frame = view.requestAnimationFrame(tick);
  }
  function restoreParallax() {
    for (const item of parallax) {
      item.element.style.translate = item.original;
      item.x = item.y = 0;
    }
  }
  function measureParallax() {
    for (const item of parallax) {
      const box = item.element.getBoundingClientRect();
      item.center = box.top + box.height / 2 + (view.scrollY || 0) - item.y;
    }
  }
  function populate() {
    const count = mobile
      ? Math.round(clamp(width * height / 13000, 30, 55))
      : Math.round(clamp(width * height / 11000, 45, 120));
    particles.length = Math.min(particles.length, count);
    while (particles.length < count) {
      const layer = [0.25, 0.58, 1][particles.length % 3];
      particles.push({
        x: random(), y: random(), layer,
        vx: (random() - 0.5) * 4,
        vy: -(1.3 + random() * 3.2) * layer,
        radius: 0.45 + layer * 0.65 + random() * 0.35,
        alpha: 0.22 + random() * 0.24 + layer * 0.08,
        phase: random() * Math.PI * 2,
        rgb: palette[Math.floor(random() * palette.length)],
        repulseX: 0, repulseY: 0, screenX: 0, screenY: 0,
      });
    }
  }

  function draw(dt = 0) {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    const staticMode = reduced.matches;
    const easing = dt ? 1 - Math.exp(-dt * 7) : 0;
    for (const [index, particle] of particles.entries()) {
      if (dt) {
        particle.x = wrap(particle.x + particle.vx * dt / width, 1);
        particle.y = wrap(particle.y + particle.vy * dt / height, 1);
      }
      const driftX = !staticMode && !mobile ? (pointer.x - width / 2) * 0.018 * particle.layer * pointer.strength : 0;
      const driftY = !staticMode ? -scroll * (mobile ? 0.024 : 0.045) * particle.layer : 0;
      const x = wrap(particle.x * (width + 32) + driftX, width + 32) - 16;
      const y = wrap(particle.y * (height + 32) + driftY, height + 32) - 16;
      let repulseX = 0;
      let repulseY = 0;
      if (!staticMode && !mobile && pointer.strength > 0.005) {
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 150 && distance > 0.01) {
          const force = (1 - distance / 150) ** 2 * 32 * particle.layer * pointer.strength;
          repulseX = dx / distance * force;
          repulseY = dy / distance * force;
        }
      }
      particle.repulseX += (repulseX - particle.repulseX) * easing;
      particle.repulseY += (repulseY - particle.repulseY) * easing;
      particle.screenX = x + (staticMode ? 0 : particle.repulseX);
      particle.screenY = y + (staticMode ? 0 : particle.repulseY);
      const alpha = particle.alpha * (0.93 + Math.sin(elapsed * 0.45 + particle.phase) * 0.07);

      if (index % 11 === 0) {
        context.beginPath();
        context.arc(particle.screenX, particle.screenY, particle.radius * 3.5, 0, Math.PI * 2);
        context.fillStyle = color(particle.rgb, alpha * 0.065);
        context.fill();
      }
      context.beginPath();
      context.arc(particle.screenX, particle.screenY, particle.radius, 0, Math.PI * 2);
      context.fillStyle = color(particle.rgb, alpha);
      context.fill();
      if (!mobile && index % 17 === 0) {
        context.beginPath();
        context.moveTo(particle.screenX, particle.screenY);
        context.lineTo(particle.screenX - particle.vx * 1.4, particle.screenY - particle.vy * 2);
        context.strokeStyle = color(particle.rgb, alpha * 0.2);
        context.lineWidth = 0.6;
        context.stroke();
      }
    }

    // A small, fixed sampling budget avoids a quadratic all-pairs network.
    if (!mobile) {
      context.lineWidth = 0.5;
      for (let index = 0; index < particles.length; index += 12) {
        const first = particles[index];
        let nearest;
        let closest = 112;
        for (let offset = 1; offset <= 8 && index + offset < particles.length; offset += 1) {
          const candidate = particles[index + offset];
          const distance = Math.hypot(first.screenX - candidate.screenX, first.screenY - candidate.screenY);
          if (distance < closest) { closest = distance; nearest = candidate; }
        }
        if (!nearest) continue;
        context.beginPath();
        context.moveTo(first.screenX, first.screenY);
        context.lineTo(nearest.screenX, nearest.screenY);
        context.strokeStyle = color(first.rgb, (1 - closest / 112) * 0.13);
        context.stroke();
      }
    }
  }

  function updateParallax(dt) {
    if (mobile || reduced.matches) return;
    const easing = 1 - Math.exp(-dt * 7);
    for (const item of parallax) {
      const center = item.center - scroll;
      const inRange = center > -height * 0.5 && center < height * 1.5;
      const targetX = inRange ? clamp((pointer.x - width / 2) * item.factor * 0.28, -16, 16) * pointer.strength : 0;
      const targetY = inRange ? clamp((height * 0.5 - center) * item.factor, -48, 48)
        + clamp((pointer.y - height / 2) * item.factor * 0.18, -10, 10) * pointer.strength : 0;
      item.x += (targetX - item.x) * easing;
      item.y += (targetY - item.y) * easing;
      item.element.style.translate = `${item.x.toFixed(2)}px ${item.y.toFixed(2)}px`;
    }
  }

  function tick(time) {
    frame = 0;
    if (!moving()) return;
    const dt = previousTime ? clamp((time - previousTime) / 1000, 0, 0.04) : 1 / 60;
    previousTime = time;
    elapsed += dt;
    const easing = 1 - Math.exp(-dt * 8);
    scroll += (scrollTarget - scroll) * easing;
    pointer.x += (pointer.tx - pointer.x) * easing;
    pointer.y += (pointer.ty - pointer.y) * easing;
    pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * easing;
    draw(dt);
    updateParallax(dt);
    schedule();
  }

  function resize() {
    width = Math.max(1, view.innerWidth || motionRoot.clientWidth || 1);
    height = Math.max(1, view.innerHeight || motionRoot.clientHeight || 1);
    mobile = coarse.matches || width < 768;
    pixelRatio = Math.min(view.devicePixelRatio || 1, mobile ? 1.3 : 1.6, Math.sqrt(3500000 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    pointer = { x: width / 2, y: height / 2, tx: width / 2, ty: height / 2, strength: 0, active: false };
    scroll = scrollTarget = view.scrollY || 0;
    populate();
    if (mobile || reduced.matches) restoreParallax();
    measureParallax();
    draw();
    schedule();
  }

  function syncMotion() {
    stop();
    pointer.active = false;
    if (!moving()) restoreParallax();
    if (reduced.matches) draw();
    if (moving()) {
      scroll = scrollTarget = view.scrollY || 0;
      measureParallax();
      schedule();
    }
  }

  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none';
  listen(view, 'scroll', () => { scrollTarget = view.scrollY || 0; }, { passive: true });
  listen(view, 'resize', resize, { passive: true });
  listen(view, 'pointermove', (event) => {
    if (!moving() || mobile || event.pointerType === 'touch') return;
    pointer.tx = event.clientX;
    pointer.ty = event.clientY;
    pointer.active = true;
  }, { passive: true });
  listen(doc, 'pointerleave', () => { pointer.active = false; }, { passive: true });
  listen(view, 'blur', () => { pointer.active = false; });
  listen(view, 'portfolio:motion', (event) => {
    paused = typeof event.detail?.paused === 'boolean' ? event.detail.paused : motionRoot.dataset.motion === 'paused';
    syncMotion();
  });
  listen(doc, 'visibilitychange', syncMotion);
  listen(reduced, 'change', syncMotion);
  listen(coarse, 'change', resize);

  const motionObserver = typeof view.MutationObserver === 'function' ? new view.MutationObserver(() => {
    paused = motionRoot.dataset.motion === 'paused';
    syncMotion();
  }) : null;
  motionObserver?.observe(motionRoot, { attributes: true, attributeFilter: ['data-motion'] });
  const layoutObserver = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(measureParallax) : null;
  layoutObserver?.observe(root);
  resize();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      listeners.forEach((remove) => remove());
      motionObserver?.disconnect();
      layoutObserver?.disconnect();
      restoreParallax();
      canvas.width = original.width;
      canvas.height = original.height;
      canvas.style.pointerEvents = original.pointerEvents;
      if (original.hidden === null) canvas.removeAttribute('aria-hidden');
      else canvas.setAttribute('aria-hidden', original.hidden);
    },
  };
}
