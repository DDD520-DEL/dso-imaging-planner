import { roundTo } from './format.js';

/**
 * 相对光子通量模型（口径归一化到参考条件）：
 * 参考天空亮度 21.5 mag/arcsec²、有效口径 100 mm、1.5 ″/px、透过率 0.8、量子效率 0.6
 * 时，像素天光通量约为 8.5 e-/s。所有结果都基于这一标定，用于横向比较配置与曝光参数。
 */
export const SKY_REFERENCE_MAG = 21.5;
export const FLUX_SCALE_E_PER_S = 1e-3;

export const EXPOSURE_LIMITS = {
  apertureMm: { min: 20, max: 2000, label: '有效口径（mm）' },
  pixelScaleArcsec: { min: 0.2, max: 8, label: '像素尺度（″/px）' },
  skyBrightness: { min: 16, max: 24, label: '天空亮度（mag/arcsec²）' },
  throughput: { min: 0.1, max: 1, label: '系统透过率' },
  quantumEfficiency: { min: 0.05, max: 1, label: '量子效率' },
  readNoise: { min: 0.5, max: 30, label: '读出噪声（e-）' },
  darkCurrent: { min: 0, max: 5, label: '暗电流（e-/px/s）' },
  fullWell: { min: 1000, max: 500000, label: '满阱容量（e-）' },
  subExposureSeconds: { min: 1, max: 3600, label: '单帧曝光（s）' },
  frames: { min: 1, max: 2000, label: '叠加帧数' },
  targetSnr: { min: 1, max: 500, label: '目标信噪比' }
};

export function skyFluxPerPixel({ apertureMm, pixelScaleArcsec, skyBrightness, throughput, quantumEfficiency }) {
  const skyFactor = 10 ** (-0.4 * (skyBrightness - SKY_REFERENCE_MAG));
  const apertureAreaMm2 = Math.PI * (apertureMm / 2) ** 2;
  const pixelSkyAreaArcsec2 = pixelScaleArcsec ** 2;
  return (
    FLUX_SCALE_E_PER_S *
    skyFactor *
    apertureAreaMm2 *
    pixelSkyAreaArcsec2 *
    throughput *
    quantumEfficiency
  );
}

export function frameSignalNoise({ fluxRate, darkCurrent, readNoise, seconds }) {
  const signal = fluxRate * seconds;
  const variance = signal + darkCurrent * seconds + readNoise ** 2;
  const noise = Math.sqrt(variance);
  return { signal, noise, snr: signal / noise };
}

export function stackSnr({ fluxRate, darkCurrent, readNoise, seconds, frames }) {
  const single = frameSignalNoise({ fluxRate, darkCurrent, readNoise, seconds });
  const totalSignal = single.signal * frames;
  const totalVariance = frames * (single.signal + darkCurrent * seconds + readNoise ** 2);
  return {
    perFrameSnr: single.snr,
    snr: totalSignal / Math.sqrt(totalVariance),
    totalSignal
  };
}

/** 天光信号达到读出噪声方差 10 倍时所需的单帧曝光，经验上的“天空背景主导”起点 */
export function skyLimitedSubExposure({ fluxRate, readNoise }) {
  return (10 * readNoise ** 2) / fluxRate;
}

export function saturationSeconds({ fluxRate, darkCurrent, fullWell }) {
  return fullWell / (fluxRate + darkCurrent);
}

/** 在给定帧数下，二分求解达到目标信噪比所需的单帧曝光与总曝光 */
export function requiredTotalExposure({ fluxRate, darkCurrent, readNoise, frames, targetSnr, maxSubExposureSeconds = 3600 }) {
  const snrAtMax = stackSnr({ fluxRate, darkCurrent, readNoise, seconds: maxSubExposureSeconds, frames }).snr;
  if (snrAtMax < targetSnr) {
    return {
      feasible: false,
      subExposureSeconds: null,
      totalExposureSeconds: null,
      snrAtMaxSubExposure: roundTo(snrAtMax, 2)
    };
  }

  let low = 0.01;
  let high = maxSubExposureSeconds;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const snr = stackSnr({ fluxRate, darkCurrent, readNoise, seconds: mid, frames }).snr;
    if (snr < targetSnr) low = mid;
    else high = mid;
  }

  return {
    feasible: true,
    subExposureSeconds: roundTo(high, 2),
    totalExposureSeconds: roundTo(high * frames, 1),
    snrAtMaxSubExposure: roundTo(snrAtMax, 2)
  };
}

export function exposureEstimate(input) {
  const {
    apertureMm,
    pixelScaleArcsec: pixelScale,
    skyBrightness,
    throughput,
    quantumEfficiency,
    readNoise,
    darkCurrent,
    fullWell,
    subExposureSeconds,
    frames,
    targetSnr
  } = input;

  const fluxRate = skyFluxPerPixel({
    apertureMm,
    pixelScaleArcsec: pixelScale,
    skyBrightness,
    throughput,
    quantumEfficiency
  });

  const single = frameSignalNoise({ fluxRate, darkCurrent, readNoise, seconds: subExposureSeconds });
  const stacked = stackSnr({ fluxRate, darkCurrent, readNoise, seconds: subExposureSeconds, frames });
  const skyLimited = skyLimitedSubExposure({ fluxRate, readNoise });
  const saturation = saturationSeconds({ fluxRate, darkCurrent, fullWell });
  const required = requiredTotalExposure({ fluxRate, darkCurrent, readNoise, frames, targetSnr });

  const warnings = [];
  if (subExposureSeconds > saturation) {
    warnings.push({
      code: 'sub-exposure-over-saturation',
      message: `当前单帧 ${subExposureSeconds} s 已超过饱和时间 ${roundTo(saturation, 1)} s，亮星与天光会溢出。`
    });
  }
  if (subExposureSeconds < skyLimited / 2) {
    warnings.push({
      code: 'read-noise-limited',
      message: `单帧曝光偏短（天空背景主导起点约 ${roundTo(skyLimited, 1)} s），读出噪声在总噪声里占比偏高。`
    });
  }
  if (!required.feasible) {
    warnings.push({
      code: 'insufficient-frames',
      message: `按 ${frames} 帧叠加、单帧上限 3600 s 仍达不到目标信噪比 ${targetSnr}，需要增加帧数或提高口径。`
    });
  }

  return {
    fluxRateEPerSecond: roundTo(fluxRate, 3),
    perFrameSnr: roundTo(single.snr, 2),
    perFrameSignalElectrons: roundTo(single.signal, 1),
    perFrameNoiseElectrons: roundTo(single.noise, 2),
    stackedSnr: roundTo(stacked.snr, 2),
    totalSignalElectrons: roundTo(stacked.totalSignal, 1),
    skyLimitedSubExposureSeconds: roundTo(skyLimited, 1),
    saturationSeconds: roundTo(saturation, 1),
    recommendedSubExposureSeconds: roundTo(Math.min(skyLimited, saturation * 0.8), 1),
    required,
    warnings
  };
}
