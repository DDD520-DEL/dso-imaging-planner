import { roundTo } from './format.js';
import { pixelScaleArcsec } from './optics.js';
import { ValidationError, numberField, stringField } from './validate.js';

/** 器材类型与链路角色：chain=true 的进入光路累加，guider 只计重量与导星采样比 */
export const ITEM_TYPES = {
  ota: { label: '主镜', chain: true },
  focuser: { label: '调焦座', chain: true },
  filterWheel: { label: '滤镜轮', chain: true },
  adapter: { label: '转接环', chain: true },
  camera: { label: '相机', chain: true },
  guider: { label: '导星设备', chain: false }
};

/** 螺纹/卡口接口编码；M 螺纹按「同规格 + 内外互补」对接，卡口按同规格对接 */
export const THREADS = {
  M42M: { label: 'M42 外', size: 'M42', gender: 'M' },
  M42F: { label: 'M42 内', size: 'M42', gender: 'F' },
  M48M: { label: 'M48 外', size: 'M48', gender: 'M' },
  M48F: { label: 'M48 内', size: 'M48', gender: 'F' },
  M54M: { label: 'M54 外', size: 'M54', gender: 'M' },
  M54F: { label: 'M54 内', size: 'M54', gender: 'F' },
  B2: { label: '2″ 卡口', size: 'B2', gender: 'B' },
  B125: { label: '1.25″ 卡口', size: 'B125', gender: 'B' },
  NONE: { label: '无（链路端点）', size: 'NONE', gender: 'N' }
};

/** 常见转接环厚度（mm），任意 0.5 的倍数都能精确拼出 */
export const SPACER_SIZES_MM = [20, 10, 5, 3, 2, 1, 0.5];

/** 调焦行程可吸收的偏差：缺口或超出不足 0.5 mm 都不必加环、也不判超长 */
export const FOCUS_TRAVEL_TOLERANCE_MM = 0.5;

export const TRAIN_LIMITS = {
  payloadMarginKg: { min: 0, max: 100, label: '赤道仪载重余量（kg）' },
  lengthMm: { min: 0, max: 500, label: '占位长度（mm）' },
  requiredBackfocusMm: { min: 0, max: 400, label: '要求后截距（mm）' },
  focalLengthMm: { min: 50, max: 5000, label: '主镜焦距（mm）' },
  pixelSizeUm: { min: 1, max: 20, label: '相机像元（μm）' },
  guideFocalLengthMm: { min: 50, max: 2000, label: '导星焦距（mm）' },
  guidePixelSizeUm: { min: 1, max: 20, label: '导星像元（μm）' },
  weightG: { min: 0, max: 50000, label: '重量（g）' }
};

export function threadLabel(code) {
  return THREADS[code]?.label ?? code;
}

/** 上游后接口与下游前接口是否可直接对接 */
export function threadsMatch(rearCode, frontCode) {
  const rear = THREADS[rearCode];
  const front = THREADS[frontCode];
  if (!rear || !front) return false;
  if (rear.gender === 'N' || front.gender === 'N') return false;
  if (rear.size !== front.size) return false;
  if (rear.gender === 'B' || front.gender === 'B') return rear.gender === 'B' && front.gender === 'B';
  return rear.gender !== front.gender;
}

function readThread(body, name, { allowNone = false, label }) {
  const raw = body?.[name];
  if (raw === undefined || raw === null || raw === '') {
    if (allowNone) return 'NONE';
    throw new ValidationError(`缺少参数「${label}」`);
  }
  const code = String(raw).trim().toUpperCase();
  if (!THREADS[code] || (!allowNone && code === 'NONE')) {
    throw new ValidationError(`参数「${label}」不是受支持的接口规格：${String(raw).slice(0, 20)}`);
  }
  return code;
}

