import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const FORMS = ['knot', 'orbit', 'wave'];
const PALETTE = { violet: 0x7775ff, lime: 0xff5db1, cyan: 0x788cff };

/**
 * Real WebGL sculpture. The bands are sampled and woven around custom curves;
 * form changes interpolate their actual position and normal buffers.
 * All controls are owned by the page. No external assets or page selectors.
 */
export function initNeonScene({ canvas, container, onReady, onError } = {}) {
  const noop = { setForm() {}, setPaused() {}, setEnergy() {}, setExploded() {}, destroy() {} };
  if (!canvas || !container) {
    onError?.(new Error('The Three.js scene requires a canvas and a container.'));
    return noop;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const segments = mobile ? 180 : 280;
  const particleCount = mobile ? 70 : 130;
  const cleanups = [];
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
  } catch (error) {
    container.dataset.renderer = 'unavailable';
    onError?.(error);
    return noop;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .76;
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    fail(new Error(`Three.js shader compilation failed: ${gl.getShaderInfoLog(vertexShader) || gl.getShaderInfoLog(fragmentShader) || gl.getProgramInfoLog(program)}`));
  };

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(41, 1, .1, 50);
  camera.position.set(0, 0, 7.6);
  const sculpture = new THREE.Group();
  sculpture.rotation.set(-.28, .24, -.32);
  scene.add(sculpture);
  scene.add(new THREE.AmbientLight(0x655a92, .48));
  const violetLight = new THREE.PointLight(PALETTE.violet, 7, 15, 2);
  violetLight.position.set(-3, 2, 3);
  scene.add(violetLight);
  const cyanLight = new THREE.PointLight(PALETTE.cyan, 2.8, 15, 2);
  cyanLight.position.set(3, -.7, 2);
  scene.add(cyanLight);
  const limeLight = new THREE.PointLight(PALETTE.lime, 1.5, 12, 2);
  limeLight.position.set(0, -3, -2);
  scene.add(limeLight);

  const samples = Math.min(mobile ? 2 : 4, renderer.capabilities.maxSamples);
  const sceneTarget = new THREE.WebGLRenderTarget(640, 640, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, sceneTarget);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.35));
  const renderPass = new RenderPass(scene, camera);
  renderPass.clearAlpha = 0;
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(640, 640), .54, .23, .98);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  const uniforms = { time: { value: 0 }, energy: { value: 1 } };
  let form = 'knot', paused = false, energy = 1, exploded = false;
  let explosion = 0, time = 0, scrollProgress = 0;
  let visible = true, disposed = false, failed = false, ready = false;
  let frame = 0, last = 0, morphing = false;
  let width = 1, height = 1, focal = 1, focusX = .5;
  let drag = null;
  const pointer = new THREE.Vector2();
  const smoothPointer = new THREE.Vector2();
  const dragRotation = new THREE.Vector2();
  const smoothDrag = new THREE.Vector2();

  function listen(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    cleanups.push(() => target.removeEventListener(event, handler, options));
  }

  // Three distinct closed curves, not stock primitive geometries.
  function centerAt(t, mode) {
    if (mode === 'orbit') return new THREE.Vector3(1.94 * Math.cos(t), 1.34 * Math.sin(t), .2 * Math.sin(t * 3));
    if (mode === 'wave') return new THREE.Vector3(2.04 * Math.cos(t), 1.14 * Math.sin(t * 2), .71 * Math.sin(t));
    const radius = 1.45 + .5 * Math.cos(t * 3);
    return new THREE.Vector3(radius * Math.cos(t * 2), radius * Math.sin(t * 2) * .84, .75 * Math.sin(t * 3));
  }

  function buildFrames(mode) {
    const frames = [];
    for (let step = 0; step <= segments; step++) {
      const t = step / segments * TAU;
      const center = centerAt(t, mode);
      const before = centerAt(t - .002, mode), after = centerAt(t + .002, mode);
      const tangent = after.clone().sub(before).normalize();
      const normal = after.clone().add(before).addScaledVector(center, -2);
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
      frames.push({ center, normal, binormal, t });
    }
    return frames;
  }
  const curveFrames = Object.fromEntries(FORMS.map(mode => [mode, buildFrames(mode)]));

  function makeBandGeometry(definition, mode) {
    const positions = new Float32Array((segments + 1) * 6);
    const uvs = new Float32Array((segments + 1) * 4);
    const indices = [];
    const frames = curveFrames[mode];
    for (let step = 0; step <= segments; step++) {
      const { center, normal, binormal, t } = frames[step];
      const winding = definition.phase + t * definition.twist;
      const radial = definition.radius * (1 + .11 * Math.sin(t * 3 + definition.phase));
      for (let side = 0; side < 2; side++) {
        const across = (side - .5) * definition.width;
        const n = Math.cos(winding) * radial - Math.sin(winding) * across;
        const b = Math.sin(winding) * radial + Math.cos(winding) * across;
        const vertex = center.clone().addScaledVector(normal, n).addScaledVector(binormal, b);
        vertex.toArray(positions, step * 6 + side * 3);
        uvs[step * 4 + side * 2] = step / segments;
        uvs[step * 4 + side * 2 + 1] = side;
      }
      if (step < segments) {
        const a = step * 2, b = a + 1, c = a + 2, d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.getAttribute('normal').setUsage(THREE.DynamicDrawUsage);
    geometry.computeBoundingSphere();
    return geometry;
  }

  function bandMaterial(color, broad = false) {
    const material = new THREE.MeshStandardMaterial({
      color: broad ? 0x170d29 : color,
      emissive: color,
      emissiveIntensity: broad ? .11 : 1.36,
      metalness: broad ? .9 : .66,
      roughness: broad ? .28 : .29,
      side: THREE.DoubleSide,
    });
    material.userData.broad = broad;
    material.onBeforeCompile = shader => {
      shader.uniforms.uRibbonTime = uniforms.time;
      shader.uniforms.uRibbonEnergy = uniforms.energy;
      shader.vertexShader = `varying float vRibbonU;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRibbonU = uv.x;');
      shader.fragmentShader = `uniform float uRibbonTime;\nuniform float uRibbonEnergy;\nvarying float vRibbonU;\n${shader.fragmentShader}`
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float travellingLight = pow(0.5 + 0.5 * sin(vRibbonU * 31.4159 - uRibbonTime * 1.4), 12.0);
          totalEmissiveRadiance *= 0.72 + travellingLight * (0.3 + uRibbonEnergy * 0.65);`);
    };
    material.customProgramCacheKey = () => 'pyrchen-woven-ribbon-v1';
    return material;
  }

  const definitions = [];
  // Broad dark-metal ribbons carry the silhouette; thin lit threads weave over them.
  for (let index = 0; index < 3; index++) definitions.push({ phase: index / 3 * TAU, radius: .205, width: .23, twist: 2, color: PALETTE.violet, broad: true });
  const threadCount = mobile ? 10 : 14;
  for (let index = 0; index < threadCount; index++) definitions.push({
    phase: index / threadCount * TAU + .16,
    radius: .275 + (index % 3 === 0 ? .026 : 0),
    width: index % 5 === 0 ? .044 : .023,
    twist: 2,
    color: index === threadCount - 1 ? PALETTE.lime : index === 4 || (threadCount > 10 && index === 9) ? PALETTE.cyan : PALETTE.violet,
    broad: false,
  });

  const bands = definitions.map((definition, index) => {
    const geometry = makeBandGeometry(definition, 'knot');
    const material = bandMaterial(definition.color, definition.broad);
    const mesh = new THREE.Mesh(geometry, material);
    // The form buffers change, so avoid a stale bounding sphere culling a morph.
    mesh.frustumCulled = false;
    sculpture.add(mesh);
    const buffers = {};
    for (const mode of FORMS) {
      const source = mode === 'knot' ? geometry : makeBandGeometry(definition, mode);
      buffers[mode] = {
        position: source.getAttribute('position').array.slice(),
        normal: source.getAttribute('normal').array.slice(),
      };
      if (source !== geometry) source.dispose();
    }
    const spread = new THREE.Vector3(Math.cos(definition.phase), Math.sin(definition.phase), Math.sin(index * 1.3) * .65).normalize();
    return { mesh, geometry, material, buffers, spread, definition };
  });

  // Small, depth-aware points. The shader draws their circles; no image sprite.
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const particlePhases = new Float32Array(particleCount);
  const paletteColors = Object.values(PALETTE).map(color => new THREE.Color(color));
  for (let index = 0; index < particleCount; index++) {
    const seed = fraction(Math.sin(index * 127.1 + 41.7) * 43758.5453);
    const seed2 = fraction(Math.sin(index * 269.5 + 19.3) * 12783.143);
    const angle = index * 2.399963;
    const radius = 2.4 + seed * 1.65;
    particlePositions.set([Math.cos(angle) * radius, Math.sin(angle) * radius * .76, (seed2 - .5) * 4.8], index * 3);
    paletteColors[index % 3].toArray(particleColors, index * 3);
    particlePhases[index] = seed * TAU;
  }
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
  particleGeometry.setAttribute('aPhase', new THREE.BufferAttribute(particlePhases, 1));
  const particleMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: uniforms.time, uEnergy: uniforms.energy, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) } },
    vertexShader: `attribute vec3 color;
      attribute float aPhase;
      uniform float uTime;
      uniform float uEnergy;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.18 + aPhase) * 0.15;
        p.y += cos(uTime * 0.15 + aPhase) * 0.13;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((1.0 + uEnergy * 0.65) * uPixelRatio * 9.0 / -mv.z, 1.0, 3.7);
        vColor = color;
        vOpacity = 0.08 + pow(0.5 + 0.5 * sin(aPhase + uTime * 0.5), 4.0) * 0.28;
      }`,
    fragmentShader: `varying vec3 vColor;
      varying float vOpacity;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        float alpha = (1.0 - smoothstep(0.18, 0.5, radius)) * vOpacity;
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(vColor * 1.2, alpha);
      }`,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  function fraction(value) { return value - Math.floor(value); }

  function updateGeometry(amount = 1) {
    let largestDelta = 0;
    for (const band of bands) {
      const positions = band.geometry.getAttribute('position');
      const normals = band.geometry.getAttribute('normal');
      const target = band.buffers[form];
      for (let index = 0; index < positions.array.length; index++) {
        const delta = target.position[index] - positions.array[index];
        largestDelta = Math.max(largestDelta, Math.abs(delta));
        positions.array[index] += delta * amount;
        normals.array[index] += (target.normal[index] - normals.array[index]) * amount;
      }
      positions.needsUpdate = true;
      normals.needsUpdate = true;
    }
    morphing = largestDelta > .001 && amount < 1;
  }

  function frameSculpture(delta, immediate) {
    // Fit the actual rotated ribbons, including their current exploded offsets.
    // A fixed distant camera made a wider stage larger without enlarging the work.
    sculpture.updateMatrix();
    const matrix = sculpture.matrix.elements;
    const inset = Math.max(12, Math.min(width, height) * .035);
    const left = Math.max(1, width * focusX - inset);
    const right = Math.max(1, width * (1 - focusX) - inset);
    const vertical = Math.max(1, height * .5 - inset);
    let distance = 4.65;
    for (const band of bands) {
      const positions = band.geometry.getAttribute('position').array;
      const offset = band.mesh.position;
      // Every fourth curve sample, both ribbon edges; margins cover between-sample extrema.
      for (let sample = 0; sample < positions.length; sample += 24) {
        for (let side = 0; side < 2; side++) {
          const index = sample + side * 3;
          if (index + 2 >= positions.length) continue;
          const x = positions[index] + offset.x;
          const y = positions[index + 1] + offset.y;
          const z = positions[index + 2] + offset.z;
          const worldX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
          const worldY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
          const worldZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
          distance = Math.max(distance, worldZ + Math.abs(worldX) * focal / (worldX < 0 ? left : right), worldZ + Math.abs(worldY) * focal / vertical);
        }
      }
    }
    distance *= 1.035;
    // Never let the expanding ribbons outrun the lens; ease only the return zoom.
    camera.position.z = immediate ? distance : Math.max(distance, THREE.MathUtils.damp(camera.position.z, distance, 2.8, delta));
  }

  function updateObject(delta = 0, immediate = false) {
    const lerp = immediate ? 1 : 1 - Math.exp(-delta * 5);
    smoothPointer.lerp(pointer, lerp);
    smoothDrag.lerp(dragRotation, lerp);
    explosion += ((exploded ? 1 : 0) - explosion) * lerp;
    const animatedTime = reducedMotion.matches ? 0 : time;
    const scroll = reducedMotion.matches ? 0 : scrollProgress;
    sculpture.rotation.x = -.28 + Math.sin(animatedTime * .17) * .11 + smoothPointer.y * .12 + smoothDrag.y;
    sculpture.rotation.y = .24 + animatedTime * (.065 + energy * .055) + smoothPointer.x * .2 + smoothDrag.x + scroll * .55;
    sculpture.rotation.z = -.32 + Math.sin(animatedTime * .12) * .07 - scroll * .25;
    sculpture.position.y = Math.sin(animatedTime * .55) * .055 - scroll * .18;
    const breathing = 1 + Math.sin(animatedTime * .64) * .014 * energy;
    sculpture.scale.setScalar(breathing);
    for (const band of bands) band.mesh.position.copy(band.spread).multiplyScalar(explosion * (band.definition.broad ? .35 : .9));
    particles.rotation.y = animatedTime * .018;
    particles.rotation.z = animatedTime * .008;
    frameSculpture(delta, immediate);
  }

  function fail(error) {
    if (failed || disposed) return;
    failed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    container.dataset.renderer = 'unavailable';
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  function render() {
    if (disposed || failed) return;
    try {
      composer.render();
      if (failed) return;
      if (!ready) {
        ready = true;
        container.dataset.renderer = 'three';
        container.dataset.form = form;
        container.dataset.particles = String(particleCount);
        onReady?.({ renderer: 'three', form, particles: particleCount, mobile });
      }
    } catch (error) { fail(error); }
  }

  function canAnimate() {
    return !disposed && !failed && visible && !document.hidden && !paused && !reducedMotion.matches;
  }

  function tick(now) {
    frame = 0;
    if (!canAnimate()) { last = 0; return; }
    const elapsed = last ? (now - last) / 1000 : 1 / 60;
    if (last && mobile && elapsed < .03) { frame = requestAnimationFrame(tick); return; }
    const delta = Math.min(elapsed, .055);
    last = now;
    time += delta;
    uniforms.time.value = time;
    if (morphing) updateGeometry(1 - Math.exp(-delta * 4.8));
    updateObject(delta);
    render();
    if (canAnimate()) frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (canAnimate() && !frame) { last = 0; frame = requestAnimationFrame(tick); }
    if (!canAnimate()) { cancelAnimationFrame(frame); frame = 0; last = 0; }
  }

  function explicitRender() {
    if (!canAnimate()) {
      if (morphing) updateGeometry(1);
      updateObject(0, true);
      render();
    }
    wake();
  }

  function setForm(value) {
    if (!FORMS.includes(value) || disposed || failed) return form;
    form = value;
    container.dataset.form = value;
    morphing = true;
    explicitRender();
    return form;
  }

  function setPaused(value) {
    paused = Boolean(value);
    container.dataset.paused = String(paused);
    if (paused) { if (morphing) updateGeometry(1); updateObject(0, true); render(); }
    wake();
    return paused;
  }

  function setEnergy(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return energy;
    energy = clamp(parsed, 0, 1);
    uniforms.energy.value = energy;
    bloomPass.strength = .28 + energy * .26;
    for (const band of bands) band.material.emissiveIntensity = band.definition.broad ? .04 + energy * .07 : .68 + energy * .68;
    container.dataset.energy = energy.toFixed(2);
    explicitRender();
    return energy;
  }

  function setExploded(value) {
    exploded = Boolean(value);
    container.dataset.exploded = String(exploded);
    explicitRender();
    return exploded;
  }

  function resize() {
    if (disposed || failed) return;
    const rect = container.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    focal = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    focusX = window.innerWidth > 760 && camera.aspect > 1 ? .6 : .5;
    // Shift the optical center instead of spending geometry scale on an empty left column.
    camera.setViewOffset(width, height, (.5 - focusX) * width, 0, width, height);
    camera.updateProjectionMatrix();
    updateObject(0, true);
    render();
    wake();
  }

  function onPointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1), clamp((event.clientY - rect.top) / rect.height * 2 - 1, -1, 1));
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (!drag.active && !drag.scroll && Math.hypot(dx, dy) > 8) {
        if (event.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) drag.scroll = true;
        else { drag.active = true; canvas.setPointerCapture?.(event.pointerId); canvas.style.cursor = 'grabbing'; }
      }
      if (drag.active) {
        dragRotation.set(drag.rotationX + dx * .006, clamp(drag.rotationY + dy * .004, -1.5, 1.5));
        if (event.cancelable) event.preventDefault();
        if (paused || reducedMotion.matches) explicitRender();
      }
    }
  }

  const oldTouchAction = canvas.style.touchAction, oldCursor = canvas.style.cursor;
  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'grab';
  listen(canvas, 'pointermove', onPointerMove, { passive: false });
  listen(canvas, 'pointerdown', event => {
    if (event.button > 0) return;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, rotationX: dragRotation.x, rotationY: dragRotation.y, active: false, scroll: false };
  });
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag = null; canvas.style.cursor = 'grab';
  }
  listen(canvas, 'pointerup', endDrag);
  listen(canvas, 'pointercancel', endDrag);
  listen(canvas, 'lostpointercapture', () => { drag = null; canvas.style.cursor = 'grab'; });
  listen(canvas, 'pointerleave', () => { if (!drag?.active) pointer.set(0, 0); });
  listen(window, 'scroll', () => {
    const rect = container.getBoundingClientRect();
    scrollProgress = clamp(-rect.top / Math.max(rect.height, 1), 0, 1);
  }, { passive: true });
  listen(document, 'visibilitychange', wake);
  listen(reducedMotion, 'change', () => {
    if (reducedMotion.matches) { if (morphing) updateGeometry(1); updateObject(0, true); render(); }
    wake();
  });
  listen(canvas, 'webglcontextlost', event => {
    event.preventDefault();
    fail(new Error('The WebGL context was lost. Reload the page to restore the scene.'));
  });
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? true;
    wake();
  }, { rootMargin: '80px' });
  intersectionObserver.observe(container);

  container.dataset.form = form;
  container.dataset.paused = 'false';
  container.dataset.exploded = 'false';
  container.dataset.energy = energy.toFixed(2);
  container.dataset.antialias = `msaa${samples}`;
  resize();

  return {
    setForm, setPaused, setEnergy, setExploded,
    destroy() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      cleanups.forEach(cleanup => cleanup());
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      for (const band of bands) { band.geometry.dispose(); band.material.dispose(); }
      particleGeometry.dispose(); particleMaterial.dispose();
      renderPass.dispose(); bloomPass.dispose(); outputPass.dispose(); composer.dispose();
      renderer.dispose();
      canvas.style.touchAction = oldTouchAction;
      canvas.style.cursor = oldCursor;
      container.dataset.renderer = 'disposed';
    },
  };
}
