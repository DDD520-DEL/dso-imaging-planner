import { roundTo } from './format.js';
import {
  astronomicalNightHours,
  midnightAltitudeDeg,
  moonIllumination,
  observableHours,
  solarRaHours,
  transitAltitudeDeg
} from './visibility.js';

const DEG = Math.PI / 180;

export const SCHEDULE_LIMITS = {
  latitude: { min: -89.5, max: 89.5, label: '观测地纬度（°）' },
  minAltitude: { min: 5, max: 80, label: '最低可用高度角（°）' },
  targetRaHours: { min: 0, max: 24, label: '目标赤经（h）' },
  declination: { min: -89.5, max: 89.5, label: '目标赤纬（°）' },
  exposureMinutes: { min: 1, max: 1200, label: '总曝光时长（分钟）' },
  priority: { min: 1, max: 9, label: '优先级' },
  changeOverMinutes: { min: 0, max: 120, label: '切换开销（分钟）' }
};

export const SCHEDULE_DEFAULTS = {
  minAltitude: 30,
  targetSwitchMinutes: 10,
  filterSwitchMinutes: 5,
  moonThreshold: 0.7,
  priority: 5
};

/**
 * 单个目标在指定夜里的几何可观测条带（相对当地午夜的分钟区间，可跨午夜）。
 * nightStart/nightEnd 同样是相对午夜分钟（负→正），用于把条带裁到天文夜内。
 */
export function targetWindow({ latitude, declination, targetRaHours, minAltitude, dayOfYear }) {
  const window = observableHours(latitude, declination, minAltitude);
  const antiSolarRa = solarRaHours(dayOfYear) + 12; // 午夜中天的赤经（未取模，保证两侧连续）

  // 目标相对「午夜中天赤经」的最短有符号差，范围 (-12, 12]
  let delta = targetRaHours - antiSolarRa;
  delta = ((delta + 12) % 24 + 24) % 24 - 12;
  const transitOffset = delta * 60; // 中天相对当地午夜的分钟偏移

  let rawStart;
  let rawEnd;
  if (window.status === 'never') {
    rawStart = 0;
    rawEnd = 0;
  } else if (window.status === 'circumpolar') {
    rawStart = -Infinity;
    rawEnd = Infinity;
  } else {
    const half = (window.hours / 2) * 60;
    rawStart = transitOffset - half;
    rawEnd = transitOffset + half;
  }

  return {
    start: rawStart,
    end: rawEnd,
    transitOffset: roundTo(transitOffset, 2),
    transitAltitudeDeg: transitAltitudeDeg(latitude, declination),
    midnightAltitudeDeg: midnightAltitudeDeg({ latitude, declination, targetRaHours, dayOfYear }),
    observableStatus: window.status,
    observableHours: window.hours
  };
}

function intersectIntervals(a, b) {
  return { start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) };
}

function intervalLength(interval) {
  return Math.max(0, interval.end - interval.start);
}

function jobWindow(job, night) {
  return { start: Math.max(job.window.start, night.start), end: Math.min(job.window.end, night.end) };
}

/**
 * 在 job 的窗口内沿 busy 扫描最靠前、容得下「切换 + 曝光」的空档。
 * 换滤镜是否计费取决于时间上紧接其前的那段（可能来自其他目标）。
 * 返回 null 表示无解。
 */
function earliestGap(job, night, busy, targetSwitch, filterSwitch) {
  const w = jobWindow(job, night);
  let cursor = w.start;
  let predecessor = null; // 时间上紧邻当前空档之前的已排段

  const tryGap = (gapStart, gapEnd) => {
    const prevFilter = predecessor ? predecessor.filter : '';
    const setup = targetSwitch + (job.filter !== prevFilter ? filterSwitch : 0);
    if (gapEnd - gapStart + 1e-9 >= setup + job.exposureMinutes) {
      return {
        setupStart: gapStart,
        setupMinutes: setup,
        exposureStart: gapStart + setup,
        end: gapStart + setup + job.exposureMinutes,
        prevFilter
      };
    }
    return null;
  };

  for (const block of busy) {
    if (block.end <= cursor + 1e-9) {
      predecessor = block; // 完全落在游标之前：可能是窗口外的紧前段
      continue;
    }
    if (block.start >= w.end) break;

    const hit = tryGap(cursor, Math.min(block.start, w.end));
    if (hit) return hit;

    cursor = Math.max(cursor, block.end);
    predecessor = block;
    if (cursor >= w.end) break;
  }

  return tryGap(cursor, w.end);
}

