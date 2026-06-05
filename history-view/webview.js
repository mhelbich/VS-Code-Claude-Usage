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
  const warnFg   = cs.getPropertyValue('--vscode-errorForeground').trim()            || '#f44747';

  document.documentElement.style.setProperty('--fg',        fg);
  document.documentElement.style.setProperty('--btn-bg',    btnBg);
  document.documentElement.style.setProperty('--btn-fg',    btnFg);
  document.documentElement.style.setProperty('--btn-act-bg', btnActBg);
  document.documentElement.style.setProperty('--btn-act-fg', btnActFg);
  document.documentElement.style.setProperty('--panel-bg',   panelBg);
  document.documentElement.style.setProperty('--warn-fg',    warnFg);

  let allEntries = window.__INITIAL_ENTRIES__ || [];
  let showUsed   = window.__INITIAL_SHOW_USED__ ?? true;
  let overlayDefaults = window.__INITIAL_SETTINGS__ || {
    showSessionResetMarkers: true,
    showWeeklyResetMarkers: true,
    showWeeklyForecast: true,
  };
  let overlayOverrides = {};
  let activeView = 'range:3600000';
  const FIVE_HOUR_MS = 5 * 3_600_000;
  const SEVEN_DAY_MS = 7 * 86_400_000;
  const FALLBACK_VIEW = 'range:3600000';

  const DATASETS = [
    { key: 'five_hour',      label: 'Session 5h',    yAxisID: 'yPct',     borderColor: '#4EC9B0', backgroundColor: '#4EC9B022' },
    { key: 'seven_day',      label: 'Weekly 7d',     yAxisID: 'yPct',     borderColor: '#569CD6', backgroundColor: '#569CD622' },
    { key: 'seven_day_opus', label: 'Opus 7d',       yAxisID: 'yPct',     borderColor: '#C586C0', backgroundColor: '#C586C022' },
    { key: 'extra_used',     label: 'Extra credits', yAxisID: 'yCredits', borderColor: '#CE9178', backgroundColor: '#CE917822' },
  ];

  const historyOverlayPlugin = {
    id: 'historyOverlays',
    afterDatasetsDraw(chart) {
      const overlayState = chart.options.plugins.historyOverlays;
      if (!overlayState) return;

      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      const yScale = scales.yPct;
      if (!xScale || !yScale || !chartArea) return;

      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
      ctx.clip();

      // Overlays are drawn after the datasets so markers and forecast lines sit on top of the raw history series.
      if (overlayState.showSessionResetMarkers) {
        drawVerticalMarkers(ctx, xScale, chartArea, overlayState.sessionStarts, '#4EC9B088', [4, 4]);
      }
      if (overlayState.showWeeklyResetMarkers) {
        drawVerticalMarkers(ctx, xScale, chartArea, overlayState.weeklyResets, '#569CD688', [8, 4]);
      }
      if (overlayState.showWeeklyForecast && overlayState.weeklyForecast) {
        drawForecastLine(ctx, xScale, yScale, overlayState.weeklyForecast.ideal, '#569CD6BB', [6, 4]);
        drawForecastLine(ctx, xScale, yScale, overlayState.weeklyForecast.projected, overlayState.weeklyForecast.warning ? '#f44747' : '#4EC9B0', []);
      }

      ctx.restore();
    },
  };

  const ctx = document.getElementById('chart').getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    plugins: [historyOverlayPlugin],
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
        historyOverlays: null,
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

  function parseIsoTime(value) {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function findLatestActiveWindow(entries, resetKey, durationMs, now) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const resetAt = parseIsoTime(entries[i][resetKey]);
      if (resetAt === null || resetAt <= now) continue;
      return { start: resetAt - durationMs, end: resetAt };
    }
    return null;
  }

  function getCurrentSessionWindow(entries, now) {
    return findLatestActiveWindow(entries, 'five_hour_resets_at', FIVE_HOUR_MS, now);
  }

  function getCurrentWeekWindow(entries, now) {
    return findLatestActiveWindow(entries, 'seven_day_resets_at', SEVEN_DAY_MS, now);
  }

  function getTodayWindow(now) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start: start.getTime(), end: end.getTime() };
  }

  function getEffectiveSetting(key) {
    return overlayOverrides[key] ?? overlayDefaults[key];
  }

  function setToggleState() {
    document.querySelectorAll('#overlay-controls input[data-toggle]').forEach(input => {
      input.checked = getEffectiveSetting(input.dataset.toggle);
    });
  }

  function clampPct(value) {
    return Math.max(0, Math.min(100, value));
  }

  function toDisplayPct(usedPct) {
    // Forecast math always stays in used-space; flip it here when the chart is showing remaining %.
    return showUsed ? clampPct(usedPct) : clampPct(100 - usedPct);
  }

  function getDistinctMarkers(entries, selector) {
    const seen = new Set();
    const values = [];
    for (const entry of entries) {
      const marker = selector(entry);
      if (marker === null || seen.has(marker)) continue;
      seen.add(marker);
      values.push(marker);
    }
    return values.sort((a, b) => a - b);
  }

  function getWeeklyForecast(entries, now) {
    const latest = [...entries].reverse().find(entry => entry.seven_day !== null && parseIsoTime(entry.seven_day_resets_at) !== null);
    if (!latest) return null;

    const weeklyReset = parseIsoTime(latest.seven_day_resets_at);
    if (weeklyReset === null || now >= weeklyReset || latest.seven_day === null) return null;

    const weeklyStart = weeklyReset - SEVEN_DAY_MS;
    const elapsedMs = now - weeklyStart;
    if (elapsedMs <= 0) return null;

    const currentUsed = latest.seven_day;
    const elapsedRatio = elapsedMs / SEVEN_DAY_MS;
    const projectedUsedAtReset = currentUsed / elapsedRatio;
    const projectedHitAt = currentUsed > 0 && projectedUsedAtReset > 100
      ? weeklyStart + (elapsedMs * 100) / currentUsed
      : null;

    return {
      weeklyStart,
      weeklyReset,
      projectedUsedAtReset,
      projectedHitAt: projectedHitAt !== null && projectedHitAt < weeklyReset ? projectedHitAt : null,
    };
  }

  function formatDuration(targetMs, now) {
    const diff = targetMs - now;
    if (diff <= 0) return 'resetting…';

    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const relative = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return `${relative} (${new Date(targetMs).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })})`;
  }

  function buildForecastSummary(forecast, now) {
    if (!forecast) {
      return { text: 'Weekly forecast: —', warning: false };
    }
    if (forecast.projectedHitAt !== null) {
      const hitText = formatDuration(forecast.projectedHitAt, now);
      return {
        text: showUsed
          ? `Weekly forecast: limit projects to hit in ${hitText} before reset.`
          : `Weekly forecast: remaining projects to reach 0 in ${hitText} before reset.`,
        warning: true,
      };
    }

    const projectedValue = showUsed ? forecast.projectedUsedAtReset : 100 - forecast.projectedUsedAtReset;
    return {
      text: showUsed
        ? `Weekly forecast: projected usage at reset ${projectedValue.toFixed(1)}%.`
        : `Weekly forecast: projected remaining at reset ${projectedValue.toFixed(1)}%.`,
      warning: false,
    };
  }

  function getViewport(now) {
    if (activeView === 'today') {
      return getTodayWindow(now);
    }
    if (activeView === 'current-session') {
      return getCurrentSessionWindow(allEntries, now) ?? { start: now - 3_600_000, end: now };
    }
    if (activeView === 'current-week') {
      return getCurrentWeekWindow(allEntries, now) ?? { start: now - SEVEN_DAY_MS, end: now };
    }

    const [, rangeMs] = activeView.split(':');
    const durationMs = Number(rangeMs);
    return { start: now - durationMs, end: now };
  }

  function syncRangeButtons(now) {
    const availableViews = {
      'current-session': getCurrentSessionWindow(allEntries, now) !== null,
      'current-week': getCurrentWeekWindow(allEntries, now) !== null,
      today: true,
    };

    if ((activeView === 'current-session' || activeView === 'current-week') && !availableViews[activeView]) {
      activeView = FALLBACK_VIEW;
    }

    document.querySelectorAll('#range-controls button[data-view]').forEach(button => {
      const view = button.dataset.view;
      const isDisabled = view in availableViews ? !availableViews[view] : false;
      button.disabled = isDisabled;
      button.classList.toggle('active', view === activeView);
      if (view === 'current-session') {
        button.title = isDisabled ? 'Current session is unavailable until a future session reset is present in history.' : '';
      } else if (view === 'current-week') {
        button.title = isDisabled ? 'Current week is unavailable until a future weekly reset is present in history.' : '';
      } else {
        button.title = '';
      }
    });
  }

  function drawVerticalMarkers(ctx, xScale, chartArea, markers, color, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    for (const marker of markers) {
      if (marker < xScale.min || marker > xScale.max) continue;
      const x = xScale.getPixelForValue(marker);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawForecastLine(ctx, xScale, yScale, line, color, dash) {
    const startX = xScale.getPixelForValue(line.x1);
    const endX = xScale.getPixelForValue(line.x2);
    const startY = yScale.getPixelForValue(line.y1);
    const endY = yScale.getPixelForValue(line.y2);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    const now    = Date.now();
    syncRangeButtons(now);

    const viewport = getViewport(now);
    const filtered = allEntries.filter(e => e.timestamp >= viewport.start && e.timestamp <= viewport.end);
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

    chart.options.scales.x.min = viewport.start;
    chart.options.scales.x.max = viewport.end;

    chart.options.scales.yPct.title.text = showUsed ? '% used' : '% remaining';

    const latestLimit = [...allEntries].reverse().find(e => e.extra_limit !== null)?.extra_limit;
    if (latestLimit != null) chart.options.scales.yCredits.max = latestLimit;

    const weeklyForecast = getWeeklyForecast(allEntries, now);
    chart.options.plugins.historyOverlays = {
      showSessionResetMarkers: getEffectiveSetting('showSessionResetMarkers'),
      showWeeklyResetMarkers: getEffectiveSetting('showWeeklyResetMarkers'),
      showWeeklyForecast: getEffectiveSetting('showWeeklyForecast'),
      sessionStarts: getDistinctMarkers(allEntries, entry => {
        const resetAt = parseIsoTime(entry.five_hour_resets_at);
        return resetAt === null ? null : resetAt - FIVE_HOUR_MS;
      }),
      weeklyResets: getDistinctMarkers(allEntries, entry => parseIsoTime(entry.seven_day_resets_at)),
      weeklyForecast: weeklyForecast
        ? {
            warning: weeklyForecast.projectedHitAt !== null,
            ideal: {
              x1: weeklyForecast.weeklyStart,
              y1: toDisplayPct(0),
              x2: weeklyForecast.weeklyReset,
              y2: toDisplayPct(100),
            },
            projected: {
              x1: weeklyForecast.weeklyStart,
              y1: toDisplayPct(0),
              x2: weeklyForecast.weeklyReset,
              y2: toDisplayPct(weeklyForecast.projectedUsedAtReset),
            },
          }
        : null,
    };

    chart.update('none');

    const last = allEntries.length > 0 ? allEntries[allEntries.length - 1].timestamp : null;
    document.getElementById('last-updated').textContent = last ? formatTs(last) : '—';
    const summary = buildForecastSummary(weeklyForecast, now);
    const summaryEl = document.getElementById('forecast-summary');
    summaryEl.textContent = summary.text;
    summaryEl.classList.toggle('warning', summary.warning);
  }

  document.getElementById('range-controls').addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    if (btn.disabled) return;
    activeView = btn.dataset.view;
    render();
  });

  document.getElementById('overlay-controls').addEventListener('change', e => {
    const input = e.target.closest('input[data-toggle]');
    if (!input) return;
    // These overrides are intentionally local to the current webview session and do not write back to settings.
    overlayOverrides[input.dataset.toggle] = input.checked;
    render();
  });

  window.addEventListener('message', e => {
    if (e.data?.type === 'data') {
      allEntries = e.data.entries;
      showUsed   = e.data.showUsed ?? showUsed;
      overlayDefaults = e.data.settings ?? overlayDefaults;
      setToggleState();
      render();
    }
  });

  setToggleState();
  render();

  // Signal to the extension that the webview is ready to receive messages.
  // This handles the race where postMessage is called before the JS listener
  // is registered, which would silently drop the message.
  const vscode = acquireVsCodeApi();
  vscode.postMessage({ type: 'ready' });
})();
