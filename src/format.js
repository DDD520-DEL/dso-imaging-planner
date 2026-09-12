const NUMBER_FORMATTERS = new Map();

function formatterFor(digits) {
  if (!NUMBER_FORMATTERS.has(digits)) {
    NUMBER_FORMATTERS.set(
      digits,
      new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: false
      })
    );
  }
  return NUMBER_FORMATTERS.get(digits);
}

export function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return formatterFor(digits).format(roundTo(value, digits));
}

export function formatArcsec(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value, digits)} ″`;
}

export function formatAngle(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value, digits)}°`;
}

export function formatHours(value) {
  if (!Number.isFinite(value)) return '—';
  const totalMinutes = Math.round(value * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} 分`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分`;
}

export function formatSeconds(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 3600) return `${formatNumber(value / 3600, 2)} 小时`;
  if (value >= 60) return `${formatNumber(value / 60, 1)} 分钟`;
  return `${formatNumber(value, 1)} 秒`;
}

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value * 100, digits)}%`;
}

/** 以当地午夜为 0 点的分钟偏移（负数为前一日傍晚）转 HH:MM */
export function formatClockOffset(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
