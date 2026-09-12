export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

export function requireBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('请求体必须是 JSON 对象');
  }
  return body;
}

function toFiniteNumber(raw, label) {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    throw new ValidationError(`参数「${label}」必须是数字`);
  }
  return value;
}

export function numberField(body, name, { min, max, label = name, fallback } = {}) {
  const raw = body?.[name];
  if (raw === undefined || raw === null || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`缺少参数「${label}」`);
  }
  const value = toFiniteNumber(raw, label);
  if (min !== undefined && value < min) {
    throw new ValidationError(`参数「${label}」不能小于 ${min}，当前为 ${value}`);
  }
  if (max !== undefined && value > max) {
    throw new ValidationError(`参数「${label}」不能大于 ${max}，当前为 ${value}`);
  }
  return value;
}

export function optionalNumber(body, name, { min, max, label = name } = {}) {
  const raw = body?.[name];
  if (raw === undefined || raw === null || raw === '') return undefined;
  return numberField(body, name, { min, max, label });
}

export function stringField(body, name, { label = name, maxLength = 60, fallback, minLength = 1 } = {}) {
  const raw = body?.[name];
  if (raw === undefined || raw === null || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`缺少参数「${label}」`);
  }
  if (typeof raw !== 'string') {
    throw new ValidationError(`参数「${label}」必须是字符串`);
  }
  const value = raw.trim();
  if (value.length < minLength) {
    throw new ValidationError(`参数「${label}」不能为空`);
  }
  if (value.length > maxLength) {
    throw new ValidationError(`参数「${label}」长度不能超过 ${maxLength} 个字符`);
  }
  return value;
}
