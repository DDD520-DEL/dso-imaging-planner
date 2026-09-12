import { formatNumber } from '../format.js';
import { FOCUS_TRAVEL_TOLERANCE_MM, threadLabel } from '../train.js';
import { escapeHtml, metricGrid } from './metrics.js';

function mm(value, digits = 2) {
  return `${formatNumber(value, digits)} mm`;
}

function gapNote(gapMm) {
  if (Math.abs(gapMm) < 0.01) return '<span class="ok">正好合焦</span>';
  return `<span class="hint">差额 ${mm(gapMm)} 由调焦行程吸收（容差 ${formatNumber(FOCUS_TRAVEL_TOLERANCE_MM, 1)} mm）</span>`;
}

function solutionTable(report, solution) {
  const otaRow = `
    <tr>
      <td>1</td>
      <td>${escapeHtml(report.otaName)}</td>
      <td>主镜</td>
      <td>—</td>
      <td>0</td>
      <td><span class="hint">光路起点（后端 ${escapeHtml(threadLabel(report.otaThreadRear))}）</span></td>
    </tr>`;
  const partRows = solution.parts
    .map((part, index) => {
      const prevThread = index === 0 ? report.otaThreadRear : solution.parts[index - 1].threadRear;
      return `
        <tr>
          <td>${index + 2}</td>
          <td>${escapeHtml(part.name)}</td>
          <td>${part.typeLabel}</td>
          <td>${formatNumber(part.lengthMm, 2)}</td>
          <td>${formatNumber(part.cumulativeMm, 2)}</td>
          <td><span class="ok">✓ ${escapeHtml(threadLabel(prevThread))} ↔ ${escapeHtml(threadLabel(part.threadFront))}</span></td>
        </tr>`;
    })
    .join('');
  const lastThread =
    solution.parts.length > 0 ? solution.parts[solution.parts.length - 1].threadRear : report.otaThreadRear;
  const cameraRow = `
    <tr>
      <td>${solution.parts.length + 2}</td>
      <td>${escapeHtml(report.cameraName)}</td>
      <td>相机</td>
      <td>${formatNumber(report.cameraFlangeMm, 2)}</td>
      <td>${formatNumber(solution.totalLengthMm, 2)}</td>
      <td><span class="ok">✓ ${escapeHtml(threadLabel(lastThread))} ↔ ${escapeHtml(threadLabel(report.cameraThreadFront))}</span></td>
    </tr>`;

  return `
    <table class="train-table">
      <thead>
        <tr><th>#</th><th>器材</th><th>类型</th><th>占位（mm）</th><th>累计（mm）</th><th>接口对接</th></tr>
      </thead>
      <tbody>${otaRow}${partRows}${cameraRow}</tbody>
    </table>`;
}

function solutionCard(report, solution, index) {
  const title =
    solution.partCount === 0
      ? `方案 ${index + 1}：相机直连，无需中间件`
      : `方案 ${index + 1}：${solution.partCount} 件 · 中段 ${mm(solution.middleLengthMm)}`;
  const weightLine =
    report.payloadMarginKg !== null
      ? solution.overweight
        ? `<span class="error">整套 ${formatNumber(solution.weightG / 1000, 2)} kg（含导星）· 超重 ${formatNumber((solution.weightG - report.payloadMarginKg * 1000) / 1000, 2)} kg</span>`
        : `<span class="ok">整套 ${formatNumber(solution.weightG / 1000, 2)} kg（含导星）· 余量内</span>`
      : '';
  return `
    <section class="solve-card${solution.overweight ? ' solve-card--overweight' : ''}">
      <h4>${solution.overweight ? '⚠️ ' : ''}${title}</h4>
      <p class="hint">链路总长 ${mm(solution.totalLengthMm)} / 要求后截距 ${mm(report.requiredBackfocusMm)} · ${gapNote(solution.gapMm)}${weightLine ? ` · ${weightLine}` : ''}</p>
      ${solutionTable(report, solution)}
    </section>`;
}

export function renderSolvePanel(container, report) {
  container.hidden = false;

  if (!report.ok) {
    container.innerHTML = `
      <h3>反推搭配</h3>
      ${metricGrid([
        ['中段目标长度', mm(report.targetMm), `要求后截距 ${mm(report.requiredBackfocusMm)} − 相机法兰距 ${mm(report.cameraFlangeMm)}`],
        ['可行组合', '0 套', '手上的可选件凑不出']
      ])}
      <p class="error">⛔ 凑不出正好合焦的组合，卡点如下：</p>
      <ul class="warnings">
        ${report.blockers.map((b) => `<li>⛔ ${escapeHtml(b.message)}</li>`).join('')}
      </ul>`;
    return;
  }

  const truncated = report.solutionCount > report.solutions.length;
  const overweightCount = report.solutions.filter((s) => s.overweight).length;
  const marginMetric =
    report.payloadMarginKg !== null
      ? [
          [
            '载重余量',
            `${formatNumber(report.payloadMarginKg, 2)} kg`,
            overweightCount > 0 ? `${overweightCount} / ${report.solutions.length} 套超重` : '全部方案余量内'
          ]
        ]
      : [];
  container.innerHTML = `
    <h3>反推搭配</h3>
    ${metricGrid([
      ['中段目标长度', mm(report.targetMm), `要求后截距 ${mm(report.requiredBackfocusMm)} − 相机法兰距 ${mm(report.cameraFlangeMm)}`],
      ['可行组合', `${report.solutionCount} 套`, '合格的在前，超重的排最后'],
      ...marginMetric
    ])}
    ${report.allOverweight ? '<p class="error">⛔ 所有方案整套重量都超出赤道仪载重余量，需要减重或换更大载重的赤道仪。</p>' : ''}
    ${truncated ? `<p class="hint">方案较多，仅显示前 ${report.solutions.length} 套。</p>` : ''}
    ${report.solutions.map((solution, index) => solutionCard(report, solution, index)).join('')}`;
}
