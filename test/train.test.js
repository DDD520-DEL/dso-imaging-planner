import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chainReport,
  normalizeItem,
  readTrainInput,
  readTrainSolveInput,
  solveChain,
  suggestSpacers,
  threadsMatch
} from '../src/train.js';
import { ValidationError } from '../src/validate.js';

/** 一套能正好合焦的基准链路：35 + 20 + 17.5 = 72.5 mm */
function baseItems() {
  return [
    { type: 'ota', name: '主镜', focalLengthMm: 400, requiredBackfocusMm: 72.5, threadRear: 'M48F', weightG: 2600 },
    { type: 'focuser', name: '调焦座', lengthMm: 35, threadFront: 'M48M', threadRear: 'M48F', weightG: 800 },
    { type: 'filterWheel', name: '滤镜轮', lengthMm: 20, threadFront: 'M48M', threadRear: 'M48F', weightG: 500 },
    { type: 'camera', name: '相机', lengthMm: 17.5, pixelSizeUm: 3.76, threadFront: 'M48M', weightG: 650 }
  ];
}

function reportFor(items, payloadMarginKg = 5) {
  return chainReport(readTrainInput({ payloadMarginKg, items }));
}

test('接口匹配：螺纹同规格内外互补，卡口同规格互配，NONE 不可对接', () => {
  assert.equal(threadsMatch('M48M', 'M48F'), true);
  assert.equal(threadsMatch('M48F', 'M48M'), true);
  assert.equal(threadsMatch('M48M', 'M48M'), false);
  assert.equal(threadsMatch('M48F', 'M48F'), false);
  assert.equal(threadsMatch('M48M', 'M42F'), false);
  assert.equal(threadsMatch('B2', 'B2'), true);
  assert.equal(threadsMatch('B2', 'B125'), false);
  assert.equal(threadsMatch('B2', 'M48F'), false);
  assert.equal(threadsMatch('NONE', 'M48F'), false);
});

test('转接环组合：0.5 的倍数精确拼出，非倍数向下取并报告余量', () => {
  assert.deepEqual(suggestSpacers(7.5), {
    spacers: [
      { thicknessMm: 5, count: 1 },
      { thicknessMm: 2, count: 1 },
      { thicknessMm: 0.5, count: 1 }
    ],
    spacerTotalMm: 7.5,
    residualMm: 0
  });

  const withResidual = suggestSpacers(7.3);
  assert.deepEqual(withResidual.spacers, [
    { thicknessMm: 5, count: 1 },
    { thicknessMm: 2, count: 1 }
  ]);
  assert.equal(withResidual.spacerTotalMm, 7);
  assert.equal(withResidual.residualMm, 0.3);

  // 缺口不足 0.5 mm 时不建议加环，余量交调焦行程
  const tiny = suggestSpacers(0.3);
  assert.deepEqual(tiny.spacers, []);
  assert.equal(tiny.residualMm, 0.3);

  // 大缺口复用同一规格
  const big = suggestSpacers(45);
  assert.deepEqual(big.spacers, [
    { thicknessMm: 20, count: 2 },
    { thicknessMm: 5, count: 1 }
  ]);
});

test('正好合焦：链路总长等于要求后截距，无问题', () => {
  const report = reportFor(baseItems());
  assert.equal(report.focus.status, 'exact');
  assert.equal(report.totalLengthMm, 72.5);
  assert.equal(report.gapMm, 0);
  assert.equal(report.ok, true);
  assert.deepEqual(report.problems, []);
  assert.equal(report.weight.totalG, 4550);
  assert.equal(report.weight.ok, true);

  // 累加表逐节累计，接口全部对接成功
  assert.deepEqual(
    report.chain.map((row) => row.cumulativeMm),
    [0, 35, 55, 72.5]
  );
  assert.equal(report.chain[0].joint, null);
  assert.ok(report.chain.slice(1).every((row) => row.joint.ok));
});

