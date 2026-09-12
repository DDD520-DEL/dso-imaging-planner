import { formatNumber } from '../format.js';
import { escapeHtml } from './metrics.js';

export function renderTargetList(container, targets, handlers) {
  const all = [...targets.builtin, ...targets.custom];
  if (all.length === 0) {
    container.innerHTML = '<p class="hint">目标库为空。</p>';
    return;
  }

  container.innerHTML = all
    .map(
      (item) => `
      <div class="target-row" data-id="${escapeHtml(item.id)}">
        <div class="target-row__main">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="target-row__meta">
            赤经 ${formatNumber(item.raHours, 2)}h · 赤纬 ${formatNumber(item.decDeg, 2)}° ·
            星等 ${item.magnitude ?? '—'} · 视尺寸 ${item.sizeArcmin ?? '—'}′ · ${escapeHtml(item.category)}
          </span>
        </div>
        <div class="target-row__actions">
          <button type="button" data-action="use">用于可见性</button>
          ${
            item.source === 'custom'
              ? '<button type="button" class="ghost" data-action="delete">删除</button>'
              : '<span class="badge">内置</span>'
          }
        </div>
      </div>`
    )
    .join('');

  for (const button of container.querySelectorAll('button[data-action]')) {
    button.addEventListener('click', () => {
      const id = button.closest('.target-row')?.dataset.id;
      const target = all.find((item) => item.id === id);
      if (!target) return;
      if (button.dataset.action === 'use') handlers.onUse(target);
      else handlers.onDelete(target);
    });
  }
}
