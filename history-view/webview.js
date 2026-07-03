/* global Chart */
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
  const paceFg   = cs.getPropertyValue('--vscode-descriptionForeground').trim()      || '#9da3ad';
  const forecastSafeFg = cs.getPropertyValue('--vscode-charts-yellow').trim()        || '#d7a33d';

  document.documentElement.style.setProperty('--fg',        fg);
  document.documentElement.style.setProperty('--btn-bg',    btnBg);
  document.documentElement.style.setProperty('--btn-fg',    btnFg);
  document.documentElement.style.setProperty('--btn-act-bg', btnActBg);
  document.documentElement.style.setProperty('--btn-act-fg', btnActFg);
  document.documentElement.style.setProperty('--panel-bg',   panelBg);
  document.documentElement.style.setProperty('--warn-fg',    warnFg);
  document.documentElement.style.setProperty('--legend-pace', paceFg);
  document.documentElement.style.setProperty('--legend-projection', forecastSafeFg);
  document.documentElement.style.setProperty('--legend-risk', warnFg);
  document.documentElement.style.setProperty('--forecast-safe', forecastSafeFg);

  const vscode = acquireVsCodeApi();
  let persistedState = vscode.getState() || {};

  let allEntries = window.__INITIAL_ENTRIES__ || [];
  let showUsed   = window.__INITIAL_SHOW_USED__ ?? true;
  let weeklyForecast = window.__INITIAL_FORECAST__ || null;
  let overlayDefaults = window.__INITIAL_SETTINGS__ || {
    showSessionResetMarkers: true,
    showWeeklyResetMarkers: true,
    showWeeklyForecast: true,
    showScopedWeeklyLimits: true,
  };
  let overlayOverrides = {};
  let activeView = persistedState.activeView || window.__INITIAL_ACTIVE_VIEW__ || 'current-session';
  const FIVE_HOUR_MS = 5 * 3_600_000;
  const SEVEN_DAY_MS = 7 * 86_400_000;
  const FORECAST_SAMPLE_STEPS = 24;
  const FALLBACK_VIEW = 'range:3600000';

  function persistActiveView() {
    persistedState = { ...persistedState, activeView };
    vscode.setState(persistedState);
    vscode.postMessage({ type: 'activeView', value: activeView });
  }

  const BASE_DATASETS = [
    { key: 'five_hour',      resetKey: 'five_hour_resets_at', label: 'Session 5h',    yAxisID: 'yPct',     borderColor: '#4EC9B0', backgroundColor: '#4EC9B022' },
    { key: 'seven_day',      resetKey: 'seven_day_resets_at', label: 'Weekly 7d',     yAxisID: 'yPct',     borderColor: '#569CD6', backgroundColor: '#569CD622' },
    { key: 'extra_used',     resetKey: null,                  label: 'Extra credits', yAxisID: 'yCredits', borderColor: '#CE9178', backgroundColor: '#CE917822' },
  ];
  const SCOPED_COLORS = ['#C586C0', '#DCDCAA', '#9CDCFE', '#D16969', '#B5CEA8', '#CE9178'];

  const historyOverlayPlugin = {
    id: 'historyOverlays',
    afterEvent(chart, args) {
      const xScale = chart.scales.x;
      const eventX = args.event?.x;
      if (!xScale || typeof eventX !== 'number') return;

      const latestRealX = chart.data.datasets
        .filter(dataset => !dataset.forecastKind)
        .flatMap(dataset => dataset.data)
        .reduce((latest, point) => {
          if (!point || typeof point.x !== 'number' || point.y == null) return latest;
          return Math.max(latest, point.x);
        }, Number.NEGATIVE_INFINITY);

      if (!Number.isFinite(latestRealX) || eventX <= xScale.getPixelForValue(latestRealX)) return;

      // Suppress tooltip snapping in future blank space.
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      args.changed = true;
    },
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
        drawVerticalMarkers(ctx, xScale, chartArea, overlayState.sessionResets, '#4EC9B0CC', [2, 3]);
      }
      if (overlayState.showWeeklyResetMarkers) {
        drawVerticalMarkers(ctx, xScale, chartArea, overlayState.weeklyResets, '#569CD688', [8, 4]);
      }
      if (overlayState.showWeeklyForecast && overlayState.weeklyForecast) {
        drawForecastLabel(ctx, xScale, yScale, chartArea, overlayState.weeklyForecast.projectedEnd, overlayState.weeklyForecast.projectedLabel, overlayState.weeklyForecast.warning ? warnFg : forecastSafeFg);
        if (overlayState.weeklyForecast.hitPoint) {
          drawForecastLabel(ctx, xScale, yScale, chartArea, overlayState.weeklyForecast.hitPoint, 'limit hit', warnFg);
        }
      }

      ctx.restore();
    },
  };

  // Custom interaction mode: for each base (non-forecast) dataset find the element
  // nearest to the cursor x-position independently. The built-in 'index' mode finds
  // the globally-nearest element and then looks up that ARRAY INDEX in every other
  // dataset, which goes wrong when datasets have different lengths (e.g., forecast
  // lines have only 25 sampled points while session data has 100+, so forecast
  // index 22 maps to a completely different timestamp in the session dataset).
  Chart.Interaction.modes.nearestPerDataset = function(chart, e, _options, useFinalPosition) {
    if (e.x === null) return [];
    const cursorX = e.x;
    const items = [];
    chart.getSortedVisibleDatasetMetas().forEach(meta => {
      if (chart.data.datasets[meta.index]?.forecastKind) return;
      let minDist = Infinity;
      let best = null;
      meta.data.forEach((element, index) => {
        if (!element || element.skip) return;
        const center = element.getCenterPoint(useFinalPosition);
        if (!Number.isFinite(center.y)) return;
        const dist = Math.abs(center.x - cursorX);
        if (dist < minDist) { minDist = dist; best = { element, datasetIndex: meta.index, index }; }
      });
      if (best) items.push(best);
    });
    return items;
  };

  // Tooltip positioner that averages only elements whose canvas x falls inside the
  // chart area, as a safety net against off-canvas points skewing the position.
  Chart.Tooltip.positioners.clampedAverage = function(items) {
    const { left, right } = this.chart.chartArea;
    const visible = items.filter(item => {
      const x = item.element.x;
      return Number.isFinite(x) && x >= left && x <= right;
    });
    if (!visible.length) return false;
    return {
      x: visible.reduce((s, i) => s + i.element.x, 0) / visible.length,
      y: visible.reduce((s, i) => s + i.element.y, 0) / visible.length,
    };
  };

  const ctx = document.getElementById('chart').getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    plugins: [historyOverlayPlugin],
    data: {
      labels: [],
      datasets: [],
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
          mode: 'nearestPerDataset',
          intersect: false,
          position: 'clampedAverage',
          callbacks: {
            title: (items) => items.length ? formatTs(items[0].parsed.x) : '',
            label: (item) => {
              if (item.dataset.yAxisID === 'yCredits') {
                return `${item.dataset.label}: ${item.parsed.y}`;
              }
              return `${item.dataset.label}: ${item.parsed.y.toFixed(1)}% ${showUsed ? 'used' : 'remaining'}`;
            },
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
    const method = forecast.method === 'personalized'
      ? `Personalized (${forecast.historyWeeks} week${forecast.historyWeeks === 1 ? '' : 's'}${forecast.historyBlend < 1 ? ' + baseline' : ''})`
      : 'Baseline';
    if (forecast.projectedLimitHitAt !== null) {
      const hitText = formatDuration(forecast.projectedLimitHitAt, now);
      return {
        text: `Weekly forecast: Limit in ${hitText} · ${method}`,
        warning: true,
      };
    }

    const projectedValue = showUsed ? forecast.projectedUtilizationAtReset : forecast.projectedRemainingAtReset;
    return {
      text: showUsed
        ? `Weekly forecast: ${projectedValue.toFixed(1)}% used at reset · ${method}`
        : `Weekly forecast: ${projectedValue.toFixed(1)}% remaining at reset · ${method}`,
      warning: false,
    };
  }

  function sampleLinePoints(x1, y1, x2, y2, steps = FORECAST_SAMPLE_STEPS) {
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      points.push({
        x: x1 + (x2 - x1) * t,
        y: y1 + (y2 - y1) * t,
      });
    }
    return points;
  }

  function buildBaseDatasets(entries) {
    return BASE_DATASETS.map(d => {
      const data = [];
      let prevNonNullReset = null;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const currReset = d.resetKey ? parseIsoTime(e[d.resetKey]) : null;
        if (d.resetKey && currReset !== null) {
          // Insert a break when the reset time shifts by more than 1 minute (a real period boundary).
          // Using prevNonNullReset instead of entries[i-1] so idle entries (null resets_at) don't
          // interfere with boundary detection, and a 60s tolerance absorbs sub-second API jitter.
          if (prevNonNullReset !== null && Math.abs(prevNonNullReset - currReset) > 60_000) {
            data.push({ x: prevNonNullReset, y: null });
          }
          prevNonNullReset = currReset;
        }
        const noActiveWindow = d.resetKey && currReset === null;
        if (noActiveWindow) {
          if (d.key === 'five_hour') {
            // Session dataset: explicit null so the green line gaps during idle.
            data.push({ x: e.timestamp, y: null });
          }
          // Weekly datasets: skip idle entries entirely so Chart.js interpolates across the
          // gap rather than breaking the line within the same weekly period.
          continue;
        }
        const v = e[d.key];
        let y;
        if (d.yAxisID === 'yPct' && v !== null) {
          y = showUsed ? v : 100 - v;
        } else {
          y = v;
        }
        data.push({ x: e.timestamp, y });
      }
      return {
        label: d.label,
        data,
        yAxisID: d.yAxisID,
        borderColor: d.borderColor,
        backgroundColor: d.backgroundColor,
        borderWidth: 1.5,
        pointRadius: 2,
        tension: 0.3,
        fill: false,
        spanGaps: false,
        order: 10,
      };
    });
  }

  function scopedIdentity(scoped) {
    return scoped.model_id ? `id:${scoped.model_id}` : `name:${scoped.display_name}`;
  }

  function scopedColor(identity) {
    let hash = 0;
    for (let i = 0; i < identity.length; i += 1) hash = ((hash * 31) + identity.charCodeAt(i)) >>> 0;
    return SCOPED_COLORS[hash % SCOPED_COLORS.length];
  }

  function buildScopedDatasets(entries) {
    const models = new Map();
    for (const entry of entries) {
      for (const scoped of entry.scoped_weekly ?? []) {
        models.set(scopedIdentity(scoped), scoped.display_name);
      }
    }

    return [...models.entries()].map(([identity, displayName]) => {
      const data = [];
      let prevNonNullReset = null;
      for (const entry of entries) {
        const scoped = (entry.scoped_weekly ?? []).find(item => scopedIdentity(item) === identity);
        if (!scoped) continue;
        const currReset = parseIsoTime(scoped.resets_at);
        if (currReset !== null) {
          if (prevNonNullReset !== null && Math.abs(prevNonNullReset - currReset) > 60_000) {
            data.push({ x: prevNonNullReset, y: null });
          }
          prevNonNullReset = currReset;
        }
        data.push({ x: entry.timestamp, y: showUsed ? scoped.percent : 100 - scoped.percent });
      }
      const color = scopedColor(identity);
      return {
        label: `${displayName} 7d`,
        data,
        yAxisID: 'yPct',
        borderColor: color,
        backgroundColor: `${color}22`,
        borderWidth: 1.5,
        pointRadius: 2,
        tension: 0.3,
        fill: false,
        spanGaps: false,
        order: 10,
      };
    });
  }

  function buildForecastDatasets(forecast) {
    if (!forecast) return [];

    const projectionColor = forecast.projectedLimitHitAt !== null ? warnFg : forecastSafeFg;
    const idealData = sampleLinePoints(
      forecast.start,
      toDisplayPct(0),
      forecast.reset,
      toDisplayPct(100),
    );
    const projectionData = sampleLinePoints(
      forecast.calculatedAt,
      toDisplayPct(forecast.currentUtilization),
      forecast.reset,
      toDisplayPct(forecast.projectedUtilizationAtReset),
    );

    const datasets = [
      {
        label: 'Ideal weekly pace',
        data: idealData,
        yAxisID: 'yPct',
        borderColor: paceFg,
        backgroundColor: paceFg,
        borderWidth: 1.5,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 6,
        tension: 0,
        fill: false,
        order: 90,
        forecastKind: 'pace',
      },
      {
        label: 'Weekly projection',
        data: projectionData,
        yAxisID: 'yPct',
        borderColor: projectionColor,
        backgroundColor: projectionColor,
        borderWidth: 2,
        pointRadius: (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 3.5 : 0,
        pointHoverRadius: (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 5 : 0,
        pointHitRadius: 6,
        tension: 0,
        fill: false,
        order: 91,
        forecastKind: 'projection',
      },
    ];

    if (forecast.projectedLimitHitAt !== null) {
      datasets.push({
        label: 'Projected early limit hit',
        data: [{ x: forecast.projectedLimitHitAt, y: toDisplayPct(100) }],
        yAxisID: 'yPct',
        showLine: false,
        borderColor: warnFg,
        backgroundColor: warnFg,
        pointRadius: 4,
        pointHoverRadius: 5,
        pointHitRadius: 8,
        order: 92,
        forecastKind: 'hit',
      });
    }

    return datasets;
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
      persistActiveView();
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

  function drawForecastLabel(ctx, xScale, yScale, chartArea, point, label, color) {
    const x = xScale.getPixelForValue(point.x);
    const y = yScale.getPixelForValue(point.y);
    const offsetX = x > chartArea.left + (chartArea.right - chartArea.left) * 0.7 ? -6 : 6;
    const align = offsetX < 0 ? 'right' : 'left';
    const labelY = Math.max(chartArea.top + 10, Math.min(chartArea.bottom - 6, y - 8));

    ctx.save();
    ctx.fillStyle = color;
    ctx.font = '11px sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + offsetX, labelY);
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

    chart.options.scales.x.min = viewport.start;
    chart.options.scales.x.max = viewport.end;

    chart.options.scales.yPct.title.text = showUsed ? '% used' : '% remaining';

    const latestLimit = [...allEntries].reverse().find(e => e.extra_limit !== null)?.extra_limit;
    if (latestLimit != null) chart.options.scales.yCredits.max = latestLimit;

    const showWeeklyForecast = getEffectiveSetting('showWeeklyForecast');
    chart.data.labels = [];
    chart.data.datasets = [
      ...buildBaseDatasets(filtered),
      ...(overlayDefaults.showScopedWeeklyLimits ? buildScopedDatasets(filtered) : []),
      ...buildForecastDatasets(showWeeklyForecast ? weeklyForecast : null),
    ];
    chart.options.plugins.historyOverlays = {
      showSessionResetMarkers: getEffectiveSetting('showSessionResetMarkers'),
      showWeeklyResetMarkers: getEffectiveSetting('showWeeklyResetMarkers'),
      showWeeklyForecast,
      sessionStarts: getDistinctMarkers(allEntries, entry => {
        const resetAt = parseIsoTime(entry.five_hour_resets_at);
        return resetAt === null ? null : resetAt - FIVE_HOUR_MS;
      }),
      sessionResets: getDistinctMarkers(allEntries, entry => parseIsoTime(entry.five_hour_resets_at)),
      weeklyResets: getDistinctMarkers(allEntries, entry => parseIsoTime(entry.seven_day_resets_at)),
      weeklyForecast: showWeeklyForecast && weeklyForecast
        ? {
            warning: weeklyForecast.projectedLimitHitAt !== null,
            projectedEnd: {
              x: weeklyForecast.reset,
              y: toDisplayPct(weeklyForecast.projectedUtilizationAtReset),
            },
            projectedLabel: showUsed
              ? `${Math.max(0, weeklyForecast.projectedUtilizationAtReset).toFixed(0)}% used`
              : `${Math.max(0, weeklyForecast.projectedRemainingAtReset).toFixed(0)}% left`,
            hitPoint: weeklyForecast.projectedLimitHitAt !== null
              ? {
                  x: weeklyForecast.projectedLimitHitAt,
                  y: toDisplayPct(100),
                }
              : null,
          }
        : null,
    };

    chart.update('none');

    const last = allEntries.length > 0 ? allEntries[allEntries.length - 1].timestamp : null;
    document.getElementById('last-updated').textContent = last ? formatTs(last) : '—';
    const summary = buildForecastSummary(weeklyForecast, now);
    const summaryEl = document.getElementById('forecast-summary');
    summaryEl.textContent = summary.text;
    summaryEl.classList.toggle('safe', !summary.warning && weeklyForecast !== null);
    summaryEl.classList.toggle('warning', summary.warning);
  }

  document.getElementById('range-controls').addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    if (btn.disabled) return;
    activeView = btn.dataset.view;
    persistActiveView();
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
      weeklyForecast = e.data.forecast ?? null;
      setToggleState();
      render();
    }
  });

  setToggleState();
  render();

  // Signal to the extension that the webview is ready to receive messages.
  // This handles the race where postMessage is called before the JS listener
  // is registered, which would silently drop the message.
  vscode.postMessage({ type: 'ready' });
})();
