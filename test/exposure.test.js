import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exposureEstimate,
  requiredTotalExposure,
  saturationSeconds,
  skyFluxPerPixel,
  skyLimitedSubExposure,
  stackSnr
} from '../src/exposure.js';

const BASE_FLUX_INPUT = {
  apertureMm: 80,
  pixelScaleArcsec: 1.5,
  skyBrightness: 21.5,
  throughput: 0.8,
  quantumEfficiency: 0.6
};

test('像素天光通量随口径平方与像素天区面积增长', () => {
  const base = skyFluxPerPixel(BASE_FLUX_INPUT);
  assert.equal(base.toFixed(3), '5.429');

  const largerAperture = skyFluxPerPixel({ ...BASE_FLUX_INPUT, apertureMm: 160 });
  assert.ok(Math.abs(largerAperture / base - 4) < 1e-9);

  const coarserScale = skyFluxPerPixel({ ...BASE_FLUX_INPUT, pixelScaleArcsec: 3 });
  assert.ok(Math.abs(coarserScale / base - 4) < 1e-9);
});

test('天空亮度每暗 2.5 等，通量降到十分之一', () => {
  const bright = skyFluxPerPixel({ ...BASE_FLUX_INPUT, skyBrightness: 21.5 });
  const dark = skyFluxPerPixel({ ...BASE_FLUX_INPUT, skyBrightness: 24 });
  assert.ok(Math.abs(dark / bright - 0.1) < 1e-9);
});

test('读出噪声主导时叠加 4 帧信噪比翻倍', () => {
  const params = { fluxRate: 0.2, darkCurrent: 0, readNoise: 5 };
  const single = stackSnr({ ...params, seconds: 1, frames: 1 }).snr;
  const fourFrames = stackSnr({ ...params, seconds: 1, frames: 4 }).snr;
  assert.ok(Math.abs(fourFrames / single - 2) < 0.02);
});

test('天空背景主导曝光与饱和时间', () => {
  assert.equal(skyLimitedSubExposure({ fluxRate: 2, readNoise: 1.5 }), 11.25);
  assert.equal(saturationSeconds({ fluxRate: 8, darkCurrent: 2, fullWell: 50000 }), 5000);
});

test('requiredTotalExposure 随目标信噪比单调变化，并能识别不可达', () => {
  const params = { fluxRate: 8, darkCurrent: 0.01, readNoise: 1.5, frames: 60 };
  const reachable = requiredTotalExposure({ ...params, targetSnr: 30 });
  assert.equal(reachable.feasible, true);
  assert.ok(reachable.subExposureSeconds > 0 && reachable.subExposureSeconds < 60);

  const harder = requiredTotalExposure({ ...params, targetSnr: 40 });
  assert.ok(harder.totalExposureSeconds > reachable.totalExposureSeconds);

  const impossible = requiredTotalExposure({ ...params, frames: 1, targetSnr: 5000 });
  assert.equal(impossible.feasible, false);
  assert.equal(impossible.totalExposureSeconds, null);
});

test('exposureEstimate 汇总结果并给出告警列表', () => {
  const report = exposureEstimate({
    apertureMm: 80,
    pixelScaleArcsec: 1.94,
    skyBrightness: 21.3,
    throughput: 0.8,
    quantumEfficiency: 0.6,
    readNoise: 1.5,
    darkCurrent: 0.005,
    fullWell: 50000,
    subExposureSeconds: 300,
    frames: 60,
    targetSnr: 30
  });

  assert.ok(report.fluxRateEPerSecond > 0);
  assert.ok(report.stackedSnr > report.perFrameSnr);
  assert.ok(report.saturationSeconds > 300);
  assert.ok(report.skyLimitedSubExposureSeconds < 5);
  assert.deepEqual(report.warnings, []);

  const overSaturated = exposureEstimate({
    apertureMm: 200,
    pixelScaleArcsec: 1.94,
    skyBrightness: 21.3,
    throughput: 0.8,
    quantumEfficiency: 0.6,
    readNoise: 1.5,
    darkCurrent: 0.005,
    fullWell: 50000,
    subExposureSeconds: 1500,
    frames: 60,
    targetSnr: 30
  });
  assert.ok(overSaturated.warnings.some((item) => item.code === 'sub-exposure-over-saturation'));
});