/** 校验单件器材，返回规范化的 item；类型决定必填字段 */
export function normalizeItem(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(`第 ${index + 1} 件器材必须是对象`);
  }
  const type = String(raw.type ?? '').trim();
  if (!ITEM_TYPES[type]) {
    throw new ValidationError(`第 ${index + 1} 件器材的类型无效（应为 ${Object.keys(ITEM_TYPES).join('/')}）`);
  }
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, 30)
      : `${ITEM_TYPES[type].label} ${index + 1}`;
  const at = (label) => `「${name}」${label}`;
  const item = {
    type,
    name,
    weightG: numberField(raw, 'weightG', { ...TRAIN_LIMITS.weightG, label: at('重量（g）') })
  };

  if (type === 'ota') {
    item.focalLengthMm = numberField(raw, 'focalLengthMm', {
      ...TRAIN_LIMITS.focalLengthMm,
      label: at('焦距（mm）')
    });
    item.requiredBackfocusMm = numberField(raw, 'requiredBackfocusMm', {
      ...TRAIN_LIMITS.requiredBackfocusMm,
      label: at('要求后截距（mm）')
    });
    item.threadFront = 'NONE';
    item.threadRear = readThread(raw, 'threadRear', { label: at('后端接口') });
  } else if (type === 'camera') {
    item.lengthMm = numberField(raw, 'lengthMm', { ...TRAIN_LIMITS.lengthMm, label: at('法兰距（mm）') });
    item.pixelSizeUm = numberField(raw, 'pixelSizeUm', {
      ...TRAIN_LIMITS.pixelSizeUm,
      label: at('像元（μm）')
    });
    item.threadFront = readThread(raw, 'threadFront', { label: at('前端接口') });
    item.threadRear = 'NONE';
  } else if (type === 'guider') {
    item.guideFocalLengthMm = numberField(raw, 'guideFocalLengthMm', {
      ...TRAIN_LIMITS.guideFocalLengthMm,
      label: at('导星焦距（mm）')
    });
    item.guidePixelSizeUm = numberField(raw, 'guidePixelSizeUm', {
      ...TRAIN_LIMITS.guidePixelSizeUm,
      label: at('导星像元（μm）')
    });
    item.threadFront = 'NONE';
    item.threadRear = 'NONE';
  } else {
    item.lengthMm = numberField(raw, 'lengthMm', { ...TRAIN_LIMITS.lengthMm, label: at('占位长度（mm）') });
    item.threadFront = readThread(raw, 'threadFront', { label: at('前端接口') });
    item.threadRear = readThread(raw, 'threadRear', { label: at('后端接口') });
  }
  return item;
}

/** 把缺口毫米数（向下取到 0.5）拆成标准转接环组合，返回 [{thicknessMm, count}] 与余量 */
export function suggestSpacers(gapMm) {
  const target = Math.floor(gapMm * 2 + 1e-9) / 2;
  let rest = Math.round(target * 10); // 0.1mm 整数运算，避免浮点误差
  const spacers = [];
  for (const size of SPACER_SIZES_MM) {
    const unit = Math.round(size * 10);
    const count = Math.floor(rest / unit);
    if (count > 0) {
      spacers.push({ thicknessMm: size, count });
      rest -= count * unit;
    }
  }
  const spacerTotalMm = roundTo(target, 1);
  return {
    spacers,
    spacerTotalMm,
    residualMm: roundTo(gapMm - spacerTotalMm, 2)
  };
}

function guideReport(ota, camera, guider) {
  if (!guider) return null;
  const mainScale = pixelScaleArcsec(ota.focalLengthMm, camera.pixelSizeUm);
  const guideScale = pixelScaleArcsec(guider.guideFocalLengthMm, guider.guidePixelSizeUm);
  const ratio = guideScale / mainScale;
  let level = '偏大';
  if (ratio <= 2) level = '充裕';
  else if (ratio <= 4) level = '可用';
  const note =
    level === '充裕'
      ? '导星像素尺度足够细，修正精度充裕。'
      : level === '可用'
        ? '处于常见可用区间，导星修正精度一般够用。'
        : '导星像素尺度偏粗，建议换更长焦距的导星镜或更小像元的导星相机。';
  return {
    mainScaleArcsec: roundTo(mainScale, 3),
    guideScaleArcsec: roundTo(guideScale, 3),
    ratio: roundTo(ratio, 2),
    level,
    note
  };
}

/**
 * 器材齐套校核：光路长度累加 vs 主镜要求后截距，接口逐节匹配，总重 vs 载重余量。
 * 结构性问题（缺主镜/相机、顺序错误）抛 ValidationError；
 * 接口不匹配、超长、超重作为 problems 返回，由页面展示。
 */
