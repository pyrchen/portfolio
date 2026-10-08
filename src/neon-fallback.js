const TAU = Math.PI * 2;
const FORMS = ['knot', 'orbit', 'wave'];
const COLORS = { violet: [119, 117, 255], cyan: [120, 140, 255], lime: [255, 93, 177] };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalize = vector => {
  const length = Math.hypot(...vector) || 1;
  return vector.map(value => value / length);
};

/** CPU-rendered 3D geometry for machines without a usable WebGL context. */
export function initNeonFallback({ canvas, container, onReady, onError } = {}) {
  const noop = { setForm() {}, setEnergy() {}, setExploded() {}, setPaused() {}, destroy() {} };
  let ctx;
  try {
    ctx = canvas?.getContext('2d', { alpha: true });
    if (!ctx || !container) throw new Error('Canvas 2D fallback is unavailable.');
  } catch (error) {
    if (container) container.dataset.renderer = 'unavailable';
    onError?.(error);
    return noop;
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const segments = mobile ? 36 : 48;
  const threadCount = mobile ? 8 : 13;
  const cleanups = [];
  let width = 1, height = 1, dpr = 1, focal = 1, cameraZ = 7.6, focusX = .5;
  let form = 'knot', energy = 1, exploded = false, explosion = 0, paused = false;
  let time = 0, last = 0, frame = 0, visible = true, disposed = false, failed = false, ready = false, morphing = false;
  let scroll = 0, drag = null;
  const pointer = { x: 0, y: 0 }, smoothed = { x: 0, y: 0 };
  const rotation = { x: 0, y: 0 }, smoothRotation = { x: 0, y: 0 };

  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  function center(mode, t) {
    if (mode === 'orbit') return [1.94 * Math.cos(t), 1.34 * Math.sin(t), .2 * Math.sin(t * 3)];
    if (mode === 'wave') return [2.04 * Math.cos(t), 1.14 * Math.sin(t * 2), .71 * Math.sin(t)];
    const radius = 1.45 + .5 * Math.cos(t * 3);
    return [radius * Math.cos(t * 2), radius * Math.sin(t * 2) * .84, .75 * Math.sin(t * 3)];
  }

  const frames = Object.fromEntries(FORMS.map(mode => [mode, Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments * TAU;
    const p = center(mode, t), before = center(mode, t - .002), after = center(mode, t + .002);
    const tangent = normalize(after.map((value, axis) => value - before[axis]));
    const second = after.map((value, axis) => value + before[axis] - 2 * p[axis]);
    const dot = second.reduce((sum, value, axis) => sum + value * tangent[axis], 0);
    const normal = normalize(second.map((value, axis) => value - tangent[axis] * dot));
    const binormal = normalize([
      tangent[1] * normal[2] - tangent[2] * normal[1],
      tangent[2] * normal[0] - tangent[0] * normal[2],
      tangent[0] * normal[1] - tangent[1] * normal[0],
    ]);
    return { p, normal, binormal, t };
  })]));

  function geometry(definition, mode) {
    const result = new Float32Array((segments + 1) * 6);
    frames[mode].forEach(({ p, normal, binormal, t }, index) => {
      const angle = definition.phase + t * 2;
      const radius = definition.radius * (1 + .11 * Math.sin(t * 3 + definition.phase));
      for (let side = 0; side < 2; side++) {
        const across = (side - .5) * definition.width;
        const n = Math.cos(angle) * radius - Math.sin(angle) * across;
        const b = Math.sin(angle) * radius + Math.cos(angle) * across;
        for (let axis = 0; axis < 3; axis++) result[index * 6 + side * 3 + axis] = p[axis] + normal[axis] * n + binormal[axis] * b;
      }
    });
    return result;
  }

  const definitions = Array.from({ length: 3 }, (_, index) => ({ phase: index / 3 * TAU, radius: .205, width: .23, broad: true, color: COLORS.violet }));
  for (let index = 0; index < threadCount; index++) definitions.push({
    phase: index / threadCount * TAU + .16,
    radius: .275 + (index % 3 === 0 ? .026 : 0), width: index % 5 === 0 ? .044 : .025,
    broad: false, color: index === threadCount - 1 ? COLORS.lime : index === 4 ? COLORS.cyan : COLORS.violet,
  });
  const bands = definitions.map((definition, index) => {
    const variants = Object.fromEntries(FORMS.map(mode => [mode, geometry(definition, mode)]));
    return {
      ...definition, variants, current: variants.knot.slice(),
      spread: normalize([Math.cos(definition.phase), Math.sin(definition.phase), Math.sin(index * 1.3) * .65]),
    };
  });
  const dust = Array.from({ length: mobile ? 22 : 38 }, (_, index) => {
    const a = index * 2.399963;
    const seed = Math.sin(index * 127.1 + 41.7) * 43758.5453;
    const radius = 2.35 + (seed - Math.floor(seed)) * 1.5;
    return { point: [Math.cos(a) * radius, Math.sin(a) * radius * .76, Math.sin(index * 2.71) * 2], phase: index * .72, color: index % 8 === 0 ? COLORS.cyan : COLORS.violet };
  });

  function updateGeometry(amount) {
    let maxDelta = 0;
    for (const band of bands) {
      const target = band.variants[form];
      for (let index = 0; index < target.length; index++) {
        const delta = target[index] - band.current[index];
        band.current[index] += delta * amount;
        maxDelta = Math.max(maxDelta, Math.abs(delta));
      }
    }
    morphing = amount < 1 && maxDelta > .001;
  }

  function rotate(x, y, z, angles, scale = 1, translateY = 0) {
    const cx = Math.cos(angles.x), sx = Math.sin(angles.x), cy = Math.cos(angles.y), sy = Math.sin(angles.y), cz = Math.cos(angles.z), sz = Math.sin(angles.z);
    // Match Three.js Euler XYZ: local points are rotated Z, then Y, then X.
    const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
    const x2 = x1 * cy + z * sy, z2 = -x1 * sy + z * cy;
    return { x: x2 * scale, y: (y1 * cx - z2 * sx) * scale + translateY, z: (y1 * sx + z2 * cx) * scale };
  }

  function project(point) {
    const perspective = focal / Math.max(.1, cameraZ - point.z);
    return { x: width * focusX + point.x * perspective, y: height * .5 - point.y * perspective, z: point.z };
  }

  function frameSculpture(worldBands, delta, immediate) {
    const inset = Math.max(12, Math.min(width, height) * .035);
    const left = Math.max(1, width * focusX - inset), right = Math.max(1, width * (1 - focusX) - inset);
    const vertical = Math.max(1, height * .5 - inset);
    let distance = 4.65;
    for (const points of worldBands) for (const point of points) {
      distance = Math.max(distance, point.z + Math.abs(point.x) * focal / (point.x < 0 ? left : right), point.z + Math.abs(point.y) * focal / vertical);
    }
    distance *= 1.035;
    cameraZ = immediate ? distance : Math.max(distance, cameraZ + (distance - cameraZ) * (1 - Math.exp(-delta * 2.8)));
  }

  function rgb(color, brightness = 1) {
    return `rgb(${color.map(value => Math.round(clamp(value * brightness, 0, 255))).join(',')})`;
  }

  function draw(delta = 0, immediate = false) {
    if (disposed || failed) return;
    try {
      const ease = immediate ? 1 : 1 - Math.exp(-delta * 5);
      smoothed.x += (pointer.x - smoothed.x) * ease;
      smoothed.y += (pointer.y - smoothed.y) * ease;
      smoothRotation.x += (rotation.x - smoothRotation.x) * ease;
      smoothRotation.y += (rotation.y - smoothRotation.y) * ease;
      explosion += ((exploded ? 1 : 0) - explosion) * ease;
      if (morphing) updateGeometry(immediate ? 1 : 1 - Math.exp(-delta * 4.8));
      const animated = reduced.matches ? 0 : time;
      const angles = {
        x: -.28 + Math.sin(animated * .17) * .11 + smoothed.y * .12 + smoothRotation.y,
        y: .24 + animated * (.065 + energy * .055) + smoothed.x * .2 + smoothRotation.x + (reduced.matches ? 0 : scroll * .55),
        z: -.32 + Math.sin(animated * .12) * .07 - (reduced.matches ? 0 : scroll * .25),
      };
      const breathing = 1 + Math.sin(animated * .64) * .014 * energy;
      const floatY = Math.sin(animated * .55) * .055 - (reduced.matches ? 0 : scroll * .18);
      const worldBands = bands.map(band => {
        const spread = explosion * (band.broad ? .35 : .9), points = [];
        for (let index = 0; index < band.current.length; index += 3) points.push(rotate(
          band.current[index] + band.spread[0] * spread,
          band.current[index + 1] + band.spread[1] * spread,
          band.current[index + 2] + band.spread[2] * spread, angles, breathing, floatY,
        ));
        return points;
      });
      frameSculpture(worldBands, delta, immediate);
      ctx.clearRect(0, 0, width, height);
      for (const particle of dust) {
        const point = project(rotate(...particle.point, { x: 0, y: animated * .018, z: 0 }));
        ctx.globalAlpha = .08 + Math.pow(.5 + .5 * Math.sin(particle.phase + animated * .5), 4) * .26;
        ctx.fillStyle = rgb(particle.color);
        ctx.beginPath(); ctx.arc(point.x, point.y, .7, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const faces = [];
      for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
        const band = bands[bandIndex], points = worldBands[bandIndex].map(project);
        // One restrained glow stroke per thread, not one blur per polygon.
        if (!band.broad) {
          ctx.save();
          ctx.globalAlpha = .1 + energy * .08;
          ctx.strokeStyle = rgb(band.color);
          ctx.shadowColor = rgb(band.color);
          ctx.shadowBlur = 7 + energy * 5;
          ctx.lineWidth = Math.max(1.3, band.width * focal / cameraZ * 1.2);
          ctx.beginPath();
          for (let index = 0; index <= segments; index++) {
            const left = points[index * 2], right = points[index * 2 + 1];
            const x = (left.x + right.x) / 2, y = (left.y + right.y) / 2;
            if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
          ctx.stroke(); ctx.restore();
        }
        for (let index = 0; index < segments; index++) {
          const quad = [points[index * 2], points[index * 2 + 2], points[index * 2 + 3], points[index * 2 + 1]];
          const z = quad.reduce((sum, point) => sum + point.z, 0) / 4;
          const pulse = Math.pow(.5 + .5 * Math.sin(index / segments * TAU * 5 - animated * 1.4), 10);
          const brightness = clamp(.62 + (z + 1.7) * .12 + pulse * (.2 + energy * .23), .45, 1.25);
          faces.push({ quad, z, color: band.broad ? rgb([30, 15, 49], .65 + brightness * .6) : rgb(band.color, brightness) });
        }
      }
      faces.sort((a, b) => a.z - b.z);
      ctx.lineJoin = 'round';
      for (const face of faces) {
        ctx.fillStyle = face.color;
        ctx.beginPath();
        face.quad.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        ctx.closePath(); ctx.fill();
      }
      if (!ready) {
        ready = true;
        container.dataset.renderer = 'canvas2d';
        onReady?.({ renderer: 'canvas2d', form, particles: dust.length, mobile });
      }
    } catch (error) {
      failed = true; cancelAnimationFrame(frame); frame = 0;
      container.dataset.renderer = 'unavailable'; onError?.(error);
    }
  }

  function canAnimate() { return !disposed && !failed && !paused && !reduced.matches && visible && !document.hidden; }
  function tick(now) {
    frame = 0;
    if (!canAnimate()) { last = 0; return; }
    const elapsed = last ? (now - last) / 1000 : 1 / 30;
    if (last && elapsed < (mobile ? .03 : .014)) { frame = requestAnimationFrame(tick); return; }
    const delta = Math.min(elapsed, .06);
    last = now; time += delta; draw(delta);
    if (canAnimate()) frame = requestAnimationFrame(tick);
  }
  function wake() {
    if (canAnimate() && !frame) { last = 0; frame = requestAnimationFrame(tick); }
    if (!canAnimate()) { cancelAnimationFrame(frame); frame = 0; last = 0; }
  }
  function explicit() {
    if (!canAnimate() && visible && !document.hidden) draw(0, true);
    wake();
  }
  function setForm(value) {
    if (!FORMS.includes(value) || disposed) return form;
    form = value; morphing = true; container.dataset.form = form; explicit(); return form;
  }
  function setEnergy(value) {
    if (Number.isFinite(Number(value))) energy = clamp(Number(value), 0, 1);
    container.dataset.energy = energy.toFixed(2); explicit(); return energy;
  }
  function setExploded(value) {
    exploded = Boolean(value); container.dataset.exploded = String(exploded); explicit(); return exploded;
  }
  function setPaused(value) {
    paused = Boolean(value); container.dataset.paused = String(paused); explicit(); return paused;
  }
  function resize() {
    if (disposed || failed) return;
    const rect = container.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    focal = height / (2 * Math.tan(41 * Math.PI / 360));
    focusX = window.innerWidth > 760 && width / height > 1 ? .6 : .5;
    visible = rect.bottom > 0 && rect.top < window.innerHeight;
    draw(0, true); wake();
  }

  const previousTouchAction = canvas.style.touchAction, previousCursor = canvas.style.cursor;
  canvas.style.touchAction = 'pan-y'; canvas.style.cursor = 'grab';
  listen(canvas, 'pointerdown', event => {
    if (event.button > 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, rx: rotation.x, ry: rotation.y, active: false, scrolling: false };
  });
  listen(canvas, 'pointermove', event => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = clamp((event.clientX - rect.left) / Math.max(rect.width, 1) * 2 - 1, -1, 1);
    pointer.y = clamp((event.clientY - rect.top) / Math.max(rect.height, 1) * 2 - 1, -1, 1);
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.active && !drag.scrolling && Math.hypot(dx, dy) > 8) {
      if (event.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) drag.scrolling = true;
      else { drag.active = true; canvas.setPointerCapture?.(event.pointerId); canvas.style.cursor = 'grabbing'; }
    }
    if (drag.active) {
      rotation.x = drag.rx + dx * .006; rotation.y = clamp(drag.ry + dy * .004, -1.5, 1.5);
      if (event.cancelable) event.preventDefault();
      if (paused || reduced.matches) explicit();
    }
  }, { passive: false });
  function endDrag(event) {
    if (drag && event.pointerId === drag.id) {
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      drag = null; canvas.style.cursor = 'grab';
    }
  }
  listen(canvas, 'pointerup', endDrag); listen(canvas, 'pointercancel', endDrag);
  listen(canvas, 'lostpointercapture', () => { drag = null; canvas.style.cursor = 'grab'; });
  listen(canvas, 'pointerleave', () => { if (!drag?.active) { pointer.x = 0; pointer.y = 0; } });
  listen(document, 'visibilitychange', () => { if (!document.hidden) explicit(); wake(); });
  listen(reduced, 'change', explicit);
  listen(window, 'scroll', () => {
    const rect = container.getBoundingClientRect();
    scroll = clamp(-rect.top / Math.max(rect.height, 1), 0, 1);
    if (!intersectionObserver) { visible = rect.bottom > 0 && rect.top < window.innerHeight; wake(); }
  }, { passive: true });
  let resizeObserver = null, intersectionObserver = null;
  if (typeof ResizeObserver === 'function') { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container); }
  else listen(window, 'resize', resize, { passive: true });
  if (typeof IntersectionObserver === 'function') {
    intersectionObserver = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) explicit(); wake();
    }, { rootMargin: '80px' });
    intersectionObserver.observe(container);
  }
  container.dataset.form = form; container.dataset.energy = '1.00';
  container.dataset.exploded = 'false'; container.dataset.paused = 'false';
  container.dataset.particles = String(dust.length); container.dataset.antialias = 'canvas';
  resize();

  return {
    setForm, setEnergy, setExploded, setPaused,
    destroy() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame);
      cleanups.forEach(cleanup => cleanup());
      resizeObserver?.disconnect(); intersectionObserver?.disconnect();
      canvas.style.touchAction = previousTouchAction; canvas.style.cursor = previousCursor;
      container.dataset.renderer = 'disposed';
    },
  };
}
