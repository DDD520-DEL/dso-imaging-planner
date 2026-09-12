import { formatAngle, formatArcsec, formatNumber } from '../format.js';
import { metricGrid } from './metrics.js';

export function renderOpticsPanel(container, report) {
  container.hidden = false;
  const tone =
    report.sampling.level === '接近理想' ? 'good' : report.sampling.level === '欠采样' ? 'warn' : 'info';

  container.innerHTML = `
    <h3>光学采样与视场</h3>
    ${metricGrid([
      ['像素尺度', `${formatArcsec(report.pixelScaleArcsec)}/px`, '每像素对应的天区角尺度'],
      ['焦比', `f/${formatNumber(report.focalRatio, 1)}`, '焦距 ÷ 有效口径'],
      [
        '传感器画幅',
        `${formatNumber(report.sensorSizeMm.widthMm, 1)} × ${formatNumber(report.sensorSizeMm.heightMm, 1)} mm`
      ],
      ['视场宽度', formatAngle(report.fieldOfView.widthDeg, 2)],
      ['视场高度', formatAngle(report.fieldOfView.heightDeg, 2)],
      ['视场对角', formatAngle(report.fieldOfView.diagonalDeg, 2)],
      ['道斯极限', formatArcsec(report.dawesLimitArcsec, 2), '口径决定的理论分辨上限'],
      ['衍射极限', formatArcsec(report.diffractionLimitArcsec, 2), '按 1.22λ/D 估算'],
      ['实际可分辨细节', formatArcsec(report.effectiveResolutionArcsec, 2), '视宁度与衍射极限取大者']
    ])}
    <div class="verdict verdict--${tone}">
      <strong>采样判定：${report.sampling.level}</strong>
      <span>像素尺度 ÷ 视宁度 = ${formatNumber(report.sampling.ratio, 3)}，理想区间 ${formatNumber(report.sampling.idealScaleMin, 2)}–${formatNumber(report.sampling.idealScaleMax, 2)} ″/px</span>
      <span>${report.sampling.note}</span>
    </div>
  `;
}
