// 儀表板用的小工具：趨勢長條圖（伺服器端產生 SVG，不依賴任何前端圖表函式庫）與增減比較。
// 輸出只包含數字與固定文字（月份來自程式自己產生的 YYYY-MM），不會夾帶使用者輸入。

const INVOICED_COLOR = '#CBD5E1'; // 開票：淺灰
const RECEIVED_COLOR = '#1E293B'; // 收款：深板岩

// 金額縮寫：1.2 億、3,450 萬、12,000
function shortAmount(value) {
  const v = Math.abs(Number(value) || 0);
  if (v >= 1e8) return `${(v / 1e8).toFixed(1).replace(/\.0$/, '')}億`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString('en-US')}萬`;
  return Math.round(v).toLocaleString('en-US');
}

// Y 軸上限取「好看」的值：1、2、2.5、5、10 × 10^n
function niceMax(max) {
  if (!(max > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/**
 * 本期 vs 上期的增減
 * @returns {{text: string, dir: 'up'|'down'|'flat'|'none'}}  none：上期為 0，無法比較
 */
function formatDelta(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) {
    return cur === 0 ? { text: '與上月持平', dir: 'flat' } : { text: '上月無資料', dir: 'none' };
  }
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return { text: '與上月持平', dir: 'flat' };
  return { text: `較上月 ${pct > 0 ? '+' : ''}${pct}%`, dir: pct > 0 ? 'up' : 'down' };
}

/**
 * @param {Array<{ym: string, invoiced: number, received: number}>} trend 舊→新
 * @param {string} currentYm 本月（YYYY-MM），該月份標籤加粗
 */
function renderTrendSvg(trend, currentYm) {
  const W = 720, H = 210;
  const padL = 44, padR = 8, padT = 12, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = niceMax(Math.max(0, ...trend.map(t => Math.max(t.invoiced, t.received))));
  const groupW = plotW / trend.length;
  const barW = Math.min(16, groupW * 0.34);
  const gap = 3;
  const y = (v) => padT + plotH - (Math.max(0, v) / maxVal) * plotH;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="近 12 個月開票與收款金額" style="display:block;max-width:100%;height:auto">`);

  // 水平格線與 Y 軸標籤（0、1/2、最大）
  for (const ratio of [0, 0.5, 1]) {
    const val = maxVal * ratio;
    const yy = y(val);
    parts.push(`<line x1="${padL}" x2="${W - padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#E2E8F0" stroke-width="1"/>`);
    parts.push(`<text x="${padL - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#64748B">${shortAmount(val)}</text>`);
  }

  trend.forEach((t, idx) => {
    const cx = padL + groupW * idx + groupW / 2;
    const month = parseInt(t.ym.slice(5, 7), 10);
    const label = month === 1 || idx === 0 ? `${t.ym.slice(2, 4)}/${month}` : String(month);
    const isCurrent = t.ym === currentYm;
    const bars = [
      { v: t.invoiced, color: INVOICED_COLOR, x: cx - barW - gap / 2, name: '開票' },
      { v: t.received, color: RECEIVED_COLOR, x: cx + gap / 2, name: '收款' }
    ];
    for (const b of bars) {
      const top = y(b.v);
      const h = Math.max(0, padT + plotH - top);
      parts.push(`<rect x="${b.x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${b.color}"><title>${t.ym} ${b.name} ${Math.round(b.v).toLocaleString('en-US')}</title></rect>`);
    }
    parts.push(`<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${isCurrent ? '#1E293B' : '#64748B'}"${isCurrent ? ' font-weight="700"' : ''}>${label}</text>`);
  });

  parts.push('</svg>');
  return parts.join('');
}

module.exports = { shortAmount, niceMax, formatDelta, renderTrendSvg, INVOICED_COLOR, RECEIVED_COLOR };
