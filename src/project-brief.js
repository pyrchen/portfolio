const names = { frontend: 'Интерфейс', motion: 'Анимация', backend: 'Backend', integration: 'Интеграции', performance: 'Оптимизация', product: 'Новый проект' };
const storageKey = 'pyrchen:brief:v1';
export function normalizeDraft(data) {
  return { text: typeof data?.text === 'string' ? data.text.slice(0, 2000) : '',
    services: Array.isArray(data?.services) ? [...new Set(data.services.filter(service => Object.hasOwn(names, service)))] : [] };
}
export function initBrief() {
  const form = document.querySelector('#brief');
  if (!form) return;
  const text = form.querySelector('#brief-text'), status = form.querySelector('#brief-status');
  const inputs = [...form.querySelectorAll('input[name=service]')];
  const value = () => normalizeDraft({ text: text.value.trim(), services: inputs.filter(input => input.checked).map(input => input.value) });
  const message = (content, error = false) => { status.textContent = content; status.dataset.error = String(error); };
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const draft = normalizeDraft(JSON.parse(saved));
      text.value = draft.text;
      inputs.forEach(input => { input.checked = draft.services.includes(input.value); });
      message('Черновик восстановлен из этого браузера.');
    } else message('Черновик сохраняется только в этом браузере.');
  } catch { message('Хранилище браузера недоступно. Текст можно скопировать.', true); }
  form.addEventListener('input', () => message('Изменения ещё не сохранены.'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const draft = value();
    if (!draft.text && !draft.services.length) { message('Опиши задачу или выбери направление.', true); text.focus(); return; }
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); message('Сохранено в этом браузере. Чтобы отправить мне, скопируй текст в сообщение.'); }
    catch { message('Не удалось сохранить. Скопируй текст, чтобы не потерять его.', true); }
  });
  form.querySelector('#copy-brief').addEventListener('click', async () => {
    const draft = value(), content = [draft.services.map(service => names[service]).join(', '), draft.text].filter(Boolean).join('\n\n');
    if (!content) { message('Сначала опиши задачу или выбери направление.', true); return; }
    try { await navigator.clipboard.writeText(content); message('Текст скопирован. Вставь его в Telegram или письмо.'); }
    catch { message('Не удалось скопировать. Выдели текст вручную.', true); text.focus(); text.select(); }
  });
}
