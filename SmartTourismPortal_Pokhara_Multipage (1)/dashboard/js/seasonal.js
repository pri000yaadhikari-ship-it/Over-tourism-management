/* ============================================================
   POKHARA SMART TOURISM DASHBOARD — seasonal.js
   Seasonal/monthly visitor-volume dropdown + circle-marker
   intensity overlay + Chart.js monthly visitor charts
   ============================================================
   HOW IT PLUGS IN:
     • Loaded AFTER crowding.js in index.html
     • Reads feature.props.tourism_data.seasonal (see crowding.js
       header for the shared tourism_data contract)
     • Mounts its dropdown UI into #seasonal-filter-mount (declared
       in index.html, right after the category filter chips)
     • Adds an L.circleMarker OVERLAY layer (STATE.seasonalLayer) —
       this sits alongside the existing icon markers rather than
       replacing them, so popups, routing's "Route Here", and
       crowding's capacity rings all keep working untouched.
       The overlay is shown only while a season/month is selected;
       icon markers dim underneath it so the circle layer reads
       as the primary signal.
   ============================================================
   DATA CONTRACT (inside tourism_data, unchanged from before):

   "seasonal": {
     "2026": {
       "01": 4200, "02": 4800, ... "12": 6400
     }
   }

   Keys are zero-padded month strings so chart rendering and
   month-lookups can use them directly without re-formatting.
   ============================================================ */

'use strict';

const SEASON_MONTHS = {
  spring: ['03', '04', '05'],
  summer: ['06', '07', '08'],
  autumn: ['09', '10', '11'],
  winter: ['12', '01', '02'],
};

const MONTH_NAMES = {
  '01':'January','02':'February','03':'March','04':'April',
  '05':'May','06':'June','07':'July','08':'August',
  '09':'September','10':'October','11':'November','12':'December',
};