export function chainReport(input) {
  const { payloadMarginKg, items } = input;
  const chain = items.filter((item) => ITEM_TYPES[item.type].chain);
  const guider = items.find((item) => item.type === 'guider');

  const otaCount = chain.filter((item) => item.type === 'ota').length;
  const cameraCount = chain.filter((item) => item.type === 'camera').length;
  if (otaCount !== 1) throw new ValidationError('器材清单里需要且只能有一件主镜');
  if (cameraCount !== 1) throw new ValidationError('器材清单里需要且只能有一台相机');
  if (chain[0].type !== 'ota') throw new ValidationError('主镜必须排在光路最前');
  if (chain[chain.length - 1].type !== 'camera') throw new ValidationError('相机必须排在光路末端');

  const ota = chain[0];
  const camera = chain[chain.length - 1];
  const problems = [];

  // 逐节接口匹配 + 链路长度累加
  let cumulativeMm = 0;
  const rows = chain.map((item, index) => {
    const lengthMm = item.type === 'ota' ? 0 : item.lengthMm;
    let joint = null;
    if (index > 0) {
      const prev = chain[index - 1];
      const ok = threadsMatch(prev.threadRear, item.threadFront);
      joint = {
        ok,
        detail: `${threadLabel(prev.threadRear)} ↔ ${threadLabel(item.threadFront)}`
      };
      if (!ok) {
        problems.push({
          code: 'thread-mismatch',
          message: `第 ${index} 节「${prev.name}」后端（${threadLabel(prev.threadRear)}）与「${item.name}」前端（${threadLabel(item.threadFront)}）接不上，需要换转接环或改接口。`
        });
      }
    }
    cumulativeMm = roundTo(cumulativeMm + lengthMm, 2);
    return {
      name: item.name,
      type: item.type,
      typeLabel: ITEM_TYPES[item.type].label,
      lengthMm,
      cumulativeMm,
      joint
    };
  });

  const totalLengthMm = cumulativeMm;
  const gapMm = roundTo(ota.requiredBackfocusMm - totalLengthMm, 2);

  let focus;
  if (Math.abs(gapMm) < FOCUS_TRAVEL_TOLERANCE_MM) {
    // 两个方向对称：偏差不足 0.5 mm 一律由调焦行程吸收
    focus = { status: 'exact', spacers: [], spacerTotalMm: 0, residualMm: 0 };
  } else if (gapMm > 0) {
    focus = { status: 'need-spacer', ...suggestSpacers(gapMm) };
  } else {
    focus = { status: 'over-length', spacers: [], spacerTotalMm: 0, residualMm: 0 };
    problems.push({
      code: 'over-length',
      message: `链路总长 ${totalLengthMm} mm，超出要求后截距 ${roundTo(-gapMm, 2)} mm，加转接环无法解决，需要减薄部件或缩短调焦座占位。`
    });
  }

  // 重量：全部器材（含导星设备）都压在赤道仪上
  const totalWeightG = roundTo(
    items.reduce((sum, item) => sum + item.weightG, 0),
    1
  );
  const marginG = roundTo(payloadMarginKg * 1000, 1);
  const weightOk = totalWeightG <= marginG;
  if (!weightOk) {
    problems.push({
      code: 'overweight',
      message: `整套器材 ${(totalWeightG / 1000).toFixed(2)} kg，超出赤道仪载重余量 ${roundTo((totalWeightG - marginG) / 1000, 2)} kg。`
    });
  }

  return {
    chain: rows,
    requiredBackfocusMm: ota.requiredBackfocusMm,
    totalLengthMm,
    gapMm,
    focus,
    weight: {
      totalG: totalWeightG,
      marginG,
      ok: weightOk,
      excessG: weightOk ? 0 : roundTo(totalWeightG - marginG, 1)
    },
    guide: guideReport(ota, camera, guider),
    problems,
    ok: problems.length === 0
  };
}

/** 服务端入口：校验请求体并输出报告 */
export function readTrainInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('请求体必须是 JSON 对象');
  }
  if (!Array.isArray(body.items) || body.items.length < 2) {
    throw new ValidationError('器材清单至少需要 2 件（主镜 + 相机）');
  }
  if (body.items.length > 12) {
    throw new ValidationError('器材清单不能超过 12 件');
  }
  return {
    payloadMarginKg: numberField(body, 'payloadMarginKg', TRAIN_LIMITS.payloadMarginKg),
    items: body.items.map((raw, index) => normalizeItem(raw, index))
  };
}

