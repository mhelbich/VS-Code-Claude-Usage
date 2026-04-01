(function () {
  // Resolve VS Code CSS variables into concrete values for Chart.js (canvas ignores CSS vars)
  const cs = getComputedStyle(document.documentElement);
  const fg       = cs.getPropertyValue('--vscode-foreground').trim()                 || '#cccccc';
  const gridLine = cs.getPropertyValue('--vscode-editorWidget-border').trim()        || 'rgba(128,128,128,0.2)';
  const btnBg    = cs.getPropertyValue('--vscode-button-secondaryBackground').trim() || '#3a3a3a';
  const btnFg    = cs.getPropertyValue('--vscode-button-secondaryForeground').trim() || '#cccccc';
  const btnActBg = cs.getPropertyValue('--vscode-button-background').trim()          || '#0e639c';
  const btnActFg = cs.getPropertyValue('--vscode-button-foreground').trim()          || '#ffffff';
  const panelBg  = cs.getPropertyValue('--vscode-panel-background').trim()           || '#252526';

  document.documentElement.style.setProperty('--fg',        fg);
  document.documentElement.style.setProperty('--btn-bg',    btnBg);
  document.documentElement.style.setProperty('--btn-fg',    btnFg);
  document.documentElement.style.setProperty('--btn-act-bg', btnActBg);
  document.documentElement.style.setProperty('--btn-act-fg', btnActFg);
  document.documentElement.style.setProperty('--panel-bg',   panelBg);

  let allEntries = window.__INITIAL_ENTRIES__ || [];
  let showUsed   = window.__INITIAL_SHOW_USED__ ?? true;
  let activeRangeMs = 3_600_000;

  const DATASETS = [
    { key: 'five_hour',      label: 'Session 5h',    yAxisID: 'yPct',     borderColor: '#4EC9B0', backgroundColor: '#4EC9B022' },
    { key: 'seven_day',      label: 'Weekly 7d',     yAxisID: 'yPct',     borderColor: '#569CD6', backgroundColor: '#569CD622' },
    { key: 'seven_day_opus', label: 'Opus 7d',       yAxisID: 'yPct',     borderColor: '#C586C0', backgroundColor: '#C586C022' },
    { key: 'extra_used',     label: 'Extra credits', yAxisID: 'yCredits', borderColor: '#CE9178', backgroundColor: '#CE917822' },
  ];

  const ctx = document.getElementById('chart').getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: DATASETS.map(d => ({
        label: d.label,
        data: [],
        yAxisID: d.yAxisID,
        borderColor: d.borderColor,
        backgroundColor: d.backgroundColor,
        borderWidth: 1.5,
        pointRadius: 2,
        tension: 0.3,
        fill: false,
      })),
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          ticks: {
            maxTicksLimit: 6,
            color: fg,
            font: { size: 10 },
            callback: (val) => formatTs(val),
          },
          grid: { color: gridLine },
        },
        yPct: {
          type: 'linear', position: 'left', min: 0, max: 100,
          ticks: { color: fg, font: { size: 10 } },
          grid:  { color: gridLine },
          title: { display: true, text: '%', color: fg, font: { size: 10 } },
        },
        yCredits: {
          type: 'linear', position: 'right', min: 0,
          ticks: { color: fg, font: { size: 10 } },
          grid:  { drawOnChartArea: false },
          title: { display: true, text: 'credits', color: fg, font: { size: 10 } },
        },
      },
      plugins: {
        legend:  { labels: { color: fg, font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            title: (items) => items.length ? formatTs(items[0].parsed.x) : '',
          },
        },
      },
    },
  });

  function formatTs(ms) {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function render() {
    const now    = Date.now();
    const cutoff = now - activeRangeMs;
    const filtered = allEntries.filter(e => e.timestamp >= cutoff);
    const empty    = allEntries.length === 0;

    document.getElementById('empty').style.display      = empty ? 'block' : 'none';
    document.getElementById('chart-wrap').style.display = empty ? 'none'  : 'block';
    document.getElementById('controls').style.display   = empty ? 'none'  : 'flex';

    chart.data.labels = [];
    DATASETS.forEach((d, i) => {
      chart.data.datasets[i].data = filtered.map(e => {
        const v = e[d.key];
        const y = (d.yAxisID === 'yPct' && v !== null) ? (showUsed ? v : 100 - v) : v;
        return { x: e.timestamp, y };
      });
    });

    chart.options.scales.x.min = cutoff;
    chart.options.scales.x.max = now;

    chart.options.scales.yPct.title.text = showUsed ? '% used' : '% remaining';

    const latestLimit = [...allEntries].reverse().find(e => e.extra_limit !== null)?.extra_limit;
    if (latestLimit != null) chart.options.scales.yCredits.max = latestLimit;

    chart.update('none');

    const last = allEntries.length > 0 ? allEntries[allEntries.length - 1].timestamp : null;
    document.getElementById('last-updated').textContent = last ? formatTs(last) : '—';
  }

  document.getElementById('controls').addEventListener('click', e => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    document.querySelectorAll('#controls button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeRangeMs = Number(btn.dataset.range);
    render();
  });

  window.addEventListener('message', e => {
    if (e.data?.type === 'data') {
      allEntries = e.data.entries;
      showUsed   = e.data.showUsed ?? showUsed;
      render();
    }
  });

  render();

  // Signal to the extension that the webview is ready to receive messages.
  // This handles the race where postMessage is called before the JS listener
  // is registered, which would silently drop the message.
  const vscode = acquireVsCodeApi();
  vscode.postMessage({ type: 'ready' });
})();
