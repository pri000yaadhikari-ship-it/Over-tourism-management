/* ============================================================
   POKHARA SMART TOURISM DASHBOARD — crowding.js
   Capacity Status (Red/Yellow/Green) + Smart Suggestions +
   Predictive Peak Hours
   ============================================================
   HOW IT PLUGS IN:
     • Loaded AFTER app.js, AFTER heatmap.js in index.html
     • Reads/extends STATE.allFeatures (each entry already has
       .props, which may contain .tourism_data)
     • Patches buildPopup() output via a popup post-processor
       instead of rewriting buildPopup() itself, so app.js's
       existing popup HTML stays the single source of truth
     • Patches makeMarker() rendering via a thin marker-decorator
       called right after marker creation in loadOverallData()
   ============================================================
   DATA CONTRACT (extends overalldata.geojson properties):

   "tourism_data": {
     "capacity_status": "red" | "yellow" | "green",   // optional
     "current_load_pct": 0-100,                        // optional
     "capacity_max": 400,                               // optional
     "capacity_updated": "2026-06-20T08:15:00+05:45",   // optional
     "alternatives": ["feature_id_or_name", ...],        // optional
     "peak_hours": {                                     // optional
       "weekday": [[6,8],[16,18]],
       "weekend": [[5,9],[15,19]]
     },
     "predicted_peak_today": "16:00-18:00"               // optional
   }

   Every key is OPTIONAL. Missing tourism_data → feature is
   rendered exactly as before (no badge, no suggestions block).
   This is the "graceful missing-data" contract referenced in
   the roadmap section of the response.
   ============================================================ */

'use strict';