/* ===== 反推搭配：固定主镜与相机，从可选件里凑正好合焦的组合 ===== */

/** 可选件只允许光路中段类型（调焦座/滤镜轮/转接环） */
export const SOLVER_MIDDLE_TYPES = ['focuser', 'filterWheel', 'adapter'];

export const SOLVER_LIMITS = {
  maxCandidates: 10,
  maxSolutions: 50
};

function normalizeCandidate(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(`第 ${index + 1} 件可选件必须是对象`);
  }
  const type = String(raw.type ?? '').trim();
  if (!SOLVER_MIDDLE_TYPES.includes(type)) {
    throw new ValidationError(
      `第 ${index + 1} 件可选件的类型必须是 ${SOLVER_MIDDLE_TYPES.map((t) => ITEM_TYPES[t].label).join('/')}`
    );
  }
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, 30)
      : `${ITEM_TYPES[type].label} ${index + 1}`;
  return {
    type,
    name,
    lengthMm: numberField(raw, 'lengthMm', { ...TRAIN_LIMITS.lengthMm, label: `「${name}」占位长度（mm）` }),
    threadFront: readThread(raw, 'threadFront', { label: `「${name}」前端接口` }),
    threadRear: readThread(raw, 'threadRear', { label: `「${name}」后端接口` })
  };
}

function readEnd(raw, kind, fields) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(`缺少${kind}参数`);
  }
  return fields(raw);
}

/** 反推接口的请求校验：固定两端 + 可选件池 */
export function readTrainSolveInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('请求体必须是 JSON 对象');
  }
  const ota = readEnd(body.ota, '主镜', (raw) => ({
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 30) : '主镜',
    requiredBackfocusMm: numberField(raw, 'requiredBackfocusMm', {
      ...TRAIN_LIMITS.requiredBackfocusMm,
      label: '主镜要求后截距（mm）'
    }),
    threadRear: readThread(raw, 'threadRear', { label: '主镜后端接口' })
  }));
  const camera = readEnd(body.camera, '相机', (raw) => ({
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 30) : '相机',
    lengthMm: numberField(raw, 'lengthMm', { ...TRAIN_LIMITS.lengthMm, label: '相机法兰距（mm）' }),
    threadFront: readThread(raw, 'threadFront', { label: '相机前端接口' })
  }));
  if (!Array.isArray(body.candidates)) {
    throw new ValidationError('可选件清单「candidates」必须是数组');
  }
  if (body.candidates.length > SOLVER_LIMITS.maxCandidates) {
    throw new ValidationError(`可选件不能超过 ${SOLVER_LIMITS.maxCandidates} 件`);
  }
  return { ota, camera, candidates: body.candidates.map((raw, index) => normalizeCandidate(raw, index)) };
}

/**
 * 反推合焦组合：中段长度需落在 要求后截距 − 相机法兰距 ± 调焦行程容差 内，
 * 接口逐节匹配，每件可选件最多用一次。
 * 同一组部件的不同堆叠顺序只保留一个代表（按规格多重集去重）；
 * 无解时返回卡点时所在的最深一段与长度最接近的组合。
 */
