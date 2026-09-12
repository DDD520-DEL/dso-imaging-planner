import { formatNumber } from '../format.js';
import { FOCUS_TRAVEL_TOLERANCE_MM } from '../train.js';
import { escapeHtml, metricGrid } from './metrics.js';

const FOCUS_TEXT = {
  exact: '正好合焦',
  'need-spacer': '需要加转接环',
  'over-length': '链路超长'
};

function mm(value, digits = 2) {
  return `${formatNumber(value, digits)} mm`;
}

function focusBlock(report) {
  const { focus, gapMm } = report;
  if (focus.status === 'exact') {
    const absorbed = Math.abs(gapMm);
    if (absorbed < 0.01) {
      return `<p class="ok">✅ 链路总长与要求后截距一致，可以直接合焦。</p>`;
    }
    const direction = gapMm > 0 ? '短' : '长';
    return `<p class="ok">✅ 链路比要求后截距${direction} ${mm(absorbed)}，不足 ${formatNumber(FOCUS_TRAVEL_TOLERANCE_MM, 1)} mm，由调焦行程直接吸收，无需加转接环。</p>`;
  }
  if (focus.status === 'over-length') {
    return `<p class="error">⛔ 链路超长 ${mm(-gapMm)}，加转接环无法解决，请减薄部件或缩短调焦座占位。</p>`;
  }
  const combo = focus.spacers.map((s) => `${formatNumber(s.thicknessMm, 1)} mm × ${s.count}`).join(' + ');
  const residual =
    focus.residualMm > 0
      ? `<span class="hint">剩余 ${mm(focus.residualMm)} 由调焦座行程吸收；转接环需自备与两侧一致的接口。</span>`
      : '<span class="hint">转接环需自备与两侧一致的接口。</span>';
  return `
    <div class="train-spacer">
      <p class="warn">⚠️ 还差 ${mm(gapMm)} 才能合焦，建议转接环组合：<strong>${escapeHtml(combo)}</strong>（共 ${mm(focus.spacerTotalMm, 1)}）</p>
      ${residual}
    </div>`;
}

function chainTable(report) {
  return `
    <table class="train-table">
      <thead>
        <tr><th>#</th><th>器材</th><th>类型</th><th>占位（mm）</th><th>累计（mm）</th><th>接口对接</th></tr>
      </thead>
      <tbody>
        ${report.chain
          .map(
            (row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.name)}</td>
            <td>${row.typeLabel}</td>
            <td>${formatNumber(row.lengthMm, 2)}</td>
            <td>${formatNumber(row.cumulativeMm, 2)}</td>
            <td>${
              row.joint
                ? `<span class="${row.joint.ok ? 'ok' : 'error'}">${row.joint.ok ? '✓' : '✕'} ${escapeHtml(row.joint.detail)}</span>`
                : '<span class="hint">光路起点</span>'
            }</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function problemList(report) {
  if (!report.problems.length) return '';
  return `<ul class="warnings">
    ${report.problems.map((p) => `<li>⛔ ${escapeHtml(p.message)}</li>`).join('')}
  </ul>`;
}

export function renderTrainPanel(container, report) {
  container.hidden = false;
  const weight = report.weight;
  const focusHint =
    report.focus.status === 'exact' && Math.abs(report.gapMm) >= 0.01
      ? '调焦行程吸收'
      : FOCUS_TEXT[report.focus.status];
  const guideMetrics = report.guide
    ? [
        [
          '导星采样比',
          `${formatNumber(report.guide.ratio, 2)}（${report.guide.level}）`,
          `主镜 ${formatNumber(report.guide.mainScaleArcsec, 2)}″/px · 导星 ${formatNumber(report.guide.guideScaleArcsec, 2)}″/px`
        ]
      ]
    : [];

  container.innerHTML = `
    <h3>器材齐套校核</h3>
    ${metricGrid([
      ['要求后截距', mm(report.requiredBackfocusMm), '主镜后端面到焦平面'],
      ['链路总长', mm(report.totalLengthMm), '不含主镜，含相机法兰距'],
      ['合焦差额', mm(report.gapMm), focusHint],
      [
        '整套重量',
        `${formatNumber(weight.totalG / 1000, 2)} kg`,
        `载重余量 ${formatNumber(weight.marginG / 1000, 2)} kg · ${weight.ok ? '余量内' : `超 ${formatNumber(weight.excessG / 1000, 2)} kg`}`
      ],
      ...guideMetrics
    ])}
    ${focusBlock(report)}
    ${problemList(report)}
    <h4>链路长度累加</h4>
    ${chainTable(report)}
    ${
      report.guide
        ? `<p class="hint">导星采样比 = 导星像素尺度 ÷ 主镜像素尺度：${escapeHtml(report.guide.note)}</p>`
        : '<p class="hint">清单里没有导星设备，未计算导星采样比。</p>'
    }
  `;
}
