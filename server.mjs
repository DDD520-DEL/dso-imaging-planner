import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { EXPOSURE_LIMITS, exposureEstimate } from './src/exposure.js';
import { OPTICS_LIMITS, opticsReport } from './src/optics.js';
import { BUILTIN_TARGETS, normalizeTarget } from './src/targets.js';
import { TRACKING_LIMITS, trackingReport } from './src/tracking.js';
import { VISIBILITY_LIMITS, visibilityPlan } from './src/visibility.js';
import { readTargetsFile, writeTargetsFile } from './src/store.js';
import { ValidationError, numberField, requireBody } from './src/validate.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const defaultDataFile = join(root, 'data', 'targets.json');
const defaultPort = Number(process.env.PORT ?? 5175);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, limit = 100_000) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw Object.assign(new Error('请求体过大'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('请求体不是合法的 JSON');
  }
}

function readOpticsInput(body) {
  requireBody(body);
  return {
    focalLengthMm: numberField(body, 'focalLengthMm', OPTICS_LIMITS.focalLengthMm),
    apertureMm: numberField(body, 'apertureMm', OPTICS_LIMITS.apertureMm),
    pixelSizeUm: numberField(body, 'pixelSizeUm', OPTICS_LIMITS.pixelSizeUm),
    sensorWidthPx: numberField(body, 'sensorWidthPx', OPTICS_LIMITS.sensorWidthPx),
    sensorHeightPx: numberField(body, 'sensorHeightPx', OPTICS_LIMITS.sensorHeightPx),
    seeingArcsec: numberField(body, 'seeingArcsec', OPTICS_LIMITS.seeingArcsec),
    wavelengthNm: numberField(body, 'wavelengthNm', { ...OPTICS_LIMITS.wavelengthNm, fallback: 550 })
  };
}

function readExposureInput(body) {
  requireBody(body);
  return {
    apertureMm: numberField(body, 'apertureMm', EXPOSURE_LIMITS.apertureMm),
    pixelScaleArcsec: numberField(body, 'pixelScaleArcsec', EXPOSURE_LIMITS.pixelScaleArcsec),
    skyBrightness: numberField(body, 'skyBrightness', EXPOSURE_LIMITS.skyBrightness),
    throughput: numberField(body, 'throughput', { ...EXPOSURE_LIMITS.throughput, fallback: 0.8 }),
    quantumEfficiency: numberField(body, 'quantumEfficiency', {
      ...EXPOSURE_LIMITS.quantumEfficiency,
      fallback: 0.6
    }),
    readNoise: numberField(body, 'readNoise', EXPOSURE_LIMITS.readNoise),
    darkCurrent: numberField(body, 'darkCurrent', { ...EXPOSURE_LIMITS.darkCurrent, fallback: 0.01 }),
    fullWell: numberField(body, 'fullWell', { ...EXPOSURE_LIMITS.fullWell, fallback: 50000 }),
    subExposureSeconds: numberField(body, 'subExposureSeconds', EXPOSURE_LIMITS.subExposureSeconds),
    frames: numberField(body, 'frames', { ...EXPOSURE_LIMITS.frames, fallback: 60 }),
    targetSnr: numberField(body, 'targetSnr', { ...EXPOSURE_LIMITS.targetSnr, fallback: 30 })
  };
}

function readVisibilityInput(body) {
  requireBody(body);
  return {
    latitude: numberField(body, 'latitude', VISIBILITY_LIMITS.latitude),
    declination: numberField(body, 'declination', VISIBILITY_LIMITS.declination),
    targetRaHours: numberField(body, 'targetRaHours', VISIBILITY_LIMITS.targetRaHours),
    minAltitude: numberField(body, 'minAltitude', { ...VISIBILITY_LIMITS.minAltitude, fallback: 20 }),
    dayOfYear: numberField(body, 'dayOfYear', { ...VISIBILITY_LIMITS.dayOfYear, fallback: 1 }),
    date: typeof body.date === 'string' && body.date.trim() ? body.date.trim() : new Date().toISOString()
  };
}