export function solveChain({ ota, camera, candidates }) {
  const targetMm = roundTo(ota.requiredBackfocusMm - camera.lengthMm, 2);
  const solutions = [];
  const seenMultisets = new Set();
  const visited = new Set();
  const failures = [];
  let closest = null;

  // 同一规格（类型/长度/接口）的可选件可以互换，按规格签名去重
  const signature = (part) => `${part.type}|${part.lengthMm}|${part.threadFront}|${part.threadRear}`;

  function dfs(mask, lastIndex, lastThread, lastName, middleMm, parts) {
    const visitKey = `${mask}:${lastIndex}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const gapMm = roundTo(targetMm - middleMm, 2);
    const inWindow = Math.abs(gapMm) < FOCUS_TRAVEL_TOLERANCE_MM;
    const cameraFits = threadsMatch(lastThread, camera.threadFront);
    if (cameraFits) {
      if (inWindow) {
        const key = parts.map(signature).sort().join('>');
        if (!seenMultisets.has(key)) {
          seenMultisets.add(key);
          solutions.push({ parts: [...parts], middleLengthMm: middleMm, gapMm });
        }
      } else if (!closest || Math.abs(gapMm) < Math.abs(closest.gapMm)) {
        closest = { gapMm, names: parts.map((p) => p.name) };
      }
    } else if (inWindow) {
      failures.push({
        depth: parts.length,
        code: 'camera-mismatch',
        message: `长度已凑到 ${middleMm} mm，但「${lastName}」的${threadLabel(lastThread)}接不上${camera.name}前端（${threadLabel(camera.threadFront)}）`
      });
    }

    let matched = 0;
    let extended = false;
    for (let i = 0; i < candidates.length; i += 1) {
      if (mask & (1 << i)) continue;
      const candidate = candidates[i];
      if (!threadsMatch(lastThread, candidate.threadFront)) continue;
      matched += 1;
      const nextMm = roundTo(middleMm + candidate.lengthMm, 2);
      if (nextMm >= targetMm + FOCUS_TRAVEL_TOLERANCE_MM - 1e-9) continue; // 再加就超出合焦窗口
      extended = true;
      dfs(mask | (1 << i), i, candidate.threadRear, candidate.name, nextMm, [...parts, candidate]);
    }
    if (extended) return;
    if (matched > 0) {
      failures.push({
        depth: parts.length,
        code: 'length-overflow',
        message: `「${lastName}」之后能接的可选件加上去都会超出后截距`
      });
      return;
    }
    if (parts.length === 0) {
      // 有可选件但第一件就接不上主镜后端
      if (candidates.length > 0 && !(cameraFits && inWindow)) {
        failures.push({
          depth: 0,
          code: 'thread-dead-end',
          message: `没有可选件能接上${ota.name}后端（${threadLabel(ota.threadRear)}），卡在第一段`
        });
      }
    } else if (!cameraFits && !inWindow) {
      // 长度已在窗口内时由 camera-mismatch 说明，不重复报接口死路
      failures.push({
        depth: parts.length,
        code: 'thread-dead-end',
        message: `「${lastName}」的${threadLabel(lastThread)}之后没有能接的可选件`
      });
    }
  }

  dfs(0, -1, ota.threadRear, ota.name, 0, []);

  solutions.sort((a, b) => a.parts.length - b.parts.length || a.middleLengthMm - b.middleLengthMm);
  const solutionCount = solutions.length;

  const blockers = [];
  if (solutionCount === 0) {
    // 只报告最深一段的卡点（最可行动），再附长度最接近的组合
    const maxDepth = failures.reduce((max, f) => Math.max(max, f.depth), 0);
    const seenMessages = new Set();
    for (const failure of failures) {
      if (failure.depth < maxDepth || seenMessages.has(failure.message)) continue;
      seenMessages.add(failure.message);
      blockers.push({ code: failure.code, message: failure.message });
      if (blockers.length >= 3) break;
    }
    if (closest) {
      const who = closest.names.length > 0 ? `「${closest.names.join(' → ')}」` : '相机直连';
      blockers.push({
        code: 'closest-miss',
        message: `长度最接近的是${who}，${closest.gapMm > 0 ? '还差' : '超出'} ${roundTo(Math.abs(closest.gapMm), 2)} mm`
      });
    }
    if (blockers.length === 0) {
      blockers.push({ code: 'no-combination', message: '可选件凑不出正好合焦的组合' });
    }
  }

  return {
    otaName: ota.name,
    otaThreadRear: ota.threadRear,
    cameraName: camera.name,
    cameraThreadFront: camera.threadFront,
    cameraFlangeMm: camera.lengthMm,
    requiredBackfocusMm: ota.requiredBackfocusMm,
    targetMm,
    solutionCount,
    solutions: solutions.slice(0, SOLVER_LIMITS.maxSolutions).map((solution) => {
      let cumulativeMm = 0;
      return {
        partCount: solution.parts.length,
        parts: solution.parts.map((part) => {
          cumulativeMm = roundTo(cumulativeMm + part.lengthMm, 2);
          return {
            name: part.name,
            type: part.type,
            typeLabel: ITEM_TYPES[part.type].label,
            lengthMm: part.lengthMm,
            cumulativeMm,
            threadFront: part.threadFront,
            threadRear: part.threadRear
          };
        }),
        middleLengthMm: solution.middleLengthMm,
        totalLengthMm: roundTo(solution.middleLengthMm + camera.lengthMm, 2),
        gapMm: solution.gapMm
      };
    }),
    blockers,
    ok: solutionCount > 0
  };
}