test('差一点合焦：给出转接环组合与调焦余量', () => {
  const items = baseItems();
  items[0].requiredBackfocusMm = 80;
  const report = reportFor(items);

  assert.equal(report.focus.status, 'need-spacer');
  assert.equal(report.gapMm, 7.5);
  assert.deepEqual(report.focus.spacers, [
    { thicknessMm: 5, count: 1 },
    { thicknessMm: 2, count: 1 },
    { thicknessMm: 0.5, count: 1 }
  ]);
  assert.equal(report.focus.spacerTotalMm, 7.5);
  assert.equal(report.focus.residualMm, 0);
  assert.equal(report.ok, true);
});

test('调焦行程吸收边界：不足 0.5 mm 的缺口或超出都判正好合焦', () => {
  // 缺口 0.3 mm：不建议加环（组合必须为空且状态不是 need-spacer），调焦行程吸收
  const short = baseItems();
  short[0].requiredBackfocusMm = 72.8; // 链路 72.5，差 0.3
  const shortReport = reportFor(short);
  assert.equal(shortReport.gapMm, 0.3);
  assert.equal(shortReport.focus.status, 'exact');
  assert.deepEqual(shortReport.focus.spacers, []);
  assert.equal(shortReport.focus.spacerTotalMm, 0);
  assert.equal(shortReport.ok, true);
  assert.deepEqual(shortReport.problems, []);

  // 超出 0.05 mm：同一口径，调焦行程吸收，不判超长
  const over = baseItems();
  over[0].requiredBackfocusMm = 72.45; // 链路 72.5，超 0.05
  const overReport = reportFor(over);
  assert.equal(overReport.gapMm, -0.05);
  assert.equal(overReport.focus.status, 'exact');
  assert.equal(overReport.ok, true);
  assert.deepEqual(overReport.problems, []);
});

test('调焦行程边界之外：0.5 mm 起才建议加环或判超长', () => {
  const atHalf = baseItems();
  atHalf[0].requiredBackfocusMm = 73; // 差 0.5，最小可加环缺口
  const halfReport = reportFor(atHalf);
  assert.equal(halfReport.focus.status, 'need-spacer');
  assert.deepEqual(halfReport.focus.spacers, [{ thicknessMm: 0.5, count: 1 }]);
  assert.equal(halfReport.focus.spacerTotalMm, 0.5);
  assert.equal(halfReport.focus.residualMm, 0);

  const overHalf = baseItems();
  overHalf[0].requiredBackfocusMm = 72; // 超 0.5，判超长
  const overHalfReport = reportFor(overHalf);
  assert.equal(overHalfReport.gapMm, -0.5);
  assert.equal(overHalfReport.focus.status, 'over-length');
  assert.equal(overHalfReport.ok, false);
  assert.ok(overHalfReport.problems.some((p) => p.code === 'over-length'));
});

test('链路超长：超出后截距时明确报告，加环无法解决', () => {
  const items = baseItems();
  items[0].requiredBackfocusMm = 60;
  const report = reportFor(items);

  assert.equal(report.focus.status, 'over-length');
  assert.equal(report.gapMm, -12.5);
  assert.equal(report.ok, false);
  const problem = report.problems.find((p) => p.code === 'over-length');
  assert.match(problem.message, /超出要求后截距 12\.5 mm/);
});

test('接口不匹配：指出哪一节接不上', () => {
  const items = baseItems();
  items[2].threadRear = 'M48M'; // 滤镜轮后端变外螺纹，与相机前端 M48 外螺纹顶死
  const report = reportFor(items);

  assert.equal(report.ok, false);
  const problem = report.problems.find((p) => p.code === 'thread-mismatch');
  assert.match(problem.message, /滤镜轮/);
  assert.match(problem.message, /相机/);
  assert.equal(report.chain[3].joint.ok, false);
  assert.equal(report.chain[3].joint.detail, 'M48 外 ↔ M48 外');
});

