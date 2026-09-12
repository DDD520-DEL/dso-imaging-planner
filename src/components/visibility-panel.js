import { formatAngle, formatHours, formatNumber, formatPercent } from '../format.js';
import { metricGrid } from './metrics.js';

const STATUS_TEXT = {
  window: '有观测窗口',
  circumpolar: '恒显目标',
  never: '不可观测',
  degenerate: '极点附近'
};

export function renderVisibilityPanel(container, report) {
  container.hidden = false;
  container.innerHTML = `
    <h3>目标可见性</h3>
    ${metricGrid([
      ['中天高度', formatAngle(report.transitAltitudeDeg, 1)],
      ['可观测时长', formatHours(report.observableHours), STATUS_TEXT[report.observableStatus] ?? ''],
      ['天文夜时长', formatHours(report.astronomicalNightHours)],
      ['午夜高度', formatAngle(report.midnightAltitudeDeg, 1)],
      ['月相', `${report.moon.phase}`],
      ['月亮照亮比例', formatPercent(report.moon.illumination), `月龄 ${formatNumber(report.moon.ageDays, 1)} 天`]
    ])}
    <div class="verdict">
      <strong>${report.verdict}</strong>
      <span>${report.moonNote}</span>
    </div>
  `;
}
