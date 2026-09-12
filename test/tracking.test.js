import assert from 'node:assert/strict';
import test from 'node:test';

import {
  combinedFwhmArcsec,
  maxPolarErrorArcmin,
  polarAlignmentDriftArcsecPerHour,
  trackingReport,
  trackingVerdict
} from '../src/tracking.js';

test('星点 FWHM 合成视宁度与跟踪误差', () => {
  assert.equal(combinedFwhmArcsec({ seeingArcsec: 2, trackingRmsArcsec: 0.5 }).toFixed(2), '2.32');
  assert.equal(combinedFwhmArcsec({ seeingArcsec: 2, trackingRmsArcsec: 0 }).toFixed(2), '2.00');
});

test('跟踪等级按跟踪 RMS 与像素尺度之比分级', () => {
  assert.equal(trackingVerdict({ trackingRmsArcsec: 0.5, pixelScaleArcsec: 1.94 }).level, '优秀');
  assert.equal(trackingVerdict({ trackingRmsArcsec: 1.5, pixelScaleArcsec: 1.94 }).level, '可接受');
  assert.equal(trackingVerdict({ trackingRmsArcsec: 3, pixelScaleArcsec: 1.94 }).level, '轻微拖尾');
  assert.equal(trackingVerdict({ trackingRmsArcsec: 5, pixelScaleArcsec: 1.94 }).level, '明显拖尾');
});

test('极轴偏差漂移率与允许误差反解', () => {
  assert.ok(Math.abs(polarAlignmentDriftArcsecPerHour(1) - 15.71) < 0.01);
  assert.ok(Math.abs(polarAlignmentDriftArcsecPerHour(10) - 157.06) < 0.5);

  const limit = maxPolarErrorArcmin({ pixelScaleArcsec: 1.94, subExposureSeconds: 300, tolerancePixels: 1 });
  assert.equal(limit.unlimited, false);
  assert.ok(limit.maxErrorArcmin > 1 && limit.maxErrorArcmin < 2);

  const looseLimit = maxPolarErrorArcmin({ pixelScaleArcsec: 8, subExposureSeconds: 1, tolerancePixels: 5 });
  assert.equal(looseLimit.unlimited, true);
});

test('trackingReport 给出像素化星点尺寸与提示', () => {
  const report = trackingReport({
    seeingArcsec: 2,
    trackingRmsArcsec: 3,
    pixelScaleArcsec: 1.94,
    subExposureSeconds: 300
  });

  assert.ok(report.fwhmPixels > 3);
  assert.equal(report.trackingLevel, '轻微拖尾');
  assert.ok(report.notes.length >= 2);
  assert.ok(report.maxPolarErrorArcmin > 0);
});
