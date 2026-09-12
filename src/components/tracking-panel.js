import { formatArcsec, formatNumber } from '../format.js';
import { metricGrid, noteList } from './metrics.js';

export function renderTrackingPanel(container, report) {
  container.hidden = false;
  const polarLimit = report.polarErrorLimitIsUnlimited
    ? '单帧内几乎不受极轴误差限制'
    : `${formatNumber(report.maxPolarErrorArcmin, 2)} ′`;

  container.innerHTML = `
    <h3>跟踪精度校核</h3>
    ${metricGrid([
      ['合成星点 FWHM', formatArcsec(report.combinedFwhmArcsec, 2), '视宁度与跟踪误差平方和'],
      ['星点 FWHM（像素）', `${formatNumber(report.fwhmPixels, 2)} px`],
      ['跟踪等级', report.trackingLevel, `跟踪 RMS ÷ 像素尺度 = ${formatNumber(report.trackingRatio, 2)}`],
      ['极轴偏差 1′ 的漂移', `${formatArcsec(report.polarDriftArcsecPerHourAt1Arcmin, 1)}/h`],
      ['允许极轴误差', polarLimit, '按单帧漂移不超过 1 像素反解']
    ])}
    ${noteList(report.notes)}
  `;
}