const crowdingModule = (() => {

  const STATUS_COLOR = {
    red:    '#FF5252',
    yellow: '#FFD54F',
    green:  '#00E676',
  };
  const STATUS_LABEL = {
    red:    'Crowded',
    yellow: 'Moderate',
    green:  'Quiet',
  };

  /* ── Derive a status if the source only gives current_load_pct ── */
  function resolveStatus(td) {
    if (!td) return null;
    if (td.capacity_status) return td.capacity_status;
    if (typeof td.current_load_pct === 'number') {
      if (td.current_load_pct >= 80) return 'red';
      if (td.current_load_pct >= 45) return 'yellow';
      return 'green';
    }
    return null;
  }

  /* ── Predictive peak hours: derive "is it peak right now" ──
     Pure client-side heuristic from the peak_hours ranges —
     no ML needed for a v1; swap for a real model later by
     replacing this one function.

     IMPORTANT: peak_hours are authored in Nepal Time (NPT,
     UTC+5:45). We must NOT use the visitor's browser-local
     getHours()/getDay() — a tourist viewing the dashboard from
     outside Nepal would get a shifted, wrong peak/off-peak read.
     We derive Nepal wall-clock time from the UTC timestamp
     instead, regardless of where the browser is. ── */
  function nepalNow(now) {
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const npt = new Date(utcMs + (5 * 60 + 45) * 60000);
    return { hour: npt.getUTCHours() + npt.getUTCMinutes() / 60, day: npt.getUTCDay() };
  }

  function isCurrentlyPeak(td, now = new Date()) {
    if (!td?.peak_hours) return null;
    const { hour, day } = nepalNow(now);
    const isWeekend = day === 0 || day === 6;
    const ranges = isWeekend ? td.peak_hours.weekend : td.peak_hours.weekday;
    if (!ranges) return null;
    return ranges.some(([start, end]) => hour >= start && hour < end);
  }

  /* ── Smart Suggestions: resolve alternative IDs/names to live
     STATE.allFeatures entries, ranked by lowest current load ── */
  function getSuggestions(feature, maxResults = 3) {
    const td = feature.props?.tourism_data;
    if (!td?.alternatives?.length) return [];

    const byName = new Map(STATE.allFeatures.map(f => [f.name, f]));
    const resolved = td.alternatives
      .map(refName => byName.get(refName))
      .filter(Boolean);

    return resolved
      .sort((a, b) => {
        const la = a.props?.tourism_data?.current_load_pct ?? 50;
        const lb = b.props?.tourism_data?.current_load_pct ?? 50;
        return la - lb;
      })
      .slice(0, maxResults);
  }

  /* ── Marker decoration: small colored ring + pulse on red ── */
  function decorateMarker(markerDivEl, feature) {
    const td = feature.props?.tourism_data;
    const status = resolveStatus(td);
    if (!status) return; // no data → leave marker untouched

    const ring = document.createElement('div');
    ring.className = 'capacity-ring' + (status === 'red' ? ' capacity-pulse' : '');
    ring.style.cssText = `
      position:absolute; top:-3px; right:-3px;
      width:11px; height:11px; border-radius:50%;
      background:${STATUS_COLOR[status]};
      border:1.5px solid rgba(10,20,40,0.9);
      box-shadow:0 0 6px ${STATUS_COLOR[status]}aa;
    `;
    markerDivEl.style.position = 'relative';
    markerDivEl.appendChild(ring);
  }

  /* ── Popup augmentation: capacity row + suggestions block ──
     Appended into the existing .popup-actions container so we
     don't touch buildPopup()'s template string in app.js. ── */
  function augmentPopup(popupEl, feature) {
    const td = feature.props?.tourism_data;
    const status = resolveStatus(td);
    const peakNow = isCurrentlyPeak(td);
    const suggestions = getSuggestions(feature);

    if (!status && !td?.predicted_peak_today && !suggestions.length) return;

    const block = document.createElement('div');
    block.className = 'crowding-block';
    block.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08)';

    let html = '';

    if (status) {
      const pct = typeof td.current_load_pct === 'number' ? ` · ${td.current_load_pct}% full` : '';
      html += `
        <div class="popup-row" style="align-items:center">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${STATUS_COLOR[status]};margin-right:6px"></span>
          <span style="font-weight:600;color:${STATUS_COLOR[status]}">${STATUS_LABEL[status]}</span>
          <span style="color:var(--text-dim);font-size:11px;margin-left:4px">${pct}</span>
        </div>`;
    }

    if (peakNow) {
      html += `<div class="popup-row" style="color:#FFD54F;font-size:11px">⚠️ Currently in predicted peak hours</div>`;
    } else if (td?.predicted_peak_today) {
      html += `<div class="popup-row" style="color:var(--text-dim);font-size:11px">⏰ Today's peak: ${td.predicted_peak_today}</div>`;
    }

    if (suggestions.length && (status === 'red' || status === 'yellow')) {
      html += `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;margin-bottom:4px">💡 Try instead:</div>`;
      html += suggestions.map(s => {
        const sStatus = resolveStatus(s.props?.tourism_data) || 'green';
        return `<div class="popup-btn suggestion-link" data-lat="${s.latlng[0]}" data-lng="${s.latlng[1]}" data-name="${s.name}"
                   style="display:flex;align-items:center;gap:6px;justify-content:flex-start;margin-bottom:4px">
                  <span style="width:7px;height:7px;border-radius:50%;background:${STATUS_COLOR[sStatus]};flex-shrink:0"></span>
                  ${s.name}
                </div>`;
      }).join('');
    }

    block.innerHTML = html;
    popupEl.querySelector('.popup-inner')?.appendChild(block);

    // wire suggestion clicks → fly to + open that marker's popup
    popupEl.querySelectorAll('.suggestion-link').forEach(el => {
      el.addEventListener('click', () => {
        const lat = +el.dataset.lat, lng = +el.dataset.lng;
        STATE.map.flyTo([lat, lng], 17, { animate: true, duration: 1 });
        showToast(`📍 Suggested: ${el.dataset.name}`);
      });
    });
  }

  return { resolveStatus, isCurrentlyPeak, getSuggestions, decorateMarker, augmentPopup, STATUS_COLOR, STATUS_LABEL };
})();
