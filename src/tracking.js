import { roundTo } from './format.js';

const DEG = Math.PI / 180;
const SIDEREAL_ARCSEC_PER_HOUR = 54000;

export const TRACKING_LIMITS = {
  seeingArcsec: { min: 0.5, max: 8, label: '视宁度 FWHM（″）' },
  trackingRmsArcsec: { min: 0.02, max: 10, label: '跟踪 RMS 误差（″）' },
  pixelScaleArcsec: { min: 0.2, max: 8, label: '像素尺度（″/px）' },
  subExposureSeconds: { min: 1, max: 3600, label: '单帧曝光（s）' },
  tolerancePixels: { min: 0.1, max: 5, label: '允许漂移（px）' }
};

/** 视宁度与跟踪误差按平方和合成星点 FWHM；σ→FWHM 系数 2.355 */
export function combinedFwhmArcsec({ seeingArcsec, trackingRmsArcsec }) {
  return Math.sqrt(seeingArcsec ** 2 + (2.355 * trackingRmsArcsec) ** 2);
}

export function trackingVerdict({ trackingRmsArcsec, pixelScaleArcsec }) {
  const ratio = trackingRmsArcsec / pixelScaleArcsec;
  let level = '明显拖尾';
  if (ratio <= 0.5) level = '优秀';
  else if (ratio <= 1) level = '可接受';
  else if (ratio <= 2) level = '轻微拖尾';
  return { ratio: roundTo(ratio, 3), level };
}

/** 极轴偏差引起的赤纬漂移率：15°/h × sin(偏差)，单位 ″/h */
export function polarAlignmentDriftArcsecPerHour(polarErrorArcmin) {
  return SIDEREAL_ARCSEC_PER_HOUR * Math.sin(polarErrorArcmin * DEG / 60);
}

/** 反解：让单帧内的极轴漂移不超过 tolerancePixels 个像素，允许的最大极轴误差（角分） */
export function maxPolarErrorArcmin({ pixelScaleArcsec, subExposureSeconds, tolerancePixels = 1 }) {
  const allowedDriftArcsec = pixelScaleArcsec * tolerancePixels;
  const allowedDriftPerHour = (allowedDriftArcsec * 3600) / subExposureSeconds;
  const sinError = allowedDriftPerHour / SIDEREAL_ARCSEC_PER_HOUR;
  if (sinError >= 1) return { maxErrorArcmin: 60, unlimited: true };
  return { maxErrorArcmin: roundTo((Math.asin(sinError) * 180 * 60) / Math.PI, 2), unlimited: false };
}

export function trackingReport(input) {
  const { seeingArcsec, trackingRmsArcsec, pixelScaleArcsec, subExposureSeconds, tolerancePixels = 1 } = input;
  const fwhm = combinedFwhmArcsec({ seeingArcsec, trackingRmsArcsec });
  const fwhmPixels = fwhm / pixelScaleArcsec;
  const verdict = trackingVerdict({ trackingRmsArcsec, pixelScaleArcsec });
  const maxPolarError = maxPolarErrorArcmin({ pixelScaleArcsec, subExposureSeconds, tolerancePixels });

  const notes = [];
  if (fwhmPixels > 3) {
    notes.push(`星点 FWHM 折算 ${roundTo(fwhmPixels, 2)} 像素，明显超出常用 2–3 像素区间，跟踪或视宁度拖累较大。`);
  }
  if (verdict.level === '明显拖尾' || verdict.level === '轻微拖尾') {
    notes.push(`跟踪 RMS 为像素尺度的 ${verdict.ratio} 倍，按经验会出现${verdict.level}。`);
  }
  if (maxPolarError.unlimited === false && maxPolarError.maxErrorArcmin < 2) {
    notes.push(`单帧 ${subExposureSeconds} s 内控制漂移不超过 ${tolerancePixels} 像素，需要极轴误差小于 ${maxPolarError.maxErrorArcmin}′。`);
  }

  return {
    combinedFwhmArcsec: roundTo(fwhm, 2),
    fwhmPixels: roundTo(fwhmPixels, 2),
    trackingRatio: verdict.ratio,
    trackingLevel: verdict.level,
    polarDriftArcsecPerHourAt1Arcmin: roundTo(polarAlignmentDriftArcsecPerHour(1), 2),
    maxPolarErrorArcmin: maxPolarError.maxErrorArcmin,
    polarErrorLimitIsUnlimited: maxPolarError.unlimited,
    notes
  };
}