function readTrackingInput(body) {
  requireBody(body);
  return {
    seeingArcsec: numberField(body, 'seeingArcsec', TRACKING_LIMITS.seeingArcsec),
    trackingRmsArcsec: numberField(body, 'trackingRmsArcsec', TRACKING_LIMITS.trackingRmsArcsec),
    pixelScaleArcsec: numberField(body, 'pixelScaleArcsec', TRACKING_LIMITS.pixelScaleArcsec),
    subExposureSeconds: numberField(body, 'subExposureSeconds', TRACKING_LIMITS.subExposureSeconds),
    tolerancePixels: numberField(body, 'tolerancePixels', { ...TRACKING_LIMITS.tolerancePixels, fallback: 1 })
  };
}

async function handleApi(request, response, url, dataFile) {
  const method = request.method ?? 'GET';
  const { pathname } = url;

  if (method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, {
      status: 'ok',
      service: 'dso-imaging-planner',
      time: new Date().toISOString()
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/targets') {
    sendJson(response, 200, { builtin: BUILTIN_TARGETS, custom: await readTargetsFile(dataFile) });
    return;
  }

  if (method === 'POST' && pathname === '/api/targets') {
    const body = await readJsonBody(request);
    const target = normalizeTarget(body);
    const custom = await readTargetsFile(dataFile);
    if (custom.some((item) => item.name === target.name)) {
      throw new ValidationError(`自定义目标里已经有「${target.name}」`);
    }
    target.id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    custom.push(target);
    await writeTargetsFile(dataFile, custom);
    sendJson(response, 201, { target });
    return;
  }

  const deleteMatch = pathname.match(/^\/api\/targets\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const id = decodeURIComponent(deleteMatch[1]);
    const custom = await readTargetsFile(dataFile);
    const next = custom.filter((item) => item.id !== id);
    if (next.length === custom.length) {
      sendJson(response, 404, { error: '目标不存在，内置目标不可删除' });
      return;
    }
    await writeTargetsFile(dataFile, next);
    sendJson(response, 200, { deleted: id });
    return;
  }

  if (method === 'POST' && pathname === '/api/optics/report') {
    sendJson(response, 200, opticsReport(readOpticsInput(await readJsonBody(request))));
    return;
  }

  if (method === 'POST' && pathname === '/api/exposure/estimate') {
    sendJson(response, 200, exposureEstimate(readExposureInput(await readJsonBody(request))));
    return;
  }

  if (method === 'POST' && pathname === '/api/visibility/plan') {
    sendJson(response, 200, visibilityPlan(readVisibilityInput(await readJsonBody(request))));
    return;
  }

  if (method === 'POST' && pathname === '/api/tracking/check') {
    sendJson(response, 200, trackingReport(readTrackingInput(await readJsonBody(request))));
    return;
  }

  sendJson(response, 404, { error: `接口不存在：${method} ${pathname}` });
}

async function serveStatic(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { error: '请求路径编码不合法' });
    return;
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = resolve(root, normalize(relative));
  if (target !== root && !target.startsWith(root + sep)) {
    sendJson(response, 403, { error: '路径越界' });
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) {
      throw Object.assign(new Error('不是文件'), { code: 'ENOENT' });
    }
    const data = await readFile(target);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(data);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('未找到资源');
      return;
    }
    throw error;
  }
}

export function createAppServer({ dataFile = defaultDataFile } = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(request, response, url, dataFile);
        return;
      }
      await serveStatic(request, response);
    } catch (error) {
      if (error instanceof ValidationError || Number.isInteger(error.statusCode)) {
        sendJson(response, error.statusCode ?? 400, { error: error.message });
        return;
      }
      console.error('[server] 未处理的错误', error);
      sendJson(response, 500, { error: '服务内部错误' });
    }
  });
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  createAppServer().listen(defaultPort, () => {
    console.log(`深空天文摄影规划工作台已启动：http://localhost:${defaultPort}`);
  });
}