test('超重：整套重量超过载重余量时报告超出量', () => {
  const items = [
    ...baseItems(),
    { type: 'guider', name: '导星套装', guideFocalLengthMm: 120, guidePixelSizeUm: 3.75, weightG: 400 }
  ];
  const report = reportFor(items, 3);

  assert.equal(report.weight.totalG, 4950);
  assert.equal(report.weight.ok, false);
  assert.equal(report.weight.excessG, 1950);
  assert.equal(report.ok, false);
  const problem = report.problems.find((p) => p.code === 'overweight');
  assert.match(problem.message, /超出赤道仪载重余量 1\.95 kg/);
});

test('导星采样比：按主镜与导星的像素尺度之比分级', () => {
  const items = [
    ...baseItems(),
    { type: 'guider', name: '导星套装', guideFocalLengthMm: 120, guidePixelSizeUm: 3.75, weightG: 400 }
  ];
  const report = reportFor(items);

  assert.equal(report.guide.mainScaleArcsec, 1.939);
  assert.equal(report.guide.guideScaleArcsec, 6.446);
  assert.equal(report.guide.ratio, 3.32);
  assert.equal(report.guide.level, '可用');

  // 没有导星设备时不算采样比
  assert.equal(reportFor(baseItems()).guide, null);
});

test('结构校验：缺相机、主镜不在最前、多件主镜都会报错', () => {
  assert.throws(() => reportFor(baseItems().slice(0, 3)), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.match(error.message, /只能有一台相机/);
    return true;
  });

  const swapped = baseItems();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.throws(() => reportFor(swapped), /主镜必须排在光路最前/);

  const twoOtas = [...baseItems(), { ...baseItems()[0], name: '第二主镜' }];
  assert.throws(() => reportFor(twoOtas), /只能有一件主镜/);

  assert.throws(() => readTrainInput({ payloadMarginKg: 5, items: [baseItems()[0]] }), /至少需要 2 件/);
});

test('字段校验：缺重量、接口规格非法、长度越界都会报 400 语义', () => {
  assert.throws(() => normalizeItem({ type: 'camera', lengthMm: 17.5, pixelSizeUm: 3.76, threadFront: 'M48M' }), /重量/);
  assert.throws(
    () => normalizeItem({ type: 'adapter', lengthMm: 5, threadFront: 'M77X', threadRear: 'M48F', weightG: 50 }),
    /不是受支持的接口规格/
  );
  assert.throws(
    () => normalizeItem({ type: 'adapter', lengthMm: 999, threadFront: 'M48M', threadRear: 'M48F', weightG: 50 }),
    /不能大于 500/
  );
  // 链路中段不允许 NONE 接口
  assert.throws(
    () => normalizeItem({ type: 'adapter', lengthMm: 5, threadFront: 'NONE', threadRear: 'M48F', weightG: 50 }),
    /不是受支持的接口规格|缺少参数/
  );
});

/* ===== 反推搭配 ===== */

const SOLVE_OTA = { requiredBackfocusMm: 80, threadRear: 'M48F' };
const SOLVE_CAMERA = { lengthMm: 17.5, threadFront: 'M48M' }; // 中段目标 62.5 mm

function m48part(type, name, lengthMm) {
  return { type, name, lengthMm, threadFront: 'M48M', threadRear: 'M48F' };
}

function solveFor({ ota = {}, camera = {}, candidates }) {
  return solveChain(readTrainSolveInput({ ota: { ...SOLVE_OTA, ...ota }, camera: { ...SOLVE_CAMERA, ...camera }, candidates }));
}

test('反推能凑出：多解按件数从少到多、总长从短到长排列', () => {
  const report = solveFor({
    candidates: [
      m48part('focuser', '调焦座', 35),
      m48part('filterWheel', '滤镜轮', 20),
      m48part('adapter', '7.5mm 环', 7.5),
      m48part('adapter', '5mm 环', 5),
      m48part('adapter', '2.5mm 环', 2.5)
    ]
  });

  assert.equal(report.ok, true);
  assert.equal(report.targetMm, 62.5);
  // 62.5 = 35+20+7.5（3 件）= 35+20+5+2.5（4 件），同一组部件的不同顺序只算一套
  assert.equal(report.solutionCount, 2);
  assert.equal(report.solutions[0].partCount, 3);
  assert.equal(report.solutions[1].partCount, 4);
  for (const solution of report.solutions) {
    assert.equal(solution.totalLengthMm, 80);
    assert.equal(solution.gapMm, 0);
  }
  // 累加表逐节累计
  assert.deepEqual(
    report.solutions[0].parts.map((p) => p.cumulativeMm),
    [35, 55, 62.5]
  );
  assert.deepEqual(report.blockers, []);
});

