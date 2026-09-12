export function metric(label, value, hint = '') {
  return `<div class="metric">
      <span class="metric__label">${label}</span>
      <span class="metric__value">${value}</span>
      ${hint ? `<span class="metric__hint">${hint}</span>` : ''}
    </div>`;
}

export function metricGrid(items) {
  return `<div class="metric-grid">${items
    .map(([label, value, hint]) => metric(label, value, hint))
    .join('')}</div>`;
}

export function warningList(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return '<p class="ok">没有触发告警。</p>';
  }
  return `<ul class="warnings">${warnings.map((item) => `<li>${item.message}</li>`).join('')}</ul>`;
}

export function noteList(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return '';
  return `<ul class="notes">${notes.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
