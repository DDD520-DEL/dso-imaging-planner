import { formatClockOffset, formatHours, formatNumber, formatPercent } from '../format.js';
import { escapeHtml, metricGrid } from './metrics.js';

// 深色表面校验过的类别色板（CVD 安全，见 dataviz 调色板校验）；第 9 个目标起折叠为中性色，身份靠文字与表格
const TARGET_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767', '#008300'];
const FOLDED_COLOR = '#6b7294';

const REASON_TEXT = {
  'invalid-target': '目标参数无效，已跳过',
  'no-astronomical-night': '当夜太阳始终高于 -18°，没有天文夜',
  'no-window': '整夜升不到最低高度角，无可用观测窗口',
  'window-too-short': '可观测窗口短于所需总曝光时长',
  'no-capacity': '可观测窗口与夜内空档被高优先级目标占满'
};

function colorForTarget(targetIds, targetId) {
  const order = [...new Set(targetIds)];
  const index = order.indexOf(targetId);
  return index < TARGET_COLORS.length ? TARGET_COLORS[index] : FOLDED_COLOR;
}

function pct(value, span) {
  return `${Math.max(0, Math.min(100, (value / span) * 100))}%`;
}

function buildTicks(night) {
  const ticks = [];
  const first = Math.ceil(night.start / 60);
  for (let hour = first; hour * 60 <= night.end; hour += 1) {
    ticks.push({ offset: hour * 60, label: formatClockOffset(hour * 60) });
  }
  return ticks;
}

function timelineTrack(report, exposureIds) {
  const span = report.night.end - report.night.start;
  if (!(span > 0)) {
    return '<p class="error">当夜没有天文夜（太阳始终高于 -18°），无法生成时间线。</p>';
  }

  const ticks = buildTicks(report.night);
  const tickMarks = ticks
    .map(
      (tick) => `
      <div class="sched-track__tick" style="left:${pct(tick.offset - report.night.start, span)}">
        <span>${tick.label}</span>
      </div>`
    )
    .join('');

  const gridlines = ticks
    .map(
      (tick) =>
        `<div class="sched-track__gridline" style="left:${pct(tick.offset - report.night.start, span)}"></div>`
    )
    .join('');

  const segments = report.entries
    .map((entry) => {
      const color = colorForTarget(exposureIds, entry.targetId);
      const width = pct(entry.end - entry.start, span);
      const left = pct(entry.start - report.night.start, span);
      const filterText = entry.filter ? ` · ${escapeHtml(entry.filter)}` : '';
      const kindText = entry.kind === 'setup' ? '切换' : '曝光';
      const title = `${formatClockOffset(entry.start)}–${formatClockOffset(entry.end)} ${entry.targetName}${filterText} · ${kindText} ${entry.durationMinutes} 分钟${
        entry.kind === 'setup' ? `（${escapeHtml(entry.label)}）` : ''
      }`;
      const wideEnough = entry.end - entry.start >= span * 0.07;
      const label =
        wideEnough && entry.kind === 'exposure'
          ? `<span class="sched-seg__label">${escapeHtml(entry.targetName)}${filterText}</span>`
          : '';
      return `
        <div class="sched-seg${entry.kind === 'setup' ? ' sched-seg--setup' : ''}"
             style="left:${left};width:${width};--seg-color:${color}"
             title="${escapeHtml(title)}"
             role="img" aria-label="${escapeHtml(title)}">${label}</div>`;
    })
    .join('');

  return `
    <div class="sched-track" role="group" aria-label="今夜拍摄时间线（精确时间见下方表格）">
      <div class="sched-track__axis">${tickMarks}</div>
      <div class="sched-track__lane">${gridlines}${segments}</div>
      <div class="sched-track__ends">
        <span>天文昏影终 ${formatClockOffset(report.night.start)}</span>
        <span>天文晨光始 ${formatClockOffset(report.night.end)}</span>
      </div>
    </div>`;
}

function utilizationBar(u) {
  const exposureWidth = formatPercent(u.exposureRatio, 1);
  const setupWidth = formatPercent(u.occupiedRatio - u.exposureRatio, 1);
  const idleWidth = formatPercent(Math.max(0, 1 - u.occupiedRatio), 1);
  return `
    <div class="sched-util">
      <div class="sched-util__bar" role="img"
           aria-label="曝光占 ${exposureWidth}，切换占 ${setupWidth}，空闲占 ${idleWidth}">
        <div class="sched-util__seg sched-util__seg--exposure" style="width:${exposureWidth}"></div>
        <div class="sched-util__seg sched-util__seg--setup" style="width:${setupWidth}"></div>
        <div class="sched-util__seg sched-util__seg--idle" style="width:${idleWidth}"></div>
      </div>
      <ul class="sched-util__legend">
        <li><i class="dot dot--exposure"></i>曝光 ${formatHours(u.exposureMinutes / 60)} · ${exposureWidth}</li>
        <li><i class="dot dot--setup"></i>切换 ${formatNumber(u.setupMinutes, 0)} 分钟 · ${setupWidth}</li>
        <li><i class="dot dot--idle"></i>空闲 ${formatHours(u.idleMinutes / 60)} · ${idleWidth}</li>
      </ul>
    </div>`;
}