test('反推只有唯一解', () => {
  const report = solveFor({
    candidates: [m48part('focuser', '调焦座', 35), m48part('filterWheel', '滤镜轮', 20), m48part('adapter', '7.5mm 环', 7.5)]
  });

  assert.equal(report.ok, true);
  assert.equal(report.solutionCount, 1);
  const solution = report.solutions[0];
  assert.equal(solution.partCount, 3);
  assert.deepEqual(
    solution.parts.map((p) => p.name),
    ['调焦座', '滤镜轮', '7.5mm 环']
  );
});

test('反推支持相机直连：法兰距正好等于要求后截距时给出 0 件方案', () => {
  const report = solveFor({ ota: { requiredBackfocusMm: 17.5 }, candidates: [] });
  assert.equal(report.ok, true);
  assert.equal(report.solutionCount, 1);
  assert.equal(report.solutions[0].partCount, 0);
  assert.equal(report.solutions[0].totalLengthMm, 17.5);
});

test('反推凑不出（接口死路）：说明卡在第一段', () => {
  const report = solveFor({
    candidates: [
      { type: 'focuser', name: '调焦座', lengthMm: 35, threadFront: 'M42M', threadRear: 'M42F' },
      { type: 'adapter', name: '5mm 环', lengthMm: 5, threadFront: 'M42M', threadRear: 'M42F' }
    ]
  });

  assert.equal(report.ok, false);
  assert.equal(report.solutionCount, 0);
  assert.equal(report.blockers[0].code, 'thread-dead-end');
  assert.match(report.blockers[0].message, /卡在第一段/);
  assert.match(report.blockers[0].message, /M48 内/);
});

test('反推凑不出（相机接不上）：长度凑到但接口不通', () => {
  const report = solveFor({
    camera: { threadFront: 'M54M' },
    candidates: [m48part('focuser', '调焦座', 35), m48part('filterWheel', '滤镜轮', 20), m48part('adapter', '7.5mm 环', 7.5)]
  });

  assert.equal(report.ok, false);
  const blocker = report.blockers.find((b) => b.code === 'camera-mismatch');
  assert.ok(blocker);
  assert.match(blocker.message, /62\.5 mm/);
  assert.match(blocker.message, /接不上相机前端（M54 外）/);
});

test('反推凑不出（长度凑不到）：报告最接近的组合', () => {
  const report = solveFor({
    candidates: [m48part('focuser', '40mm 调焦座', 40), m48part('adapter', '30mm 环', 30)]
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((b) => b.code === 'length-overflow'));
  const closest = report.blockers.find((b) => b.code === 'closest-miss');
  assert.ok(closest);
  assert.match(closest.message, /40mm 调焦座/);
  assert.match(closest.message, /还差 22\.5 mm/);
});

test('反推参数校验：缺主镜、可选件类型非法、数量超限都会报错', () => {
  assert.throws(() => readTrainSolveInput({ camera: SOLVE_CAMERA, candidates: [] }), /主镜/);
  assert.throws(
    () => readTrainSolveInput({ ota: SOLVE_OTA, camera: SOLVE_CAMERA, candidates: [{ type: 'camera', lengthMm: 5 }] }),
    /类型必须是/
  );
  assert.throws(
    () =>
      readTrainSolveInput({
        ota: SOLVE_OTA,
        camera: SOLVE_CAMERA,
        candidates: Array.from({ length: 11 }, (_, i) => m48part('adapter', `环${i}`, 5))
      }),
    /不能超过 10 件/
  );
  assert.throws(() => readTrainSolveInput({ ota: SOLVE_OTA, camera: SOLVE_CAMERA }), /candidates.*数组/);
});
