import { roundTo } from './format.js';

const DEG = Math.PI / 180;
export const SYNODIC_MONTH_DAYS = 29.530588853;
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14);

export const VISIBILITY_LIMITS = {
  latitude: { min: -89.5, max: 89.5, label: '观测地纬度（°）' },
  declination: { min: -89.5, max: 89.5, label: '目标赤纬（°）' },
  minAltitude: { min: 5, max: 80, label: '最低可用高度角（°）' },
  targetRaHours: { min: 0, max: 24, label: '目标赤经（h）' },
  dayOfYear: { min: 1, max: 366, label: '一年中的第几天' }
};

export function transitAltitudeDeg(latitude, declination) {
  return 90 - Math.abs(latitude - declination);
}

export function observableHours(latitude, declination, minAltitude = 20) {
  const lat = latitude * DEG;
  const dec = declination * DEG;
  const alt = minAltitude * DEG;
  const denominator = Math.cos(lat) * Math.cos(dec);
  if (Math.abs(denominator) < 1e-9) {
    return { hours: transitAltitudeDeg(latitude, declination) >= minAltitude ? 24 : 0, status: 'degenerate' };
  }
  const cosH = (Math.sin(alt) - Math.sin(lat) * Math.sin(dec)) / denominator;
  if (cosH >= 1) return { hours: 0, status: 'never' };
  if (cosH <= -1) return { hours: 24, status: 'circumpolar' };
  const halfWindowHours = (Math.acos(cosH) * 12) / Math.PI;
  return { hours: roundTo(2 * halfWindowHours, 2), status: 'window' };
}

/** 太阳赤纬近似：以春分（第 80 天）为 0 点 */
export function solarDeclinationDeg(dayOfYear) {
  return 23.44 * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365.24);
}

/** 太阳赤经近似，单位小时 */
export function solarRaHours(dayOfYear) {
  const lambda = ((dayOfYear - 80) / 365.24) * 2 * Math.PI;
  const epsilon = 23.44 * DEG;
  let ra = Math.atan2(Math.sin(lambda) * Math.cos(epsilon), Math.cos(lambda));
  if (ra < 0) ra += 2 * Math.PI;
  return (ra * 12) / Math.PI;
}

/** 天文夜时长（太阳高度低于 -18°） */
export function astronomicalNightHours(latitude, dayOfYear, sunAltitude = -18) {
  const dec = solarDeclinationDeg(dayOfYear) * DEG;
  const lat = latitude * DEG;
  const alt = sunAltitude * DEG;
  const denominator = Math.cos(lat) * Math.cos(dec);
  if (Math.abs(denominator) < 1e-9) return 12;
  const cosH = (Math.sin(alt) - Math.sin(lat) * Math.sin(dec)) / denominator;
  if (cosH <= -1) return 0;
  if (cosH >= 1) return 24;
  const halfDayHours = (Math.acos(cosH) * 12) / Math.PI;
  return roundTo(24 - 2 * halfDayHours, 2);
}

/** 目标在半夜晚些时候的高度：以太阳反照点赤经为午夜中天赤经的近似 */
export function midnightAltitudeDeg({ latitude, declination, targetRaHours, dayOfYear }) {
  const antiSolarRa = (solarRaHours(dayOfYear) + 12) % 24;
  let deltaHours = Math.abs(targetRaHours - antiSolarRa);
  if (deltaHours > 12) deltaHours = 24 - deltaHours;
  const hourAngle = deltaHours * 15 * DEG;
  const lat = latitude * DEG;
  const dec = declination * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return roundTo(Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG, 2);
}

export function moonIllumination(dateInput) {
  const time = typeof dateInput === 'string' ? Date.parse(dateInput) : Number(dateInput);
  if (!Number.isFinite(time)) {
    throw new RangeError('日期无法解析，需要 ISO 日期字符串或时间戳');
  }
  const elapsedDays = (time - NEW_MOON_EPOCH_MS) / 86400000;
  const ageDays = ((elapsedDays % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
  const illumination = (1 - Math.cos((2 * Math.PI * ageDays) / SYNODIC_MONTH_DAYS)) / 2;
  let phase = '新月前后';
  if (ageDays >= 1.8 && ageDays < 5.5) phase = '娥眉月';
  else if (ageDays >= 5.5 && ageDays < 9.2) phase = '上弦月';
  else if (ageDays >= 9.2 && ageDays < 12.9) phase = '盈凸月';
  else if (ageDays >= 12.9 && ageDays < 16.6) phase = '满月前后';
  else if (ageDays >= 16.6 && ageDays < 20.3) phase = '亏凸月';
  else if (ageDays >= 20.3 && ageDays < 24) phase = '下弦月';
  else if (ageDays >= 24 && ageDays < 27.7) phase = '残月';
  return { ageDays: roundTo(ageDays, 2), illumination: roundTo(illumination, 3), phase };
}

export function visibilityPlan(input) {
  const { latitude, declination, targetRaHours, minAltitude, dayOfYear, date } = input;
  const transit = transitAltitudeDeg(latitude, declination);
  const window = observableHours(latitude, declination, minAltitude);
  const nightHours = astronomicalNightHours(latitude, dayOfYear);
  const midnightAltitude = midnightAltitudeDeg({ latitude, declination, targetRaHours, dayOfYear });
  const moon = moonIllumination(date);

  let verdict;
  if (window.status === 'never') verdict = '目标最高高度都低于设定的最低可用高度角，本地点不可观测。';
  else if (window.status === 'circumpolar') verdict = '目标整夜都在最低高度角以上，属于恒显目标。';
  else if (window.hours >= nightHours) verdict = '目标可观测时长覆盖整个天文夜。';
  else verdict = `目标可观测时长 ${roundTo(window.hours, 1)} 小时，短于天文夜 ${nightHours} 小时，需要挑时段拍。`;

  const moonTolerance =
    moon.illumination >= 0.85
      ? '满月前后，宽带拍摄的天空背景会明显抬升，建议优先窄带或改期。'
      : moon.illumination >= 0.5
        ? '月亮较亮，宽带目标建议避开月亮方向拍摄。'
        : '月亮影响较小。';

  return {
    transitAltitudeDeg: roundTo(transit, 2),
    observableHours: window.hours,
    observableStatus: window.status,
    astronomicalNightHours: nightHours,
    midnightAltitudeDeg: midnightAltitude,
    moon,
    verdict,
    moonNote: moonTolerance
  };
}
