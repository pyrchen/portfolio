import { initKineticType } from './kinetic-type.js';
import { initAtmosphere } from './atmosphere.js';
import { mountGithubActivity } from './github-activity.js';
import { initBrief } from './project-brief.js';
import { initSceneController } from './scene-controller.js';

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const motionButton = document.querySelector('#motion-toggle');
let paused = reduced.matches;
function setPaused(value) {
  paused = value;
  root.dataset.motion = paused ? 'paused' : 'running';
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.textContent = paused ? 'Анимация: выкл' : 'Анимация: вкл';
  window.dispatchEvent(new CustomEvent('portfolio:motion', {detail:{paused}}));
}
setPaused(paused);
motionButton.addEventListener('click', () => setPaused(!paused));
reduced.addEventListener('change', () => setPaused(reduced.matches));
initKineticType({host:document.querySelector('.wordmark-area'),word:document.querySelector('#kinetic-word'),readout:document.querySelector('#word-hint')});
initAtmosphere({canvas:document.querySelector('#site-particles'),root});
mountGithubActivity(document.querySelector('#github-activity'));
initBrief();

// The full-width sculpture loads before it enters view.
const stage = document.querySelector('#hero-stage');
let scene, controller, buttonObserver, recovering = false;
let canvas = document.querySelector('#hero-canvas');
const note = document.querySelector('#scene-note');
const sceneButton = document.querySelector('#toggle-scene');
const connect = () => {
  controller?.destroy();
  buttonObserver?.disconnect();
  controller = initSceneController({scene,canvas,stage,note,formLabel:document.querySelector('#scene-form-label'),autoLabel:document.querySelector('.scene-auto')});
  const updateButton = () => { sceneButton.textContent = stage.dataset.exploded === 'true' ? 'Собрать форму' : 'Разобрать форму'; };
  buttonObserver = new MutationObserver(updateButton);
  buttonObserver.observe(stage,{attributes:true,attributeFilter:['data-exploded']});
  updateButton();
};
function unavailable(error) {
  console.warn('Scene unavailable',error);
  stage.dataset.renderer = 'unavailable';
  note.textContent = 'Не удалось загрузить 3D-сцену. Остальной сайт работает.';
  sceneButton.disabled = true;
  document.querySelector('.scene-renderer').textContent = 'Графика недоступна';
}
async function fallback(error) {
  if (recovering) return;
  recovering = true;
  console.warn('WebGL unavailable, using Canvas 2D',error);
  try {
    const {initNeonFallback} = await import('./neon-fallback.js');
    controller?.destroy(); scene?.destroy();
    const next = canvas.cloneNode(false); canvas.replaceWith(next); canvas = next;
    scene = initNeonFallback({canvas,container:stage,onReady(){stage.dataset.ready='true';document.querySelector('.scene-renderer').textContent='3D / Canvas 2D';},onError:unavailable});
    if(stage.dataset.renderer !== 'unavailable') connect();
  } catch(error) { unavailable(error); }
}
async function loadScene() {
  try {
    const {initNeonScene} = await import('./neon-scene.js');
    scene = initNeonScene({canvas,container:stage,onReady(){stage.dataset.ready='true';},onError:fallback});
    if(!recovering) connect();
  } catch(error) { await fallback(error); }
}
const observer = new IntersectionObserver(entries => {
  if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();loadScene();}
},{rootMargin:'300px'});
observer.observe(stage);
sceneButton.addEventListener('click',()=>{
  if (!scene || stage.dataset.renderer==='unavailable') return;
  canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
});

// Native anchors keep focus, browser history and keyboard skip-link semantics.
