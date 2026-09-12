async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error ?? `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

export const fetchHealth = () => request('/api/health');
export const fetchTargets = () => request('/api/targets');
export const createTarget = (payload) => request('/api/targets', { method: 'POST', body: payload });
export const removeTarget = (id) => request(`/api/targets/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const postOptics = (payload) => request('/api/optics/report', { method: 'POST', body: payload });
export const postExposure = (payload) => request('/api/exposure/estimate', { method: 'POST', body: payload });
export const postVisibility = (payload) => request('/api/visibility/plan', { method: 'POST', body: payload });
export const postTracking = (payload) => request('/api/tracking/check', { method: 'POST', body: payload });
export const postSchedule = (payload) => request('/api/schedule/plan', { method: 'POST', body: payload });
export const postTrain = (payload) => request('/api/train/check', { method: 'POST', body: payload });
export const postSolve = (payload) => request('/api/train/solve', { method: 'POST', body: payload });
