import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dawesLimitArcsec,
  diffractionLimitArcsec,
  fieldOfViewDeg,
  focalRatio,
  opticsReport,
  pixelScaleArcsec,
  samplingVerdict,
  sensorSizeMm
} from '../src/optics.js';

test('像素尺度按 206265 × 像元尺寸 ÷ 焦距 计算', () => {
  assert.equal(pixelScaleArcsec(400, 3.76).toFixed(3), '1.939');
  assert.equal(pixelScaleArcsec(200, 3.76).toFixed(3), '3.878');
});

test('传感器画幅与视场角', () => {
  const sensor = sensorSizeMm(3.76, 6000, 4000);
  assert.equal(sensor.widthMm.toFixed(2), '22.56');
  assert.equal(sensor.heightMm.toFixed(2), '15.04');

  const fov = fieldOfViewDeg(400, sensor.widthMm, sensor.heightMm);
  assert.equal(fov.widthDeg.toFixed(2), '3.23');
  assert.equal(fov.heightDeg.toFixed(2), '2.15');
  assert.ok(fov.diagonalDeg > fov.widthDeg);
});

test('焦比、道斯极限与衍射极限', () => {
  assert.equal(focalRatio(400, 80), 5);
  assert.equal(dawesLimitArcsec(80).toFixed(2), '1.45');
  assert.equal(diffractionLimitArcsec(80, 550).toFixed(2), '1.73');
  assert.ok(diffractionLimitArcsec(80, 500) < diffractionLimitArcsec(80, 700));
});

test('采样判定按视宁度的 1/3 到 1/2 区间分级', () => {
  assert.equal(samplingVerdict(0.6, 3).level, '过采样');
  assert.equal(samplingVerdict(1, 3).level, '接近理想');
  assert.equal(samplingVerdict(1.5, 3).level, '接近理想');
  assert.equal(samplingVerdict(2.2, 3).level, '欠采样');
});

test('opticsReport 汇总全部字段', () => {
  const report = opticsReport({
    focalLengthMm: 400,
    apertureMm: 80,
    pixelSizeUm: 3.76,
    sensorWidthPx: 6000,
    sensorHeightPx: 4000,
    seeingArcsec: 2
  });

  assert.equal(report.pixelScaleArcsec, 1.939);
  assert.equal(report.focalRatio, 5);
  assert.equal(report.sampling.level, '欠采样');
  assert.equal(report.diffractionLimitArcsec, 1.73);
  assert.equal(report.effectiveResolutionArcsec, 2);
});
