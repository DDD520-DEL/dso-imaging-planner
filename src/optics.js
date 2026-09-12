import { roundTo } from './format.js';

const ARCSEC_PER_RADIAN = 206264.806;

export const OPTICS_LIMITS = {
  focalLengthMm: { min: 50, max: 5000, label: '焦距（mm）' },
  apertureMm: { min: 20, max: 2000, label: '有效口径（mm）' },
  pixelSizeUm: { min: 1, max: 20, label: '像元尺寸（μm）' },
  sensorWidthPx: { min: 500, max: 20000, label: '传感器横向像素数' },
  sensorHeightPx: { min: 500, max: 20000, label: '传感器纵向像素数' },
  seeingArcsec: { min: 0.5, max: 8, label: '视宁度 FWHM（″）' },
  wavelengthNm: { min: 350, max: 1000, label: '参考波长（nm）' }
};

/** 像素角尺度：206264.806 × 像元尺寸(mm) / 焦距(mm)，单位 ″/px */
export function pixelScaleArcsec(focalLengthMm, pixelSizeUm) {
  return (ARCSEC_PER_RADIAN * (pixelSizeUm / 1000)) / focalLengthMm;
}

export function focalRatio(focalLengthMm, apertureMm) {
  return focalLengthMm / apertureMm;
}

export function sensorSizeMm(pixelSizeUm, sensorWidthPx, sensorHeightPx) {
  const unit = pixelSizeUm / 1000;
  return {
    widthMm: sensorWidthPx * unit,
    heightMm: sensorHeightPx * unit
  };
}

export function fieldOfViewDeg(focalLengthMm, sensorWidthMm, sensorHeightMm) {
  const toDeg = (sizeMm) => (2 * Math.atan(sizeMm / (2 * focalLengthMm)) * 180) / Math.PI;
  return {
    widthDeg: toDeg(sensorWidthMm),
    heightDeg: toDeg(sensorHeightMm),
    diagonalDeg: toDeg(Math.hypot(sensorWidthMm, sensorHeightMm))
  };
}

/** 道斯极限：116 / 口径(mm)，单位 ″ */
export function dawesLimitArcsec(apertureMm) {
  return 116 / apertureMm;
}

/** 衍射极限 1.22λ/D，单位 ″ */
export function diffractionLimitArcsec(apertureMm, wavelengthNm = 550) {
  return (ARCSEC_PER_RADIAN * 1.22 * (wavelengthNm * 1e-6)) / apertureMm;
}

export const SAMPLING_BANDS = {
  oversampled: '过采样',
  balanced: '接近理想',
  undersampled: '欠采样'
};

export function samplingVerdict(pixelScale, seeingArcsec) {
  const ratio = pixelScale / seeingArcsec;
  let level = SAMPLING_BANDS.undersampled;
  if (ratio < 1 / 3) level = SAMPLING_BANDS.oversampled;
  else if (ratio <= 1 / 2) level = SAMPLING_BANDS.balanced;

  const note =
    level === SAMPLING_BANDS.balanced
      ? '每像素采样 2–3 个像素覆盖视宁度斑，分辨率与信噪比折中较好。'
      : level === SAMPLING_BANDS.oversampled
        ? '每像素尺度过小，视宁度斑被拆到过多像素上，单像素信号偏弱。'
        : '每像素尺度过大，视宁度斑没被充分采样，细节被压掉。';

  return {
    ratio: roundTo(ratio, 3),
    level,
    note,
    idealScaleMin: roundTo(seeingArcsec / 3, 3),
    idealScaleMax: roundTo(seeingArcsec / 2, 3)
  };
}

export function opticsReport(input) {
  const {
    focalLengthMm,
    apertureMm,
    pixelSizeUm,
    sensorWidthPx,
    sensorHeightPx,
    seeingArcsec,
    wavelengthNm = 550
  } = input;

  const pixelScale = pixelScaleArcsec(focalLengthMm, pixelSizeUm);
  const sensor = sensorSizeMm(pixelSizeUm, sensorWidthPx, sensorHeightPx);
  const fov = fieldOfViewDeg(focalLengthMm, sensor.widthMm, sensor.heightMm);
  const dawes = dawesLimitArcsec(apertureMm);
  const diffraction = diffractionLimitArcsec(apertureMm, wavelengthNm);
  const sampling = samplingVerdict(pixelScale, seeingArcsec);

  return {
    pixelScaleArcsec: roundTo(pixelScale, 3),
    focalRatio: roundTo(focalRatio(focalLengthMm, apertureMm), 2),
    sensorSizeMm: { widthMm: roundTo(sensor.widthMm, 2), heightMm: roundTo(sensor.heightMm, 2) },
    fieldOfView: {
      widthDeg: roundTo(fov.widthDeg, 3),
      heightDeg: roundTo(fov.heightDeg, 3),
      diagonalDeg: roundTo(fov.diagonalDeg, 3)
    },
    dawesLimitArcsec: roundTo(dawes, 3),
    diffractionLimitArcsec: roundTo(diffraction, 3),
    /** 光学与视宁度共同决定的实际可分辨细节：视宁度与衍射极限取大者 */
    effectiveResolutionArcsec: roundTo(Math.max(seeingArcsec, diffraction), 3),
    sampling
  };
}
