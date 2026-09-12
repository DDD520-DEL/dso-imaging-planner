import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAppServer } from '../server.mjs';

function postJson(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function withServer(run) {
  const dir = await mkdtemp(join(tmpdir(), 'dso-planner-'));
  const dataFile = join(dir, 'targets.json');
  const server = createAppServer({ dataFile });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base, dataFile);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test('健康检查与首页静态资源可访问', async () => {
  await withServer(async (base) => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const healthPayload = await health.json();
    assert.equal(healthPayload.status, 'ok');
    assert.equal(healthPayload.service, 'dso-imaging-planner');

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /深空天文摄影规划工作台/);

    const stylesheet = await fetch(`${base}/styles/main.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type'), /text\/css/);
  });
});

test('光学接口返回采样判定，越界参数返回 400', async () => {
  await withServer(async (base) => {
    const valid = await postJson(base, '/api/optics/report', {
      focalLengthMm: 400,
      apertureMm: 80,
      pixelSizeUm: 3.76,
      sensorWidthPx: 6000,
      sensorHeightPx: 4000,
      seeingArcsec: 2
    });
    assert.equal(valid.status, 200);
    const report = await valid.json();
    assert.equal(report.sampling.level, '欠采样');
    assert.equal(report.pixelScaleArcsec, 1.939);

    const invalid = await postJson(base, '/api/optics/report', {
      focalLengthMm: 10,
      apertureMm: 80,
      pixelSizeUm: 3.76,
      sensorWidthPx: 6000,
      sensorHeightPx: 4000,
      seeingArcsec: 2
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /焦距/);

    const missing = await postJson(base, '/api/optics/report', { focalLengthMm: 400 });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /缺少参数/);
  });
});

test('目标库支持新增、查重与删除自定义目标', async () => {
  await withServer(async (base) => {
    const initial = await (await fetch(`${base}/api/targets`)).json();
    assert.ok(initial.builtin.length >= 8);
    assert.equal(initial.custom.length, 0);

    const created = await postJson(base, '/api/targets', {
      name: 'NGC 2237 玫瑰星云',
      raHours: 6.53,
      decDeg: 4.95,
      magnitude: 9,
      sizeArcmin: 80,
      category: '发射星云'
    });
    assert.equal(created.status, 201);
    const { target } = await created.json();
    assert.ok(target.id.startsWith('custom-'));
    assert.equal(target.source, 'custom');

    const afterCreate = await (await fetch(`${base}/api/targets`)).json();
    assert.equal(afterCreate.custom.length, 1);

    const duplicate = await postJson(base, '/api/targets', { name: 'NGC 2237 玫瑰星云', raHours: 6.53, decDeg: 4.95 });
    assert.equal(duplicate.status, 400);
    assert.match((await duplicate.json()).error, /已经有/);

    const builtinName = await postJson(base, '/api/targets', { name: 'M31 仙女座星系', raHours: 0.71, decDeg: 41.27 });
    assert.equal(builtinName.status, 400);
    assert.match((await builtinName.json()).error, /内置目标库/);

    const removed = await fetch(`${base}/api/targets/${target.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    const afterDelete = await (await fetch(`${base}/api/targets`)).json();
    assert.equal(afterDelete.custom.length, 0);

    const missing = await fetch(`${base}/api/targets/not-exist`, { method: 'DELETE' });
    assert.equal(missing.status, 404);
  });
});

test('曝光、可见性与跟踪接口返回计算结果', async () => {
  await withServer(async (base) => {
    const exposure = await postJson(base, '/api/exposure/estimate', {
      apertureMm: 80,
      pixelScaleArcsec: 1.94,
      skyBrightness: 21.3,
      readNoise: 1.5,
      subExposureSeconds: 300,
      frames: 60,
      targetSnr: 30
    });
    assert.equal(exposure.status, 200);
    const exposureReport = await exposure.json();
    assert.ok(exposureReport.stackedSnr > 0);
    assert.equal(exposureReport.warnings.length, 0);

    const visibility = await postJson(base, '/api/visibility/plan', {
      latitude: 32,
      declination: 41.27,
      targetRaHours: 0.71,
      minAltitude: 30,
      dayOfYear: 288,
      date: '2026-10-15T16:00:00.000Z'
    });
    assert.equal(visibility.status, 200);
    const visibilityReport = await visibility.json();
    assert.ok(visibilityReport.observableHours > 0);

    const tracking = await postJson(base, '/api/tracking/check', {
      seeingArcsec: 2,
      trackingRmsArcsec: 0.6,
      pixelScaleArcsec: 1.94,
      subExposureSeconds: 300
    });
    assert.equal(tracking.status, 200);
    const trackingReport = await tracking.json();
    assert.equal(trackingReport.trackingLevel, '优秀');
  });
});

test('排程接口返回时间线与未排入清单，目标参数非法返回 400', async () => {
  await withServer(async (base) => {
    const ok = await postJson(base, '/api/schedule/plan', {
      latitude: 32,
      dayOfYear: 288,
      date: '2026-10-15T16:00:00.000Z',
      targets: [
        { name: 'M31', raHours: 0.71, decDeg: 41.27, exposureMinutes: 120, priority: 1, filter: 'L' },
        { name: 'M42', raHours: 5.59, decDeg: -5.39, exposureMinutes: 90, priority: 2 }
      ]
    });
    assert.equal(ok.status, 200);
    const report = await ok.json();
    assert.ok(Array.isArray(report.entries));
    assert.ok(report.entries.length >= 2);
    assert.deepEqual(report.unscheduled, []);
    assert.ok(report.utilization.nightMinutes > 0);
    assert.ok(report.utilization.exposureRatio > 0 && report.utilization.exposureRatio <= 1);
    assert.equal(report.night.hours, 9.99);

    // 没有天文夜的高纬夏夜：全部目标进未排入清单，不静默丢弃
    const noNight = await postJson(base, '/api/schedule/plan', {
      latitude: 70,
      dayOfYear: 172,
      date: '2026-06-21T12:00:00.000Z',
      targets: [{ name: '目标甲', raHours: 12, decDeg: 40, exposureMinutes: 120, priority: 1 }]
    });
    assert.equal(noNight.status, 200);
    const noNightReport = await noNight.json();
    assert.equal(noNightReport.unscheduled.length, 1);
    assert.equal(noNightReport.unscheduled[0].reasonCode, 'no-astronomical-night');

    const invalid = await postJson(base, '/api/schedule/plan', {
      latitude: 32,
      targets: [{ name: '坏目标', raHours: 99, decDeg: 0, exposureMinutes: 60 }]
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /赤经/);

    const empty = await postJson(base, '/api/schedule/plan', { latitude: 32, targets: [] });
    assert.equal(empty.status, 400);
  });
});

test('器材链路接口：合焦差额与转接环建议，结构非法返回 400', async () => {
  await withServer(async (base) => {
    const items = [
      { type: 'ota', name: '主镜', focalLengthMm: 400, requiredBackfocusMm: 80, threadRear: 'M48F', weightG: 2600 },
      { type: 'focuser', name: '调焦座', lengthMm: 35, threadFront: 'M48M', threadRear: 'M48F', weightG: 800 },
      { type: 'filterWheel', name: '滤镜轮', lengthMm: 20, threadFront: 'M48M', threadRear: 'M48F', weightG: 500 },
      { type: 'camera', name: '相机', lengthMm: 17.5, pixelSizeUm: 3.76, threadFront: 'M48M', weightG: 650 },
      { type: 'guider', name: '导星套装', guideFocalLengthMm: 120, guidePixelSizeUm: 3.75, weightG: 400 }
    ];

    const ok = await postJson(base, '/api/train/check', { payloadMarginKg: 6, items });
    assert.equal(ok.status, 200);
    const report = await ok.json();
    assert.equal(report.focus.status, 'need-spacer');
    assert.equal(report.gapMm, 7.5);
    assert.deepEqual(report.focus.spacers, [
      { thicknessMm: 5, count: 1 },
      { thicknessMm: 2, count: 1 },
      { thicknessMm: 0.5, count: 1 }
    ]);
    assert.equal(report.ok, true);
    assert.equal(report.weight.totalG, 4950);
    assert.equal(report.guide.ratio, 3.32);
    assert.equal(report.chain.length, 4);

    // 超重与接口不匹配作为结果返回（200），不是请求错误
    const problematic = await postJson(base, '/api/train/check', {
      payloadMarginKg: 3,
      items: items.map((item, index) => (index === 2 ? { ...item, threadRear: 'M48M' } : item))
    });
    assert.equal(problematic.status, 200);
    const problemReport = await problematic.json();
    assert.equal(problemReport.ok, false);
    assert.deepEqual(
      problemReport.problems.map((p) => p.code).sort(),
      ['overweight', 'thread-mismatch']
    );

    // 结构性问题（缺相机）与字段越界返回 400
    const noCamera = await postJson(base, '/api/train/check', { payloadMarginKg: 6, items: items.slice(0, 3) });
    assert.equal(noCamera.status, 400);
    assert.match((await noCamera.json()).error, /相机/);

    const badField = await postJson(base, '/api/train/check', {
      payloadMarginKg: 6,
      items: items.map((item, index) => (index === 0 ? { ...item, focalLengthMm: 10 } : item))
    });
    assert.equal(badField.status, 400);
    assert.match((await badField.json()).error, /焦距/);
  });
});

test('反推搭配接口：返回可行组合与卡点说明，参数非法返回 400', async () => {
  await withServer(async (base) => {
    const m48part = (type, name, lengthMm) => ({ type, name, lengthMm, threadFront: 'M48M', threadRear: 'M48F' });
    const ends = {
      ota: { requiredBackfocusMm: 80, threadRear: 'M48F' },
      camera: { lengthMm: 17.5, threadFront: 'M48M' }
    };

    const ok = await postJson(base, '/api/train/solve', {
      ...ends,
      candidates: [
        m48part('focuser', '调焦座', 35),
        m48part('filterWheel', '滤镜轮', 20),
        m48part('adapter', '7.5mm 环', 7.5),
        m48part('adapter', '5mm 环', 5),
        m48part('adapter', '2.5mm 环', 2.5)
      ]
    });
    assert.equal(ok.status, 200);
    const report = await ok.json();
    assert.equal(report.ok, true);
    assert.equal(report.solutionCount, 2);
    assert.equal(report.solutions[0].partCount, 3);
    assert.equal(report.solutions[0].totalLengthMm, 80);

    // 凑不出时返回 200 + blockers，不是请求错误
    const blocked = await postJson(base, '/api/train/solve', {
      ...ends,
      candidates: [{ type: 'adapter', name: 'M42 环', lengthMm: 5, threadFront: 'M42M', threadRear: 'M42F' }]
    });
    assert.equal(blocked.status, 200);
    const blockedReport = await blocked.json();
    assert.equal(blockedReport.ok, false);
    assert.equal(blockedReport.blockers[0].code, 'thread-dead-end');

    const missingOta = await postJson(base, '/api/train/solve', { camera: ends.camera, candidates: [] });
    assert.equal(missingOta.status, 400);
    assert.match((await missingOta.json()).error, /主镜/);
  });
});

test('反推搭配接口：载重余量参与评估，超重方案排最后并支持全部超重', async () => {
  await withServer(async (base) => {
    const weighted = {
      ota: { requiredBackfocusMm: 80, threadRear: 'M48F', weightG: 2600 },
      camera: { lengthMm: 17.5, threadFront: 'M48M', weightG: 650 },
      guiderWeightG: 400,
      candidates: [
        { type: 'focuser', name: '调焦座', lengthMm: 35, threadFront: 'M48M', threadRear: 'M48F', weightG: 800 },
        { type: 'filterWheel', name: '滤镜轮', lengthMm: 20, threadFront: 'M48M', threadRear: 'M48F', weightG: 500 },
        { type: 'adapter', name: '7.5mm 环', lengthMm: 7.5, threadFront: 'M48M', threadRear: 'M48F', weightG: 600 },
        { type: 'adapter', name: '5mm 环', lengthMm: 5, threadFront: 'M48M', threadRear: 'M48F', weightG: 40 },
        { type: 'adapter', name: '2.5mm 环', lengthMm: 2.5, threadFront: 'M48M', threadRear: 'M48F', weightG: 30 }
      ]
    };

    const partial = await postJson(base, '/api/train/solve', { ...weighted, payloadMarginKg: 5.2 });
    assert.equal(partial.status, 200);
    const partialReport = await partial.json();
    assert.equal(partialReport.solutionCount, 2);
    assert.equal(partialReport.solutions[0].overweight, false);
    assert.equal(partialReport.solutions[0].weightG, 5020);
    assert.equal(partialReport.solutions[1].overweight, true);
    assert.equal(partialReport.solutions[1].weightG, 5550);
    assert.equal(partialReport.allOverweight, false);

    const allOver = await postJson(base, '/api/train/solve', { ...weighted, payloadMarginKg: 4 });
    assert.equal(allOver.status, 200);
    const allOverReport = await allOver.json();
    assert.equal(allOverReport.allOverweight, true);
    assert.ok(allOverReport.solutions.every((s) => s.overweight));
  });
});

test('错误处理：坏 JSON 返回 400，未知接口返回 404', async () => {
  await withServer(async (base) => {
    const brokenJson = await fetch(`${base}/api/tracking/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{不是合法 JSON'
    });
    assert.equal(brokenJson.status, 400);
    assert.match((await brokenJson.json()).error, /JSON/);

    const unknownApi = await fetch(`${base}/api/unknown`);
    assert.equal(unknownApi.status, 404);

    const missingFile = await fetch(`${base}/not-exist.txt`);
    assert.equal(missingFile.status, 404);
  });
});

test('静态服务拒绝路径越界', async () => {
  await withServer(async (base) => {
    const escape = await fetch(`${base}/%2e%2e%2fpackage.json`);
    assert.equal(escape.status, 403);
    const escapeDeep = await fetch(`${base}/styles/%2e%2e%2f%2e%2e%2fpackage.json`);
    assert.equal(escapeDeep.status, 403);
  });
});
