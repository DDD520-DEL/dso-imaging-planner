import assert from 'node:assert/strict';
import test from 'node:test';

import { roundTo } from '../src/format.js';
import { scheduleNight, targetWindow } from '../src/schedule.js';
import { astronomicalNightHours } from '../src/visibility.js';

const LAT = 32;
const DOY = 288; // 2026-10-15
const DATE = '2026-10-15T16:00:00.000Z';

function target(overrides) {
  return {
    name: '目标',
    raHours: 1.5,
    decDeg: 40,
    exposureMinutes: 60,
    priority: 5,
    filter: '',
    ...overrides
  };
}

function plan(targets, options = {}) {
  return scheduleNight({
    latitude: LAT,
    dayOfYear: DOY,
    date: DATE,
    targetSwitchMinutes: 10,
    filterSwitchMinutes: 5,
    ...options,
    targets
  });
}

test('正常排布：多目标按优先级排入当夜时间线，切换开销计入且互不重叠', () => {
  const report = plan([
    target({ name: 'M31', raHours: 0.71, decDeg: 41.27, exposureMinutes: 120, priority: 1, filter: 'L' }),
    target({ name: 'M45', raHours: 3.79, decDeg: 24.1, exposureMinutes: 120, priority: 2, filter: 'Ha' }),
    target({ name: 'M42', raHours: 5.59, decDeg: -5.39, exposureMinutes: 90, priority: 3 })
  ]);

  assert.equal(report.unscheduled.length, 0);
  assert.equal(report.entries.length, 6); // 每个目标一条切换 + 一条曝光

  const setups = report.entries.filter((e) => e.kind === 'setup');
  const exposures = report.entries.filter((e) => e.kind === 'exposure');

  // 时间线按开始时间排序，每个目标先切换后曝光
  const starts = report.entries.map((e) => e.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  for (const setup of setups) {
    const exposure = exposures.find((e) => e.targetId === setup.targetId);
    assert.equal(setup.end, exposure.start);
  }

  // M31：天文夜一开始先换目标（10）+ 装滤镜（5），再曝光
  assert.equal(setups[0].targetName, 'M31');
  assert.equal(setups[0].durationMinutes, 15);
  assert.equal(exposures[0].targetName, 'M31');
  assert.equal(exposures[0].start, report.night.start + 15);
  assert.equal(exposures[0].durationMinutes, 120);

  // M45 从 L 换到 Ha：切换 10 + 换滤镜 5
  const m45setup = setups.find((e) => e.targetName === 'M45');
  assert.equal(m45setup.durationMinutes, 15);

  // M42 取下滤镜：同样收一次换滤镜开销
  const m42setup = setups.find((e) => e.targetName === 'M42');
  assert.equal(m42setup.durationMinutes, 15);

  // 所有占用条带互不重叠，且都在天文夜内
  const blocks = report.entries.map((e) => [e.start, e.end]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < blocks.length; i += 1) {
    assert.ok(blocks[i][0] >= blocks[i - 1][1] - 1e-6, '条带之间不能重叠');
  }
  for (const [start, end] of blocks) {
    assert.ok(start >= report.night.start - 1e-6 && end <= report.night.end + 1e-6);
  }

  // 利用率统计自洽
  const u = report.utilization;
  assert.equal(u.exposureMinutes, 330);
  assert.equal(u.setupMinutes, 45);
  assert.ok(Math.abs(u.exposureMinutes + u.setupMinutes + u.idleMinutes - u.nightMinutes) < 0.01);
  assert.ok(u.exposureRatio <= u.occupiedRatio && u.occupiedRatio <= 1);
  assert.equal(u.scheduledMinutes, 330);
});

test('优先级高（数字小）的目标先占夜里最早的空档', () => {
  // dec 80 在纬度 32 的窗口覆盖整个天文夜，两个目标争同一段空档
  const report = plan([
    target({ name: '后排', decDeg: 80, exposureMinutes: 60, priority: 3 }),
    target({ name: '优先', decDeg: 80, exposureMinutes: 60, priority: 1 })
  ]);

  const exposures = report.entries.filter((e) => e.kind === 'exposure');
  assert.equal(exposures[0].targetName, '优先');
  assert.equal(exposures[0].start, report.night.start + 10); // 首个目标只收换目标开销
  assert.equal(exposures[1].targetName, '后排');
});

test('同滤镜的相邻目标只收换目标开销，不重复收换滤镜开销', () => {
  const report = plan(
    [
      target({ name: 'A', decDeg: 80, exposureMinutes: 60, priority: 1, filter: 'L' }),
      target({ name: 'B', decDeg: 80, exposureMinutes: 60, priority: 2, filter: 'L' })
    ],
    { filterSwitchMinutes: 5 }
  );
  const setups = report.entries.filter((e) => e.kind === 'setup');
  assert.equal(setups[0].durationMinutes, 15); // 首晚装入 L
  assert.equal(setups[1].durationMinutes, 10); // 同滤镜，只换目标
});

test('窗口不足：可用窗口短于所需曝光时先告警，目标进入未排入清单而不被静默丢弃', () => {
  // dec -25、minAltitude 30 时可观测窗口只有约 2.6 小时，且在午夜中天
  const antiSolarLikeRa = 1.53;
  const report = plan(
    [target({ name: '低目标', raHours: antiSolarLikeRa, decDeg: -25, exposureMinutes: 300, priority: 1 })],
    { minAltitude: 30 }
  );

  assert.ok(report.warnings.some((w) => w.code === 'window-too-short'));
  assert.equal(report.unscheduled.length, 1);
  assert.equal(report.unscheduled[0].name, '低目标');
  assert.equal(report.unscheduled[0].reasonCode, 'window-too-short');
  assert.ok(report.unscheduled[0].windowMinutes < 300);
  assert.equal(report.entries.length, 0);
  assert.equal(report.utilization.exposureMinutes, 0);
});

test('完全排不下：高纬盛夏没有天文夜，所有目标都列入未排入并给出严重告警', () => {
  assert.equal(astronomicalNightHours(70, 172), 0);

  const report = scheduleNight({
    latitude: 70,
    dayOfYear: 172,
    date: '2026-06-21T12:00:00.000Z',
    targets: [
      target({ name: '目标甲', decDeg: 40, exposureMinutes: 120, priority: 1 }),
      target({ name: '目标乙', decDeg: 10, exposureMinutes: 90, priority: 2 })
    ]
  });

  assert.equal(report.night.hours, 0);
  assert.ok(report.warnings.some((w) => w.code === 'no-astronomical-night' && w.level === 'serious'));
  assert.equal(report.unscheduled.length, 2);
  assert.deepEqual(report.unscheduled.map((t) => t.reasonCode), [
    'no-astronomical-night',
    'no-astronomical-night'
  ]);
  assert.equal(report.entries.length, 0);
  assert.equal(report.utilization.exposureRatio, 0);
  assert.equal(report.utilization.occupiedRatio, 0);
});

test('整夜不升起到最低高度角的目标标记为 no-window', () => {
  const report = plan([
    target({ name: '永不升起', decDeg: -70, exposureMinutes: 60, priority: 1 }),
    target({ name: '正常', decDeg: 40, exposureMinutes: 60, priority: 2 })
  ]);

  const failed = report.unscheduled.find((t) => t.name === '永不升起');
  assert.ok(failed);
  assert.equal(failed.reasonCode, 'no-window');
  assert.ok(report.warnings.some((w) => w.code === 'no-window'));
  assert.equal(report.unscheduled.length, 1);
  assert.equal(report.entries.filter((e) => e.kind === 'exposure').length, 1);
});

test('总需求超过夜长：低优先级目标被挤出，并在告警与未排入清单中明确列出', () => {
  const targets = Array.from({ length: 4 }, (_, i) =>
    target({ name: `目标${i + 1}`, decDeg: 80, exposureMinutes: 150, priority: i + 1 })
  );
  const report = plan(targets);

  // 夜 599.4 分钟，无滤镜每个目标占 160 分钟（10 切换 + 150 曝光），排下 3 个后第 4 个放不下
  assert.ok(report.utilization.nightMinutes < 4 * 160);
  assert.equal(report.unscheduled.length, 1);
  assert.equal(report.unscheduled[0].name, '目标4');
  assert.equal(report.unscheduled[0].reasonCode, 'no-capacity');
  assert.ok(report.warnings.some((w) => w.code === 'unscheduled' && /目标4/.test(w.message)));
  assert.equal(report.entries.filter((e) => e.kind === 'exposure').length, 3);
});

test('月亮亮于阈值时每个目标都提示月亮影响；参数非法的目标被跳过并告警', () => {
  const bright = plan([target({ name: '正常', decDeg: 40, exposureMinutes: 60 })], { moonThreshold: 0 });
  assert.ok(bright.warnings.some((w) => w.code === 'moon-bright'));
  assert.ok(bright.moon.illumination >= 0 && bright.moon.illumination <= 1);

  const invalid = plan([
    target({ name: '坏坐标', raHours: 28, decDeg: 40, exposureMinutes: 60 }),
    target({ name: '正常', decDeg: 40, exposureMinutes: 60, priority: 2 })
  ]);
  assert.ok(invalid.warnings.some((w) => w.code === 'invalid-target'));
  assert.deepEqual(invalid.unscheduled.map((t) => t.name), ['坏坐标']);
});

test('高优先级的傍晚目标加入时，已排好的低优先级目标会让位重排，而不是把高优先级丢弃', () => {
  // M31 是长窗口目标、NGC7000 是更早落没的傍晚目标；按输入顺序 M31 先被接纳
  const report = plan([
    { name: 'M31', raHours: 0.71, decDeg: 41.27, exposureMinutes: 240, priority: 1, filter: 'L' },
    { name: 'NGC7000', raHours: 20.99, decDeg: 44.3, exposureMinutes: 150, priority: 2, filter: 'Ha' },
    { name: 'M45', raHours: 3.79, decDeg: 24.1, exposureMinutes: 90, priority: 3, filter: 'L' }
  ]);

  assert.deepEqual(report.unscheduled, []);
  const exposures = report.entries
    .filter((e) => e.kind === 'exposure')
    .sort((a, b) => a.start - b.start);
  assert.deepEqual(
    exposures.map((e) => e.targetName),
    ['NGC7000', 'M31', 'M45']
  );

  // 高优先级目标全部排满所需时长，且曝光段都落在自己当夜的可观测窗口内
  const wanted = { M31: 240, NGC7000: 150, M45: 90 };
  for (const [name, minutes] of Object.entries(wanted)) {
    const exp = exposures.find((e) => e.targetName === name);
    assert.equal(exp.end - exp.start, minutes);
    const win = targetWindow({
      latitude: LAT,
      declination: { M31: 41.27, NGC7000: 44.3, M45: 24.1 }[name],
      targetRaHours: { M31: 0.71, NGC7000: 20.99, M45: 3.79 }[name],
      minAltitude: 30,
      dayOfYear: DOY
    });
    assert.ok(exp.start >= Math.max(win.start, report.night.start) - 1e-6);
    assert.ok(exp.end <= Math.min(win.end, report.night.end) + 1e-6);
  }
});

test('确实排不下时报告让位后的真实最长空档与占用目标，而不是整段窗口长度', () => {
  // NGC7000 窗口约 5.61 小时但要 5 小时；优先保证 4 小时的 M31 后，傍晚窗口被占掉大半
  const report = plan([
    { name: 'M31', raHours: 0.71, decDeg: 41.27, exposureMinutes: 240, priority: 1, filter: 'L' },
    { name: 'NGC7000', raHours: 20.99, decDeg: 44.3, exposureMinutes: 300, priority: 2, filter: 'Ha' }
  ]);

  assert.equal(report.unscheduled.length, 1);
  const failed = report.unscheduled[0];
  assert.equal(failed.name, 'NGC7000');
  assert.equal(failed.reasonCode, 'no-capacity');
  // 整段窗口够长（5.61h > 5h），但让位后的最长连续空档确实放不下——两个数必须不同且后者更小
  assert.ok(failed.windowMinutes > failed.exposureMinutes);
  assert.ok(failed.largestGapMinutes < failed.exposureMinutes);
  assert.ok(failed.largestGapMinutes < failed.windowMinutes - 60);
  assert.deepEqual(failed.blockingTargets, ['M31']);

  const message = report.warnings.find((w) => w.code === 'unscheduled').message;
  assert.match(message, /M31/);
  assert.match(message, new RegExp(`${roundTo(failed.largestGapMinutes / 60, 2)} 小时`.replace('.', '\\.')));
  // 高优先级的 M31 不受影响，完整排满
  assert.equal(
    report.entries.filter((e) => e.kind === 'exposure' && e.targetName === 'M31')[0].durationMinutes,
    240
  );
});

test('优先级不变量：不会出现低优先级目标排上、更高优先级目标反被挤出（仅几何可行的目标）', () => {
  const targets = Array.from({ length: 6 }, (_, i) => ({
    name: `目标${i + 1}`,
    raHours: 0.71 + i * 0.4,
    decDeg: 30 + i * 8,
    exposureMinutes: 150,
    priority: i + 1
  }));
  const report = plan(targets);

  const capacityFailures = report.unscheduled.filter((u) => u.reasonCode === 'no-capacity');
  assert.ok(capacityFailures.length >= 1, '该用例应至少挤掉一个几何可行的目标');

  const scheduledJobs = report.entries.filter((e) => e.kind === 'exposure').map((e) => {
    const source = targets.find((t) => t.name === e.targetName);
    return { name: e.targetName, priority: source.priority };
  });

  for (const failed of capacityFailures) {
    for (const scheduled of scheduledJobs) {
      assert.ok(
        scheduled.priority < failed.priority,
        `「${scheduled.name}」(p${scheduled.priority}) 排上了，却挤掉了更高优先级的「${failed.name}」(p${failed.priority})`
      );
    }
  }
});

test('targetWindow 返回相对午夜的中天偏移并对恒显目标给出无限窗口', () => {
  const normal = targetWindow({ latitude: 32, declination: 40, targetRaHours: 1.5, minAltitude: 30, dayOfYear: DOY });
  assert.ok(Number.isFinite(normal.start) && Number.isFinite(normal.end));
  assert.ok(normal.end - normal.start > 0);

  const circumpolar = targetWindow({ latitude: 32, declination: 80, targetRaHours: 1.5, minAltitude: 20, dayOfYear: DOY });
  assert.equal(circumpolar.observableStatus, 'circumpolar');
  assert.equal(circumpolar.start, -Infinity);
  assert.equal(circumpolar.end, Infinity);
});

test('入参缺失时抛错', () => {
  assert.throws(() => scheduleNight({ latitude: 32, dayOfYear: DOY, targets: [] }), /至少需要一个拍摄目标/);
  assert.throws(() => scheduleNight({ dayOfYear: DOY, targets: [target()] }), /纬度/);
});
