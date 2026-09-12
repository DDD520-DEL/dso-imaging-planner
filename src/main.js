import {
  createTarget,
  fetchHealth,
  fetchTargets,
  postExposure,
  postOptics,
  postTracking,
  postVisibility,
  removeTarget
} from './api.js';
import { setLastReport, setTargets } from './state.js';
import { renderExposurePanel } from './components/exposure-panel.js';
import { renderOpticsPanel } from './components/optics-panel.js';
import { renderTargetList } from './components/target-library.js';
import { renderTrackingPanel } from './components/tracking-panel.js';
import { renderVisibilityPanel } from './components/visibility-panel.js';

const DEFAULTS = {
  focalLength: 400,
  aperture: 80,
  pixelSize: 3.76,
  sensorWidth: 6000,
  sensorHeight: 4000,
  seeing: 2,
  expAperture: 80,
  expPixelScale: 1.94,
  skyBrightness: 21.3,
  throughput: 0.8,
  quantumEfficiency: 0.6,
  readNoise: 1.5,
  darkCurrent: 0.005,
  fullWell: 50000,
  subExposure: 300,
  frames: 60,
  targetSnr: 30,
  latitude: 32,
  targetRa: 0.71,
  targetDec: 41.27,
  minAltitude: 30,
  observeDate: '2026-10-15',
  trkSeeing: 2,
  trackingRms: 0.6,
  trkPixelScale: 1.94,
  trkSubExposure: 300
};

const FIELDS = {
  focalLength: 'focal-length',
  aperture: 'aperture',
  pixelSize: 'pixel-size',
  sensorWidth: 'sensor-width',
  sensorHeight: 'sensor-height',
  seeing: 'seeing',
  expAperture: 'exp-aperture',
  expPixelScale: 'exp-pixel-scale',
  skyBrightness: 'sky-brightness',
  throughput: 'throughput',
  quantumEfficiency: 'quantum-efficiency',
  readNoise: 'read-noise',
  darkCurrent: 'dark-current',
  fullWell: 'full-well',
  subExposure: 'sub-exposure',
  frames: 'frames',
  targetSnr: 'target-snr',
  latitude: 'latitude',
  targetRa: 'target-ra',
  targetDec: 'target-dec',
  minAltitude: 'min-altitude',
  observeDate: 'observe-date',
  trkSeeing: 'trk-seeing',
  trackingRms: 'tracking-rms',
  trkPixelScale: 'trk-pixel-scale',
  trkSubExposure: 'trk-sub-exposure',
  targetName: 'target-name-input',
  targetRaInput: 'target-ra-input',
  targetDecInput: 'target-dec-input',
  targetMagInput: 'target-mag-input',
  targetSizeInput: 'target-size-input',
  targetCategoryInput: 'target-category-input'
};

const elements = {};

function cacheElements() {
  for (const [key, id] of Object.entries(FIELDS)) {
    elements[key] = document.getElementById(id);
  }
  elements.apiStatus = document.getElementById('api-status');
  elements.message = document.getElementById('result-message');
  elements.planButton = document.getElementById('plan-button');
  elements.resetButton = document.getElementById('reset-button');
  elements.targetList = document.getElementById('target-list');
  elements.targetAddButton = document.getElementById('target-add-button');
  elements.targetMessage = document.getElementById('target-message');
  elements.panels = {
    optics: document.getElementById('optics-panel'),
    exposure: document.getElementById('exposure-panel'),
    visibility: document.getElementById('visibility-panel'),
    tracking: document.getElementById('tracking-panel')
  };
}

function numberValue(key) {
  return Number(elements[key].value);
}

function textValue(key) {
  return elements[key].value.trim();
}

function optionalTextValue(key) {
  const value = textValue(key);
  return value === '' ? undefined : value;
}

function applyDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    elements[key].value = value;
  }
}

function collectOptics() {
  return {
    focalLengthMm: numberValue('focalLength'),
    apertureMm: numberValue('aperture'),
    pixelSizeUm: numberValue('pixelSize'),
    sensorWidthPx: numberValue('sensorWidth'),
    sensorHeightPx: numberValue('sensorHeight'),
    seeingArcsec: numberValue('seeing')
  };
}

function collectExposure() {
  return {
    apertureMm: numberValue('expAperture'),
    pixelScaleArcsec: numberValue('expPixelScale'),
    skyBrightness: numberValue('skyBrightness'),
    throughput: numberValue('throughput'),
    quantumEfficiency: numberValue('quantumEfficiency'),
    readNoise: numberValue('readNoise'),
    darkCurrent: numberValue('darkCurrent'),
    fullWell: numberValue('fullWell'),
    subExposureSeconds: numberValue('subExposure'),
    frames: numberValue('frames'),
    targetSnr: numberValue('targetSnr')
  };
}

function dayOfYearFromDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - startOfYear) / 86400000) + 1;
}