const seasonalModule = (() => {

  let _activeFilter   = null; // { type:'season'|'month', value:'summer'|'06' } | null
  let _chartInstances = new Map(); // popup element → Chart.js instance, for cleanup
  let _circleLayer    = null; // L.layerGroup of L.circleMarker, the volume overlay
  let _maxObservedAvg = 8000; // running scale ceiling, recalculated per filter for better contrast

  /* ── Build the dropdown UI, mounted into #seasonal-filter-mount ── */
  function init() {
    const mount = document.getElementById('seasonal-filter-mount');
    if (!mount) return;

    mount.innerHTML = `
      <div class="seasonal-control-row">
        <select id="seasonal-select" class="seasonal-select">
          <option value="">All year (no filter)</option>
          <optgroup label="Season">
            <option value="season:spring">🌸 Spring (Mar–May)</option>
            <option value="season:summer">☀️ Summer (Jun–Aug)</option>
            <option value="season:autumn">🍂 Autumn (Sep–Nov)</option>
            <option value="season:winter">❄️ Winter (Dec–Feb)</option>
          </optgroup>
          <optgroup label="Month">
            ${Object.entries(MONTH_NAMES).map(([num, name]) =>
              `<option value="month:${num}">${name}</option>`).join('')}
          </optgroup>
        </select>
        <div class="seasonal-legend">
          <span>Low</span>
          <span class="seasonal-legend-grad"></span>
          <span>High</span>
        </div>
      </div>`;

    document.getElementById('seasonal-select').addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) { setFilter(null); return; }
      const [type, value] = val.split(':');
      setFilter({ type, value });
    });
  }

  /* ── Resolve a feature's average monthly visits for the active filter ── */
  function resolveAverage(feature, filter) {
    const seasonal = feature.props?.tourism_data?.seasonal;
    if (!seasonal) return null;
    const years = Object.keys(seasonal);
    if (!years.length) return null;

    const months = filter.type === 'season' ? SEASON_MONTHS[filter.value] : [filter.value];

    let total = 0, count = 0;
    years.forEach(y => {
      months.forEach(m => {
        const v = seasonal[y]?.[m];
        if (typeof v === 'number') { total += v; count++; }
      });
    });
    return count ? Math.round(total / count) : null;
  }

  /* Backward-compatible alias (used in chat history / older call sites) */
  function seasonAverage(feature, season) {
    return resolveAverage(feature, { type: 'season', value: season });
  }

  /* ── Build/refresh the circleMarker overlay for the active filter ──
     Radius AND color both encode volume (redundant encoding is
     intentional — color can be ambiguous for color-blind users,
     radius alone is harder to compare at a glance; together they
     reinforce each other). Features without seasonal data get a
     small flat gray dot instead of being hidden, per the
     "graceful missing data" requirement. ── */
  function renderCircleLayer(filter) {
    if (_circleLayer) STATE.map.removeLayer(_circleLayer);
    _circleLayer = L.layerGroup();

    const visible = STATE.allFeatures.filter(f => STATE.activeCats.has(f.cat));
    const averages = visible.map(f => resolveAverage(f, filter)).filter(v => v !== null);
    _maxObservedAvg = averages.length ? Math.max(...averages) : 8000;

    visible.forEach(f => {
      const avg = resolveAverage(f, filter);
      const hasData = avg !== null;
      const intensity = hasData ? Math.min(avg / _maxObservedAvg, 1) : 0;

      const radius = hasData ? 6 + intensity * 18 : 4;       // 6–24px scaled by volume
      const color  = hasData ? intensityColor(intensity) : '#5C7A99';
      const fillOpacity = hasData ? 0.35 + intensity * 0.35 : 0.15;

      const circle = L.circleMarker(f.latlng, {
        radius,
        color,
        weight: hasData ? 1.5 : 1,
        fillColor: color,
        fillOpacity,
        opacity: hasData ? 0.9 : 0.4,
      });

      const label = filter.type === 'season'
        ? `${filter.value[0].toUpperCase()}${filter.value.slice(1)}`
        : MONTH_NAMES[filter.value];
      circle.bindTooltip(
        hasData
          ? `<strong>${f.name}</strong><br>${label} avg: ~${avg.toLocaleString()} visitors/mo`
          : `<strong>${f.name}</strong><br>No ${label.toLowerCase()} data yet`,
        { direction: 'top', offset: [0, -4] }
      );

      _circleLayer.addLayer(circle);
    });

    _circleLayer.addTo(STATE.map);
  }

  /* Blue (low) → cyan → amber → red (high), matching the heatmap gradient */
  function intensityColor(t) {
    const stops = [
      [0.00, [21,101,192]],
      [0.40, [0,229,255]],
      [0.65, [255,213,79]],
      [1.00, [255,82,82]],
    ];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i-1], [t1, c1] = stops[i];
        const f = (t - t0) / (t1 - t0 || 1);
        const c = c0.map((v, idx) => Math.round(v + (c1[idx]-v) * f));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
      }
    }
    return 'rgb(255,82,82)';
  }

  /* ── Apply filter: dim icon markers underneath, show circle overlay ── */
  function setFilter(filter) {
    _activeFilter = filter;

    STATE.allFeatures.forEach(f => {
      const marker = f.marker;
      const el = marker?.getElement?.();
      const inner = el?.querySelector('div');
      if (!inner) return;
      inner.style.opacity = filter ? '0.25' : '1';
      inner.style.filter  = filter ? 'grayscale(40%)' : 'none';
    });

    if (filter) {
      renderCircleLayer(filter);
    } else if (_circleLayer) {
      STATE.map.removeLayer(_circleLayer);
      _circleLayer = null;
    }

    if (typeof heatmapModule !== 'undefined') heatmapModule.refresh();

    const label = filter
      ? (filter.type === 'season' ? filter.value : MONTH_NAMES[filter.value])
      : null;
    showToast(filter ? `📊 Showing visitor volume: ${label}` : '📊 Showing all-year data');
  }

  /* Re-render the circle layer in place (e.g. after a category toggle) */
  function refresh() {
    if (_activeFilter) renderCircleLayer(_activeFilter);
  }

  /* ── Chart.js mini chart, rendered into a popup after open ── */
  function renderPopupChart(popupEl, feature) {
    const seasonal = feature.props?.tourism_data?.seasonal;
    if (!seasonal) return; // graceful: no chart if no data

    const years = Object.keys(seasonal).sort();
    const latestYear = years[years.length - 1];
    const monthData = seasonal[latestYear];
    if (!monthData) return;

    const labels = ['01','02','03','04','05','06','07','08','09','10','11','12'];
    const labelNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const values = labels.map(m => monthData[m] ?? null);

    const container = popupEl.querySelector('.popup-inner');
    if (!container) return;

    const chartWrap = document.createElement('div');
    chartWrap.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08)';
    chartWrap.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">📈 ${latestYear} monthly visitors</div>
      <canvas width="260" height="110"></canvas>`;
    container.appendChild(chartWrap);

    const canvas = chartWrap.querySelector('canvas');
    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labelNames,
        datasets: [{
          data: values,
          borderColor: '#00B0FF',
          backgroundColor: 'rgba(0,176,255,0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          spanGaps: true, // gracefully bridges missing months
        }],
      },
      options: {
        responsive: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#90CAF9', font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: '#90CAF9', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
    });

    _chartInstances.set(popupEl, chart);
  }

  function destroyPopupChart(popupEl) {
    const chart = _chartInstances.get(popupEl);
    if (chart) { chart.destroy(); _chartInstances.delete(popupEl); }
  }

  function getActiveFilter() { return _activeFilter; }

  return {
    init, setFilter, refresh, resolveAverage, seasonAverage,
    renderPopupChart, destroyPopupChart, getActiveFilter,
  };
})();