/** 窗口内各段连续空档（分钟），用于在排不下时报告真实剩余空档 */
function freeGaps(job, night, busy) {
  const w = jobWindow(job, night);
  const gaps = [];
  let cursor = w.start;
  for (const block of busy) {
    if (block.end <= cursor) continue;
    if (block.start >= w.end) break;
    if (block.start > cursor) gaps.push({ start: cursor, end: Math.min(block.start, w.end) });
    cursor = Math.max(cursor, block.end);
    if (cursor >= w.end) break;
  }
  if (cursor < w.end) gaps.push({ start: cursor, end: w.end });
  return gaps;
}

/**
 * 对一组已接纳目标做可行排布：按窗口结束时刻升序（最早落没的目标先占傍晚天空，
 * 这是单机带释放/截止时间排布的经典 EDD 次序），次序相同时再按优先级与输入顺序。
 * 任一目标无处可放则整体无解，返回 null。
 */
function greedyInOrder(ordered, night, targetSwitch, filterSwitch) {
  const busy = [];
  for (const job of ordered) {
    const slot = earliestGap(job, night, busy, targetSwitch, filterSwitch);
    if (!slot) return null;
    busy.push({
      jobId: job.id,
      start: slot.setupStart,
      end: slot.end,
      filter: job.filter,
      setupMinutes: slot.setupMinutes,
      exposureStart: slot.exposureStart,
      prevFilter: slot.prevFilter
    });
    busy.sort((a, b) => a.start - b.start);
  }
  return busy;
}

function eddOrder(jobs, night) {
  return [...jobs].sort((a, b) => {
    const wa = jobWindow(a, night);
    const wb = jobWindow(b, night);
    return wb.end - wa.end ? wa.end - wb.end : wa.start - wb.start || a.priority - b.priority || a.index - b.index;
  });
}

/**
 * EDD 贪心在极少数窗口组合下会误判无解，用受限回溯兜底：交换导致失败的目标与
 * 更早落没目标的先后次序。目标数上限 12，节点预算内找第一个可行排布即可。
 */
function backtrackPlace(ordered, night, targetSwitch, filterSwitch, nodeBudget = 20000) {
  let nodes = 0;

  function search(remaining, busy) {
    if (remaining.length === 0) return busy;
    nodes += 1;
    if (nodes > nodeBudget) return null;

    // 候选按窗口结束时刻升序尝试；等价（同结束/开始时刻）的目标只按既有顺序，减少对称分支
    const candidates = eddOrder(remaining, night);
    for (let i = 0; i < candidates.length; i += 1) {
      const job = candidates[i];
      const slot = earliestGap(job, night, busy, targetSwitch, filterSwitch);
      if (!slot) continue;
      const nextBusy = [
        ...busy,
        {
          jobId: job.id,
          start: slot.setupStart,
          end: slot.end,
          filter: job.filter,
          setupMinutes: slot.setupMinutes,
          exposureStart: slot.exposureStart,
          prevFilter: slot.prevFilter
        }
      ].sort((a, b) => a.start - b.start);
      const found = search(candidates.filter((item) => item.id !== job.id), nextBusy);
      if (found) return found;
    }
    return null;
  }

  return search(ordered, []);
}

function placeJobs(jobs, night, targetSwitch, filterSwitch) {
  const ordered = eddOrder(jobs, night);
  return greedyInOrder(ordered, night, targetSwitch, filterSwitch) ?? backtrackPlace(ordered, night, targetSwitch, filterSwitch);
}