function legendFor(report, exposureIds) {
  const totals = new Map();
  for (const entry of report.entries) {
    if (entry.kind !== 'exposure') continue;
    const prev = totals.get(entry.targetId) ?? { name: entry.targetName, filter: entry.filter, minutes: 0 };
    prev.minutes += entry.durationMinutes;
    totals.set(entry.targetId, prev);
  }
  return `
    <ul class="sched-legend">
      ${[...totals.entries()]
        .map(([id, info]) => {
          const color = colorForTarget(exposureIds, id);
          return `<li><i class="dot" style="background:${color}"></i>${escapeHtml(info.name)}${
            info.filter ? ` · ${escapeHtml(info.filter)}` : ''
          } <span class="sched-legend__mins">${formatNumber(info.minutes, 0)} 分钟</span></li>`;
        })
        .join('')}
    </ul>`;
}

function warningList(report) {
  if (!report.warnings.length) return '<p class="ok">没有窗口或月光告警。</p>';
  return `<ul class="sched-warnings">
    ${report.warnings
      .map((w) => `<li class="sched-warnings__item sched-warnings__item--${w.level === 'serious' ? 'serious' : 'warn'}">
        ${w.level === 'serious' ? '⛔ ' : '⚠️ '}${escapeHtml(w.message)}
      </li>`)
      .join('')}
  </ul>`;
}

function unscheduledList(report) {
  if (!report.unscheduled.length) return '';
  return `
    <div class="sched-unscheduled">
      <h4>未能排入今夜的目标（${report.unscheduled.length} 个）</h4>
      <ul>
        ${report.unscheduled
          .map(
            (item) => `
          <li>
            <strong>${escapeHtml(item.name)}</strong>
            <span class="sched-unscheduled__meta">
              优先级 ${item.priority} · 需 ${formatNumber(item.exposureMinutes, 0)} 分钟
              ${item.filter ? ` · ${escapeHtml(item.filter)}` : ''}
              ${item.reasonCode === 'no-capacity' && Number.isFinite(item.largestGapMinutes)
                ? ` · 让位后最长空档 ${formatHours(item.largestGapMinutes / 60)}`
                : item.windowMinutes > 0
                  ? ` · 窗口仅 ${formatHours(item.windowMinutes / 60)}`
                  : ''}
            </span>
            <span class="sched-unscheduled__reason">${REASON_TEXT[item.reasonCode] ?? item.reasonCode}</span>
          </li>`
          )
          .join('')}
      </ul>
    </div>`;
}

function entriesTable(report) {
  if (!report.entries.length) return '';
  return `
    <details class="sched-table-wrap">
      <summary>查看逐段时间表（${report.entries.length} 段）</summary>
      <table class="sched-table">
        <thead>
          <tr><th>开始</th><th>结束</th><th>目标</th><th>滤镜</th><th>类型</th><th>时长（分）</th></tr>
        </thead>
        <tbody>
          ${report.entries
            .map(
              (e) => `
            <tr>
              <td>${formatClockOffset(e.start)}</td>
              <td>${formatClockOffset(e.end)}</td>
              <td>${escapeHtml(e.targetName)}</td>
              <td>${e.filter ? escapeHtml(e.filter) : '—'}</td>
              <td>${e.kind === 'setup' ? '切换' : '曝光'}</td>
              <td>${formatNumber(e.durationMinutes, 0)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </details>`;
}

export function renderSchedulePanel(container, report) {
  container.hidden = false;
  const exposureIds = report.entries.filter((e) => e.kind === 'exposure').map((e) => e.targetId);
  const u = report.utilization;

  container.innerHTML = `
    <h3>今夜拍摄排程</h3>
    ${metricGrid([
      ['天文夜', formatHours(report.night.hours)],
      ['曝光总利用率', formatPercent(u.exposureRatio), `已排曝光 ${formatHours(u.exposureMinutes / 60)}`],
      ['时间线占用率', formatPercent(u.occupiedRatio), '含切换开销'],
      ['月相', report.moon.phase, `照亮 ${formatPercent(report.moon.illumination, 0)} · 月龄 ${formatNumber(report.moon.ageDays, 1)} 天`]
    ])}
    ${timelineTrack(report, exposureIds)}
    ${legendFor(report, exposureIds)}
    ${utilizationBar(u)}
    ${entriesTable(report)}
    <h4>窗口与月光提示</h4>
    ${warningList(report)}
    ${unscheduledList(report)}
  `;
}
