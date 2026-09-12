import { formatNumber, formatSeconds } from '../format.js';
import { metricGrid, warningList } from './metrics.js';

export function renderExposurePanel(container, report) {
  container.hidden = false;
  const required = report.required;
  const requiredText = required.feasible
    ? `${formatSeconds(required.totalExposureSeconds)}（单帧 ${formatSeconds(required.subExposureSeconds)}）`
    : '当前帧数下无法达到';

  container.innerHTML = `
    <h3>曝光与信噪比</h3>
    ${metricGrid([
      ['像素天光通量', `${formatNumber(report.fluxRateEPerSecond, 2)} e-/s`, '按相对通量模型标定'],
      ['单帧信号', `${formatNumber(report.perFrameSignalElectrons, 1)} e-`],
      ['单帧噪声', `${formatNumber(report.perFrameNoiseElectrons, 2)} e-`],
      ['单帧信噪比', formatNumber(report.perFrameSnr, 2)],
      ['叠加总信噪比', formatNumber(report.stackedSnr, 2)],
      ['叠加总信号', `${formatNumber(report.totalSignalElectrons, 0)} e-`],
      ['天空背景主导曝光', formatSeconds(report.skyLimitedSubExposureSeconds), '天光信号达到读出噪声方差 10 倍'],
      ['饱和时间', formatSeconds(report.saturationSeconds)],
      ['推荐单帧曝光', formatSeconds(report.recommendedSubExposureSeconds)],
      ['达标所需总曝光', requiredText]
    ])}
    ${warningList(report.warnings)}
  `;
}