/**
 * 排今夜拍摄时间线。
 *
 * input:
 *   latitude, dayOfYear, date
 *   minAltitude?, targetSwitchMinutes?, filterSwitchMinutes?, moonThreshold?
 *   targets: [{ name, raHours, decDeg, exposureMinutes, priority, filter? }]
 *
 * 排布规则：按优先级（小者优先，同序按输入顺序）贪心；每个目标只在其可观测
 * 条带与天文夜的交集内、且不与已排条带冲突的最靠前空档曝光；进入目标、切换
 * 滤镜都计入开销。排不下的目标进入 unscheduled，并写明原因，绝不静默丢弃。
 */
export function scheduleNight(input) {
  const latitude = Number(input?.latitude);
  if (!Number.isFinite(latitude) || latitude < SCHEDULE_LIMITS.latitude.min || latitude > SCHEDULE_LIMITS.latitude.max) {
    throw new RangeError('观测地纬度缺失或越界');
  }
  const dayOfYear = Math.round(Number(input?.dayOfYear));
  if (!Number.isFinite(dayOfYear) || dayOfYear < 1 || dayOfYear > 366) {
    throw new RangeError('一年中的第几天缺失或越界（1–366）');
  }
  const rawTargets = Array.isArray(input?.targets) ? input.targets : [];
  if (rawTargets.length === 0) {
    throw new RangeError('至少需要一个拍摄目标');
  }

  const minAltitude = numberOrDefault(input.minAltitude, SCHEDULE_DEFAULTS.minAltitude);
  const targetSwitch = numberOrDefault(input.targetSwitchMinutes, SCHEDULE_DEFAULTS.targetSwitchMinutes);
  const filterSwitch = numberOrDefault(input.filterSwitchMinutes, SCHEDULE_DEFAULTS.filterSwitchMinutes);
  const moonThreshold = numberOrDefault(input.moonThreshold, SCHEDULE_DEFAULTS.moonThreshold);

  const nightHours = astronomicalNightHours(latitude, dayOfYear);
  const nightHalf = (nightHours / 2) * 60;
  const night = { start: -nightHalf, end: nightHalf }; // 相对当地午夜

  const moon = moonIllumination(
    typeof input.date === 'string' && input.date.trim() ? input.date : new Date().toISOString()
  );

  const warnings = [];
  if (nightHours === 0) {
    warnings.push({ level: 'serious', code: 'no-astronomical-night', message: '当夜太阳始终高于 -18°，没有天文夜，无法安排拍摄。' });
  }

  const prepared = rawTargets.map((raw, index) => {
    const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : `目标 ${index + 1}`;
    const raHours = Number(raw?.raHours);
    const decDeg = Number(raw?.decDeg);
    const exposureMinutes = Number(raw?.exposureMinutes);
    const priority = Number.isFinite(Number(raw?.priority)) ? Number(raw.priority) : 5;
    const filter = typeof raw?.filter === 'string' ? raw.filter.trim() : '';

    const problems = [];
    if (!Number.isFinite(raHours) || raHours < 0 || raHours > 24) problems.push('赤经需在 0–24h');
    if (!Number.isFinite(decDeg) || decDeg < -89.5 || decDeg > 89.5) problems.push('赤纬需在 -89.5–89.5°');
    if (!Number.isFinite(exposureMinutes) || exposureMinutes <= 0) problems.push('总曝光时长需为正数');
    if (!Number.isInteger(priority) || priority < 1 || priority > 9) problems.push('优先级需为 1–9 的整数');

    const target = {
      id: `t${index}`,
      index,
      name,
      raHours: Number.isFinite(raHours) ? raHours : null,
      decDeg: Number.isFinite(decDeg) ? decDeg : null,
      exposureMinutes: Number.isFinite(exposureMinutes) ? exposureMinutes : 0,
      priority,
      filter
    };

    if (problems.length > 0) {
      return { ...target, window: null, clipped: null, warnings: [{ level: 'serious', code: 'invalid-target', message: `「${name}」参数无效：${problems.join('、')}，跳过。` }] };
    }

    const geometry = targetWindow({ latitude, declination: decDeg, targetRaHours: raHours, minAltitude, dayOfYear });
    const clipped = intersectIntervals(geometry, night);
    const targetWarnings = [];

    if (geometry.observableStatus === 'never' || intervalLength(clipped) <= 0) {
      targetWarnings.push({
        level: 'serious',
        code: 'no-window',
        message:
          nightHours === 0
            ? `「${name}」当夜没有天文夜（太阳始终高于 -18°），没有可拍摄时段。`
            : `「${name}」整夜不升到 ${minAltitude}° 以上，当夜完全不可观测。`
      });
    } else if (exposureMinutes > intervalLength(clipped) + 1e-9) {
      targetWarnings.push({
        level: 'warn',
        code: 'window-too-short',
        message: `「${name}」当夜可用窗口仅 ${roundTo(intervalLength(clipped) / 60, 2)} 小时，短于所需曝光 ${roundTo(exposureMinutes / 60, 2)} 小时。`
      });
    }

    if (moon.illumination >= moonThreshold) {
      targetWarnings.push({
        level: 'warn',
        code: 'moon-bright',
        message: `「${name}」当夜月亮照亮比例 ${roundTo(moon.illumination * 100, 0)}%（${moon.phase}），宽带拍摄背景会偏亮，建议窄带或避开月亮方向。`
      });
    }

    return { ...target, window: geometry, clipped, warnings: targetWarnings };
  });

  // 目标级告警先汇总提示（即便最终排不进时间线也要让用户看到）
  for (const item of prepared) warnings.push(...item.warnings);

  // 几何可排（窗口为正）的候选，按优先级（小者优先，同序按输入顺序）逐个接纳
  const candidates = prepared
    .filter((item) => item.window && intervalLength(item.clipped) > 0)
    .sort((a, b) => a.priority - b.priority || a.index - b.index);

  const accepted = [];
  let placement = [];
  const failures = [];

  for (const item of candidates) {
    // 每接纳一个目标都对「已接纳集合 + 新目标」整体重排：高优先级目标不会被
    // 自己早先的贪心位置锁死，低优先级目标会自动让位到更晚的空档。
    const trial = placeJobs([...accepted, item], night, targetSwitch, filterSwitch);
    if (trial) {
      accepted.push(item);
      placement = trial;
    } else {
      failures.push({ item, blockers: placement });
    }
  }

  const jobById = new Map(prepared.map((item) => [item.id, item]));
  const acceptedIds = new Set(accepted.map((item) => item.id));
  const entries = [];

  for (const block of placement) {
    const job = jobById.get(block.jobId);
    if (block.setupMinutes > 0) {
      const changedFilter = job.filter !== block.prevFilter;
      entries.push({
        kind: 'setup',
        targetId: job.id,
        targetName: job.name,
        filter: job.filter,
        start: roundTo(block.start, 2),
        end: roundTo(block.start + block.setupMinutes, 2),
        durationMinutes: block.setupMinutes,
        label: !changedFilter
          ? `切换到「${job.name}」`
          : job.filter
            ? `切换到「${job.name}」并换 ${job.filter} 滤镜`
            : `切换到「${job.name}」并取下滤镜`
      });
    }
    entries.push({
      kind: 'exposure',
      targetId: job.id,
      targetName: job.name,
      filter: job.filter,
      start: roundTo(block.exposureStart, 2),
      end: roundTo(block.end, 2),
      durationMinutes: job.exposureMinutes
    });
  }

  // 接纳失败时的真实诊断：被已排（高优先级）目标占用后，窗口内最长的连续空档
  for (const { item, blockers } of failures) {
    const windowMinutes = intervalLength(item.clipped);
    const gaps = freeGaps(item, night, blockers);
    const largestGap = gaps.reduce((max, gap) => Math.max(max, intervalLength(gap)), 0);
    const blockingNames = [...new Set(
      blockers
        .filter((block) => block.end > jobWindow(item, night).start && block.start < jobWindow(item, night).end)
        .map((block) => jobById.get(block.jobId)?.name)
        .filter(Boolean)
    )];

    let reasonCode;
    let detail;
    if (windowMinutes + 1e-9 < item.exposureMinutes) {
      reasonCode = 'window-too-short';
      detail = `可观测窗口仅 ${roundTo(windowMinutes / 60, 2)} 小时，短于所需 ${roundTo(
        item.exposureMinutes / 60,
        2
      )} 小时曝光`;
    } else {
      reasonCode = 'no-capacity';
      const clash = blockingNames.length
        ? `窗口内的时段已优先分配给 ${blockingNames.map((name) => `「${name}」`).join('、')}，让位后最长连续空档只剩`
        : '窗口内最长连续空档只剩';
      detail = `${clash} ${roundTo(largestGap / 60, 2)} 小时，放不下 ${roundTo(
        item.exposureMinutes / 60,
        2
      )} 小时曝光与至少 ${targetSwitch} 分钟切换`;
    }
    item.failure = { reasonCode, largestGapMinutes: roundTo(largestGap, 2), blockingTargets: blockingNames };
    warnings.push({
      level: 'warn',
      code: 'unscheduled',
      message: `「${item.name}」未能排入时间线：${detail}。`
    });
  }

  const unscheduled = prepared
    .filter((item) => !acceptedIds.has(item.id))
    .map((item) => {
      const windowMinutes = item.clipped ? intervalLength(item.clipped) : 0;
      let reasonCode = 'no-capacity';
      if (item.window === null) reasonCode = 'invalid-target';
      else if (nightHours === 0) reasonCode = 'no-astronomical-night';
      else if (item.window.observableStatus === 'never' || windowMinutes <= 0) reasonCode = 'no-window';
      else if (windowMinutes + 1e-9 < item.exposureMinutes) reasonCode = 'window-too-short';
      return {
        targetId: item.id,
        name: item.name,
        priority: item.priority,
        exposureMinutes: item.exposureMinutes,
        filter: item.filter,
        windowMinutes: roundTo(windowMinutes, 2),
        largestGapMinutes: item.failure?.largestGapMinutes ?? null,
        blockingTargets: item.failure?.blockingTargets ?? [],
        reasonCode
      };
    });

  entries.sort((a, b) => a.start - b.start);

  // 利用率：曝光时间占天文夜的比例（切换开销是必要损耗，单独统计）
  const nightMinutes = Math.max(0, nightHours * 60);
  const exposureMinutes = entries.filter((e) => e.kind === 'exposure').reduce((sum, e) => sum + e.durationMinutes, 0);
  const setupMinutes = entries.filter((e) => e.kind === 'setup').reduce((sum, e) => sum + e.durationMinutes, 0);
  const scheduledExposureWanted = prepared
    .filter((item) => acceptedIds.has(item.id))
    .reduce((sum, item) => sum + item.exposureMinutes, 0);

  const lastEnd = entries.reduce((max, e) => Math.max(max, e.end), night.start);
  const firstStart = entries.reduce((min, e) => Math.min(min, e.start), night.end);
  const timeline = {
    start: roundTo(entries.length ? firstStart : night.start, 2),
    end: roundTo(entries.length ? lastEnd : night.start, 2)
  };

  const utilization = {
    nightMinutes: roundTo(nightMinutes, 2),
    exposureMinutes: roundTo(exposureMinutes, 2),
    setupMinutes: roundTo(setupMinutes, 2),
    idleMinutes: roundTo(Math.max(0, nightMinutes - exposureMinutes - setupMinutes), 2),
    exposureRatio: nightMinutes > 0 ? roundTo(exposureMinutes / nightMinutes, 4) : 0,
    occupiedRatio: nightMinutes > 0 ? roundTo((exposureMinutes + setupMinutes) / nightMinutes, 4) : 0,
    requestedMinutes: roundTo(prepared.reduce((sum, item) => sum + item.exposureMinutes, 0), 2),
    scheduledMinutes: roundTo(scheduledExposureWanted, 2)
  };

  return {
    night: { start: roundTo(night.start, 2), end: roundTo(night.end, 2), hours: nightHours },
    moon,
    timeline,
    entries,
    unscheduled,
    warnings,
    utilization
  };
}

function numberOrDefault(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
