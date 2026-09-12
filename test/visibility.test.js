import assert from 'node:assert/strict';
import test from 'node:test';

import {
  astronomicalNightHours,
  midnightAltitudeDeg,
  moonIllumination,
  observableHours,
  solarDeclinationDeg,
  transitAltitudeDeg,
  visibilityPlan
} from '../src/visibility.js';

test('中天高度按纬度与赤纬之差计算', () => {
  assert.equal(transitAltitudeDeg(40, 40), 90);
  assert.equal(transitAltitudeDeg(40, -20), 30);
  assert.equal(transitAltitudeDeg(-33, -33), 90);
});

test('可观测时长区分普通窗口、恒显与不可见', () => {
  const window = observableHours(0, 0, 20);
  assert.equal(window.status, 'window');
  assert.ok(Math.abs(window.hours - 9.34) < 0.01);

  const circumpolar = observableHours(80, 85, 20);
  assert.equal(circumpolar.status, 'circumpolar');
  assert.equal(circumpolar.hours, 24);

  const never = observableHours(40, -60, 20);
  assert.equal(never.status, 'never');
  assert.equal(never.hours, 0);
});

test('太阳赤纬与天文夜近似', () => {
  assert.ok(Math.abs(solarDeclinationDeg(80)) < 1e-6);
  assert.ok(Math.abs(astronomicalNightHours(0, 80) - 9.6) < 0.05);
  assert.equal(astronomicalNightHours(70, 172), 0);
});

test('午夜高度在目标位于太阳反照点赤经时达到中天', () => {
  const altitude = midnightAltitudeDeg({ latitude: 40, declination: 40, targetRaHours: 12, dayOfYear: 80 });
  assert.ok(Math.abs(altitude - 90) < 0.01);

  const offset = midnightAltitudeDeg({ latitude: 40, declination: 40, targetRaHours: 18, dayOfYear: 80 });
  assert.ok(offset < 45 && offset > 20);
});

test('月相照亮比例从新月到满月', () => {
  const newMoon = moonIllumination('2000-01-06T18:14:00Z');
  assert.ok(newMoon.illumination < 0.001);
  assert.equal(newMoon.phase, '新月前后');

  const halfMonth = (29.530588853 / 2) * 86400000;
  const fullMoon = moonIllumination(Date.UTC(2000, 0, 6, 18, 14) + halfMonth);
  assert.ok(fullMoon.illumination > 0.999);
  assert.equal(fullMoon.phase, '满月前后');
});

test('visibilityPlan 汇总可见性结论', () => {
  const report = visibilityPlan({
    latitude: 32,
    declination: 41.27,
    targetRaHours: 0.71,
    minAltitude: 30,
    dayOfYear: 288,
    date: '2026-10-15T16:00:00.000Z'
  });

  assert.ok(report.transitAltitudeDeg > 80);
  assert.ok(report.observableHours > 0);
  assert.ok(report.astronomicalNightHours > 0);
  assert.ok(typeof report.verdict === 'string' && report.verdict.length > 0);
  assert.ok(report.moon.illumination >= 0 && report.moon.illumination <= 1);
});
