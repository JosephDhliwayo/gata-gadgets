(function () {
  const el = document.getElementById('pl-chart');
  const tabs = document.querySelectorAll('.pl-tab');
  if (!el || !window.PL_SERIES || tabs.length === 0) return;

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function buildSVG(data) {
    const { labels, sales, profit } = data;
    const w = Math.max(labels.length * 56, 320);
    const h = 220;
    const padL = 60, padR = 12, padT = 16, padB = 34;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const allValues = sales.concat(profit, [0]);
    let maxV = Math.max(...allValues);
    let minV = Math.min(...allValues);
    if (maxV === minV) { maxV += 1; minV -= 1; }
    const pad = (maxV - minV) * 0.12;
    maxV += pad;
    minV -= pad;

    const xStep = labels.length > 1 ? plotW / (labels.length - 1) : 0;
    const yScale = (v) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;
    const xScale = (i) => padL + i * xStep;
    const zeroY = yScale(0);

    const toPoints = (arr) => arr.map((v, i) => `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');

    const gridParts = [];
    const gridCount = 4;
    for (let g = 0; g <= gridCount; g++) {
      const v = minV + (maxV - minV) * (g / gridCount);
      const y = yScale(v);
      gridParts.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`);
      gridParts.push(`<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" font-size="10" fill="#64748b" text-anchor="end">$${Math.round(v).toLocaleString()}</text>`);
    }

    const xLabels = labels.map((l, i) =>
      `<text x="${xScale(i).toFixed(1)}" y="${h - 10}" font-size="10" fill="#64748b" text-anchor="middle">${escapeXml(l)}</text>`
    ).join('');

    const salesPoints = sales.map((v, i) =>
      `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(v).toFixed(1)}" r="3" fill="#7c3aed"><title>${escapeXml(labels[i])} — Sales: $${v.toFixed(2)}</title></circle>`
    ).join('');

    const profitPoints = profit.map((v, i) =>
      `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(v).toFixed(1)}" r="3" fill="${v >= 0 ? '#16a34a' : '#dc2626'}"><title>${escapeXml(labels[i])} — Profit: $${v.toFixed(2)}</title></circle>`
    ).join('');

    return `
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Profit and loss trend">
        ${gridParts.join('')}
        <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${w - padR}" y2="${zeroY.toFixed(1)}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,3"/>
        <polyline points="${toPoints(sales)}" fill="none" stroke="#7c3aed" stroke-width="2"/>
        <polyline points="${toPoints(profit)}" fill="none" stroke="#16a34a" stroke-width="2"/>
        ${salesPoints}
        ${profitPoints}
        ${xLabels}
      </svg>
    `;
  }

  function render(granularity) {
    const data = window.PL_SERIES[granularity];
    if (!data || data.labels.length === 0) {
      el.innerHTML = '<p class="muted">No data yet for this period.</p>';
      return;
    }
    el.innerHTML = buildSVG(data);
  }

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      render(btn.dataset.granularity);
    });
  });

  render('daily');
})();
