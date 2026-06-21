/* ============================================================
   POKHARA SMART TOURISM DASHBOARD — heatmap.js
   Leaflet.heat density layer, driven by tourism_data.current_load_pct
   ============================================================
   HOW IT PLUGS IN:
     • Loaded AFTER app.js, BEFORE crowding.js in index.html
     • Reads STATE.map and STATE.allFeatures from app.js
     • Replaces the old canvas-based renderHeatmap()/toggleHeatmap()
       in app.js — those two functions should be deleted, and the
       #btn-heatmap listener in app.js's boot block should call
       heatmapModule.toggle instead (see index.html wiring note below).
   ============================================================ */

'use strict';

const heatmapModule = (() => {

  let _layer = null;
  let _active = false;

  /* Weight a feature 0–1 for the heat layer.
     Falls back to a flat weight so heat still renders before
     crowding data exists for every POI (graceful degradation). */
  function weightOf(feature) {
    const load = feature.props?.tourism_data?.current_load_pct;
    if (typeof load === 'number' && !isNaN(load)) {
      return Math.min(Math.max(load / 100, 0.1), 1);
    }
    return 0.35; // default weight, keeps unscored POIs visible but muted
  }

  function buildPoints() {
    return STATE.allFeatures
      .filter(f => STATE.activeCats.has(f.cat))
      .map(f => [f.latlng[0], f.latlng[1], weightOf(f)]);
  }

  function render() {
    if (_layer) STATE.map.removeLayer(_layer);
    _layer = L.heatLayer(buildPoints(), {
      radius: 28,
      blur: 22,
      maxZoom: 17,
      minOpacity: 0.25,
      gradient: {
        0.2: '#1565C0',
        0.4: '#00E5FF',
        0.6: '#FFD54F',
        0.8: '#FF9800',
        1.0: '#FF5252',
      },
    });
    if (_active) _layer.addTo(STATE.map);
  }

  function toggle() {
    _active = !_active;
    const btn = document.getElementById('btn-heatmap');
    if (btn) btn.classList.toggle('active', _active);

    if (_active) {
      render();
      showToast('🔥 Heatmap ON');
    } else {
      if (_layer) STATE.map.removeLayer(_layer);
      showToast('🔥 Heatmap OFF');
    }
  }

  /* Call this whenever STATE.activeCats changes (category toggle,
     seasonal filter, etc.) so the heat layer stays in sync. */
  function refresh() {
    if (_active) render();
  }

  function isActive() { return _active; }

  return { toggle, refresh, isActive };
})();