function collectVisibility() {
  const dateValue = textValue('observeDate');
  const dayOfYear = dayOfYearFromDate(dateValue);
  return {
    latitude: numberValue('latitude'),
    declination: numberValue('targetDec'),
    targetRaHours: numberValue('targetRa'),
    minAltitude: numberValue('minAltitude'),
    dayOfYear: dayOfYear ?? 1,
    date: dayOfYear === null ? new Date().toISOString() : `${dateValue}T16:00:00.000Z`
  };
}

function collectTracking() {
  return {
    seeingArcsec: numberValue('trkSeeing'),
    trackingRmsArcsec: numberValue('trackingRms'),
    pixelScaleArcsec: numberValue('trkPixelScale'),
    subExposureSeconds: numberValue('trkSubExposure')
  };
}

function setStatus(text, tone) {
  elements.apiStatus.textContent = text;
  elements.apiStatus.className = `status status--${tone}`;
}

function setMessage(text, tone = 'hint') {
  elements.message.textContent = text;
  elements.message.className = tone;
}

async function refreshHealth() {
  try {
    const health = await fetchHealth();
    setStatus(`接口在线 · ${health.service}`, 'ok');
  } catch (error) {
    setStatus(`接口不可用：${error.message}`, 'error');
  }
}

async function refreshTargets() {
  try {
    const targets = await fetchTargets();
    setTargets(targets);
    renderTargetList(elements.targetList, targets, {
      onUse: useTargetForVisibility,
      onDelete: deleteCustomTarget
    });
  } catch (error) {
    elements.targetList.innerHTML = `<p class="error">目标库加载失败：${error.message}</p>`;
  }
}

function useTargetForVisibility(target) {
  elements.targetRa.value = target.raHours;
  elements.targetDec.value = target.decDeg;
  elements.targetMessage.textContent = `已把「${target.name}」的赤经赤纬填入可见性参数。`;
  elements.targetMessage.className = 'hint';
}

async function deleteCustomTarget(target) {
  try {
    await removeTarget(target.id);
    elements.targetMessage.textContent = `已删除自定义目标「${target.name}」。`;
    elements.targetMessage.className = 'hint';
    await refreshTargets();
  } catch (error) {
    elements.targetMessage.textContent = `删除失败：${error.message}`;
    elements.targetMessage.className = 'error';
  }
}

async function addCustomTarget() {
  const name = textValue('targetName');
  const raRaw = textValue('targetRaInput');
  const decRaw = textValue('targetDecInput');
  const payload = {
    name,
    raHours: raRaw === '' ? undefined : Number(raRaw),
    decDeg: decRaw === '' ? undefined : Number(decRaw),
    magnitude: optionalTextValue('targetMagInput'),
    sizeArcmin: optionalTextValue('targetSizeInput'),
    category: optionalTextValue('targetCategoryInput')
  };

  if (!name || raRaw === '' || decRaw === '') {
    elements.targetMessage.textContent = '目标名称、赤经、赤纬都是必填项。';
    elements.targetMessage.className = 'error';
    return;
  }

  try {
    const created = await createTarget(payload);
    elements.targetMessage.textContent = `已添加「${created.target.name}」。`;
    elements.targetMessage.className = 'hint';
    for (const key of [
      'targetName',
      'targetRaInput',
      'targetDecInput',
      'targetMagInput',
      'targetSizeInput',
      'targetCategoryInput'
    ]) {
      elements[key].value = '';
    }
    await refreshTargets();
  } catch (error) {
    elements.targetMessage.textContent = `添加失败：${error.message}`;
    elements.targetMessage.className = 'error';
  }
}

async function runPlan() {
  elements.planButton.disabled = true;
  setMessage('正在计算…');

  try {
    const [optics, exposure, visibility, tracking] = await Promise.all([
      postOptics(collectOptics()),
      postExposure(collectExposure()),
      postVisibility(collectVisibility()),
      postTracking(collectTracking())
    ]);

    setLastReport({ optics, exposure, visibility, tracking });
    renderOpticsPanel(elements.panels.optics, optics);
    renderExposurePanel(elements.panels.exposure, exposure);
    renderVisibilityPanel(elements.panels.visibility, visibility);
    renderTrackingPanel(elements.panels.tracking, tracking);
    setMessage(
      `计算完成：采样判定「${optics.sampling.level}」，叠加信噪比 ${exposure.stackedSnr}。`,
      'ok'
    );
  } catch (error) {
    setMessage(`计算失败：${error.message}`, 'error');
  } finally {
    elements.planButton.disabled = false;
  }
}

function bindEvents() {
  elements.planButton.addEventListener('click', runPlan);
  elements.resetButton.addEventListener('click', applyDefaults);
  elements.targetAddButton.addEventListener('click', addCustomTarget);
}

async function init() {
  cacheElements();
  applyDefaults();
  bindEvents();
  await Promise.all([refreshHealth(), refreshTargets()]);
}

init();
