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
