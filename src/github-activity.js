const mounted = new WeakMap();
const number = new Intl.NumberFormat('ru-RU');
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const dateObject = (date) => new Date(`${date}T00:00:00Z`);
const plural = (value, words) => words[value % 10 === 1 && value % 100 !== 11 ? 0 : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 12 || value % 100 > 14) ? 1 : 2];
const countLabel = (count) => `${number.format(count)} ${plural(count, ['событие', 'события', 'событий'])}`;
const loadingMessage = 'Загрузка статистики…';
const selectionHint = 'Нажми на день, чтобы увидеть, из чего сложилась активность.';
const eventCategories = [
  ['commits', 'Коммиты'], ['pullRequests', 'PR'], ['issues', 'Issues'], ['reviews', 'Ревью'], ['comments', 'Комментарии'],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Mount in <div id="github-activity" data-github-activity></div>. */
export function mountGithubActivity(root = document.querySelector('[data-github-activity]')) {
  if (!root) return null;
  if (mounted.has(root)) return mounted.get(root);
  const status = element('p', 'github-activity-status', loadingMessage);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const summary = element('div', 'github-activity-summary');
  const total = element('p', 'github-activity-total');
  const active = element('p', 'github-activity-active');
  const period = element('p', 'github-activity-period', 'Последние 3 месяца · даты событий UTC');
  summary.append(total, active, period);
  summary.hidden = true;
  const metrics = element('dl', 'github-activity-metrics');
  const metricValues = Object.fromEntries([
    ...eventCategories, ['repositories', 'Проекты'],
  ].map(([key, label]) => {
    const item = element('div', 'github-activity-metric');
    if (key === 'repositories') item.title = 'Проекты с активностью за выбранный период';
    const value = element('dd', 'github-activity-metric-value');
    item.append(element('dt', 'github-activity-metric-label', label), value);
    metrics.append(item);
    return [key, value];
  }));
  metrics.hidden = true;
  const heatmap = element('div', 'github-activity-heatmap');
  heatmap.hidden = true;
  heatmap.setAttribute('role', 'group');
  heatmap.setAttribute('aria-label', 'События по дням. Используй стрелки: вверх и вниз — день, влево и вправо — неделя.');
  const selected = element('div', 'github-activity-selected', selectionHint);
  selected.hidden = true;
  const meta = element('p', 'github-activity-meta');
  const source = element('a', 'github-activity-source', 'Профиль @pyrchen ↗');
  source.href = 'https://github.com/pyrchen';
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  const retry = element('button', 'github-activity-retry', 'Перезагрузить снимок');
  retry.type = 'button';
  const footer = element('div', 'github-activity-footer');
  footer.append(source, retry);
  root.replaceChildren(status, summary, metrics, heatmap, selected, meta, footer);
  let pending = false, destroyed = false, controller = null, timer = null;

  function render(data) {
    root.dataset.state = data.status;
    if (data.status === 'loading') {
      status.textContent = loadingMessage;
      meta.textContent = 'График появится автоматически. Обновлять страницу не нужно.';
      return;
    }
    const available = data.status === 'snapshot' && data.source?.kind === 'authenticated-repository-activity' && data.totals && Array.isArray(data.days) && data.days.length;
    summary.hidden = !available;
    metrics.hidden = !available;
    heatmap.hidden = !available;
    selected.hidden = !available;
    heatmap.replaceChildren();
    if (!available) {
      status.textContent = 'Не удалось загрузить статистику.';
      meta.textContent = 'Попробуй обновить данные позже. Ссылка на профиль GitHub — ниже.';
      return;
    }
    total.textContent = countLabel(data.totals.contributions);
    for (const [key, value] of Object.entries(metricValues)) value.textContent = Number.isFinite(data.totals[key]) ? number.format(data.totals[key]) : '—';
    active.textContent = `${number.format(data.totals.activeDays)} ${plural(data.totals.activeDays, ['активный день', 'активных дня', 'активных дней'])} из ${data.totals.days}`;
    period.textContent = `${shortDate.format(dateObject(data.range.from))} — ${shortDate.format(dateObject(data.range.to))}`;
    status.textContent = 'Рабочая активность · опубликованный снимок';
    const checked = Number.isNaN(Date.parse(data.asOf)) ? '' : `Снимок от ${dateFormat.format(new Date(data.asOf))} · Не обновляется в реальном времени.`;
    const privacy = data.coverage?.privateRepositories > 0 ? ' Закрытые проекты учтены без названий и содержимого.' : '';
    meta.textContent = `${checked}${privacy}`;
    const offset = dateObject(data.days[0].date).getUTCDay();
    heatmap.style.setProperty('--github-weeks', String(Math.ceil((offset + data.days.length) / 7)));
    const buttons = data.days.map((day, index) => {
      const label = `${dateFormat.format(dateObject(day.date))}: ${countLabel(day.count)}`;
      const breakdown = eventCategories.map(([key, name]) => [name, day.breakdown?.[key]]);
      const hasBreakdown = breakdown.every(([, count]) => Number.isFinite(count));
      const details = hasBreakdown ? breakdown.map(([name, count]) => `${name}: ${number.format(count)}`).join(', ') : '';
      const cell = element('button', 'github-activity-day');
      cell.type = 'button';
      cell.dataset.date = day.date;
      cell.dataset.level = String(day.level);
      cell.title = details ? `${label}. ${details}` : label;
      cell.setAttribute('aria-label', cell.title);
      cell.tabIndex = index === 0 ? 0 : -1;
      cell.style.gridRow = String((index + offset) % 7 + 1);
      cell.style.gridColumn = String(Math.floor((index + offset) / 7) + 1);
      const select = () => {
        selected.replaceChildren(element('p', 'github-activity-selected-date', label));
        if (!hasBreakdown) return;
        const detailList = element('dl', 'github-activity-breakdown');
        for (const [name, count] of breakdown) {
          const item = element('div', 'github-activity-breakdown-item');
          item.append(element('dt', '', `${name}:`), element('dd', '', number.format(count)));
          detailList.append(item);
        }
        selected.append(detailList);
      };
      cell.addEventListener('focus', () => {
        buttons.forEach((button) => { button.tabIndex = button === cell ? 0 : -1; });
        select();
      });
      cell.addEventListener('pointerenter', select);
      cell.addEventListener('click', () => { cell.focus(); select(); });
      cell.addEventListener('keydown', (event) => {
        const delta = { ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1 }[event.key];
        if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + delta));
        buttons.forEach((button, i) => { button.tabIndex = i === nextIndex ? 0 : -1; });
        buttons[nextIndex].focus();
      });
      return cell;
    });
    heatmap.append(...buttons);
    selected.textContent = selectionHint;
  }

  async function refresh() {
    if (pending || destroyed) return;
    pending = true;
    root.setAttribute('aria-busy', 'true');
    retry.disabled = true;
    retry.textContent = 'Загрузка…';
    status.textContent = loadingMessage;
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 11_000);
    try {
      const response = await fetch(new URL('./github-activity.json', document.baseURI), { signal: controller.signal, credentials: 'omit', cache: 'no-cache' });
      const data = await response.json();
      if (!response.ok && data.status !== 'unavailable') throw new Error('Unavailable');
      if (!destroyed) {
        render(data);
      }
    } catch {
      if (!destroyed) render({ status: 'unavailable', error: { message: 'Не удалось загрузить календарь. Проверьте соединение или откройте профиль GitHub.' } });
    } finally {
      clearTimeout(timer);
      pending = false;
      if (!destroyed) {
        root.removeAttribute('aria-busy');
        retry.disabled = false;
        retry.textContent = 'Перезагрузить снимок';
      }
    }
  }
  retry.addEventListener('click', refresh);
  const instance = { refresh, destroy() { destroyed = true; clearTimeout(timer); controller?.abort(); retry.removeEventListener('click', refresh); mounted.delete(root); } };
  mounted.set(root, instance);
  root.dataset.state = 'loading';
  refresh();
  return instance;
}
