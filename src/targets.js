import { numberField, optionalNumber, requireBody, stringField, ValidationError } from './validate.js';

export const TARGET_LIMITS = {
  raHours: { min: 0, max: 24, label: '赤经（h）' },
  decDeg: { min: -90, max: 90, label: '赤纬（°）' },
  magnitude: { min: -2, max: 20, label: '视星等' },
  sizeArcmin: { min: 0.1, max: 600, label: '视尺寸（′）' }
};

export const BUILTIN_TARGETS = [
  { id: 'builtin-m31', name: 'M31 仙女座星系', raHours: 0.71, decDeg: 41.27, magnitude: 3.4, sizeArcmin: 178, category: '星系', source: 'builtin' },
  { id: 'builtin-m42', name: 'M42 猎户座大星云', raHours: 5.59, decDeg: -5.39, magnitude: 4, sizeArcmin: 85, category: '发射星云', source: 'builtin' },
  { id: 'builtin-m45', name: 'M45 昴星团', raHours: 3.79, decDeg: 24.1, magnitude: 1.6, sizeArcmin: 110, category: '疏散星团', source: 'builtin' },
  { id: 'builtin-m51', name: 'M51 涡状星系', raHours: 13.5, decDeg: 47.2, magnitude: 8.4, sizeArcmin: 11, category: '星系', source: 'builtin' },
  { id: 'builtin-m81', name: 'M81 波德星系', raHours: 9.93, decDeg: 69.07, magnitude: 6.9, sizeArcmin: 27, category: '星系', source: 'builtin' },
  { id: 'builtin-m101', name: 'M101 风车星系', raHours: 14.05, decDeg: 54.35, magnitude: 7.9, sizeArcmin: 29, category: '星系', source: 'builtin' },
  { id: 'builtin-m13', name: 'M13 武仙座球状星团', raHours: 16.69, decDeg: 36.46, magnitude: 5.8, sizeArcmin: 20, category: '球状星团', source: 'builtin' },
  { id: 'builtin-m8', name: 'M8 礁湖星云', raHours: 18.06, decDeg: -24.38, magnitude: 6, sizeArcmin: 90, category: '发射星云', source: 'builtin' },
  { id: 'builtin-ngc7000', name: 'NGC 7000 北美洲星云', raHours: 20.99, decDeg: 44.3, magnitude: 4, sizeArcmin: 120, category: '发射星云', source: 'builtin' },
  { id: 'builtin-ic1396', name: 'IC 1396 象鼻管星云', raHours: 21.65, decDeg: 57.5, magnitude: 3.5, sizeArcmin: 170, category: '发射星云', source: 'builtin' }
];

export function normalizeTarget(input) {
  requireBody(input);
  const name = stringField(input, 'name', { label: '目标名称', maxLength: 40 });
  const duplicateInBuiltin = BUILTIN_TARGETS.some((item) => item.name === name);
  if (duplicateInBuiltin) {
    throw new ValidationError(`「${name}」已在内置目标库中，不需要重复添加`);
  }

  return {
    name,
    raHours: numberField(input, 'raHours', TARGET_LIMITS.raHours),
    decDeg: numberField(input, 'decDeg', TARGET_LIMITS.decDeg),
    magnitude: optionalNumber(input, 'magnitude', TARGET_LIMITS.magnitude) ?? null,
    sizeArcmin: optionalNumber(input, 'sizeArcmin', TARGET_LIMITS.sizeArcmin) ?? null,
    category: stringField(input, 'category', { label: '目标类别', maxLength: 20, fallback: '自定义' }),
    source: 'custom'
  };
}
