/* ============================================================
   POKHARA SMART TOURISM DASHBOARD — routing.js
   Leaflet Routing Machine + Haversine Nearest-Site Finder
   ============================================================
   HOW IT PLUGS IN:
     • Loaded AFTER app.js in index.html
     • Reads STATE.map and STATE.allFeatures from app.js
     • Exposes: routingModule  (used by HTML buttons/events)
   ============================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   1.  HAVERSINE DISTANCE FORMULA
   Returns distance in kilometres between two [lat, lng] pairs.
   Earth radius = 6371 km.
   ────────────────────────────────────────────────────────────── */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R   = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ──────────────────────────────────────────────────────────────
   2.  NEAREST SITES FINDER
   Iterates every feature in STATE.allFeatures, computes the
   haversine distance from userLat/userLng, optionally filters
   by category, and returns the top-N results sorted ascending.

   @param {number}   userLat   – user latitude
   @param {number}   userLng   – user longitude
   @param {object}   options
     @param {string|null}  options.category  – restrict to one cat  (null = all)
     @param {number}       options.topN       – how many to return   (default 5)
     @param {number}       options.radiusKm   – max distance filter  (default Infinity)
   @returns {Array<{feature, distanceKm, rank}>}
   ────────────────────────────────────────────────────────────── */
function findNearestSites(userLat, userLng, options = {}) {
  const { category = null, topN = 5, radiusKm = Infinity } = options;

  // Filter features by active category (if specified)
  const pool = STATE.allFeatures.filter(f =>
    (category === null || f.cat === category) &&
    STATE.activeCats.has(f.cat)               // respect current layer visibility
  );

  // Compute haversine distance for every candidate
  const scored = pool.map(feature => ({
    feature,
    distanceKm: haversineKm(userLat, userLng, feature.latlng[0], feature.latlng[1]),
  }));

  // Sort ascending, apply radius cap, take top-N
  const results = scored
    .filter(r => r.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, topN)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return results;
}

/* ──────────────────────────────────────────────────────────────
   3.  ROUTING MODULE
   Wraps Leaflet Routing Machine (LRM).
   ────────────────────────────────────────────────────────────── */
const routingModule = (() => {

  /* ── Private state ──────────────────────────────────────── */
  let _userLatLng     = null;   // L.LatLng – live user position
  let _userMarker     = null;   // blue pulsing dot
  let _userCircle     = null;   // accuracy ring
  let _lrmControl     = null;   // active LRM control
  let _nearestMarkers = [];     // highlighted nearest markers
  let _nearestPanel   = null;   // sidebar results list element
  let _watchId        = null;   // geolocation watchId

  /* ── User-location marker factory ───────────────────────── */
  function _makeUserMarker(latlng) {
    return L.marker(latlng, {
      icon: L.divIcon({
        className: '',
        iconSize:   [22, 22],
        iconAnchor: [11, 11],
        html: `
          <div style="
            width:22px;height:22px;border-radius:50%;
            background:rgba(0,229,255,0.25);
            border:2.5px solid #00E5FF;
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 0 0 6px rgba(0,229,255,0.15),0 0 16px #00E5FF88">
            <div style="
              width:8px;height:8px;border-radius:50%;
              background:#00E5FF;
              animation:userPulse 1.6s ease-in-out infinite">
            </div>
          </div>
          <style>
            @keyframes userPulse{0%,100%{opacity:1;transform:scale(1)}
              50%{opacity:0.5;transform:scale(0.6)}}
          </style>`,
      }),
      zIndexOffset: 1000,
    }).bindPopup('<div class="popup-inner"><div class="popup-name">📍 Your Location</div></div>');
  }

  /* ── Destination marker factory ─────────────────────────── */
  function _makeDestMarker(latlng, label) {
    return L.marker(latlng, {
      icon: L.divIcon({
        className: '',
        iconSize:   [34, 44],
        iconAnchor: [17, 44],
        html: `
          <div style="
            width:34px;height:34px;border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            background:linear-gradient(135deg,#FF6B35,#FF3A8C);
            border:2px solid white;
            box-shadow:0 4px 14px rgba(255,60,120,0.55)">
            <span style="
              display:block;transform:rotate(45deg);
              text-align:center;line-height:30px;font-size:15px">🎯</span>
          </div>`,
      }),
      zIndexOffset: 900,
    }).bindPopup(`<div class="popup-inner"><div class="popup-name">🎯 ${label}</div></div>`);
  }

  /* ── Nearest-site highlight marker ──────────────────────── */
  function _makeNearestMarker(feat, rank, distKm) {
    const cfg = CAT_CONFIG[feat.cat];
    return L.marker(feat.latlng, {
      icon: L.divIcon({
        className: '',
        iconSize:   [36, 36],
        iconAnchor: [18, 18],
        html: `
          <div style="
            width:36px;height:36px;border-radius:50%;
            background:${cfg.color}33;
            border:2.5px solid ${cfg.color};
            display:flex;align-items:center;justify-content:center;
            font-size:15px;position:relative;
            box-shadow:0 0 12px ${cfg.color}88,0 2px 8px #000a">
            ${cfg.icon}
            <span style="
              position:absolute;top:-7px;right:-7px;
              width:17px;height:17px;border-radius:50%;
              background:${cfg.color};color:#000;
              font-size:9px;font-weight:800;
              display:flex;align-items:center;justify-content:center;
              border:1.5px solid white">#${rank}</span>
          </div>`,
      }),
      zIndexOffset: 800,
    }).bindPopup(`
      <div class="popup-inner">
        <div class="popup-category"
          style="background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">
          ${cfg.icon} ${cfg.label.slice(0,-1)}
        </div>
        <div class="popup-name">${feat.name}</div>
        <div class="popup-row">
          <span class="pr-icon">📏</span>
          ${distKm < 1
            ? Math.round(distKm * 1000) + ' m away'
            : distKm.toFixed(2) + ' km away'}
        </div>
        <div class="popup-actions">
          <div class="popup-btn primary"
            onclick="routingModule.routeTo([${feat.latlng}],'${feat.name.replace(/'/g,"\\'")}')">
            🗺️ Route Here
          </div>
        </div>
      </div>`);
  }

  /* ── Clear all route artefacts ──────────────────────────── */
  function _clearRoute() {
    if (_lrmControl) {
      STATE.map.removeControl(_lrmControl);
      _lrmControl = null;
    }
  }

  /* ── Clear nearest markers ──────────────────────────────── */
  function _clearNearestMarkers() {
    _nearestMarkers.forEach(m => STATE.map.removeLayer(m));
    _nearestMarkers = [];
  }

  /* ── Build LRM waypoints and add control ─────────────────── */
  /**
   * routeBetween — calculate and display a route between two arbitrary
   * points. This is the generalized core that both routeTo() (GPS → POI)
   * and the new From/To geocode search both funnel into, so there is
   * exactly one LRM control alive at a time and one route-results panel.
   *
   * @param {L.LatLng|[number,number]} fromLatLng
   * @param {string}                   fromName
   * @param {L.LatLng|[number,number]} toLatLng
   * @param {string}                   toName
   */
  function routeBetween(fromLatLng, fromName, toLatLng, toName) {
    _clearRoute();

    const fromLL = L.latLng(fromLatLng);
    const toLL   = L.latLng(toLatLng);

    const isGpsOrigin = _userLatLng && fromLL.distanceTo(_userLatLng) < 1;

    _lrmControl = L.Routing.control({

      waypoints: [fromLL, toLL],

      router: L.Routing.osrmv1({
        serviceUrl:           'https://router.project-osrm.org/route/v1',
        profile:              'driving',
        suppressDemoServerWarning: true,
      }),

      routeWhileDragging:    true,
      showAlternatives:      true,
      numberOfAlternatives:  2,

      lineOptions: {
        styles: [
          { color: '#00B0FF', weight: 5, opacity: 0.85 },
          { color: '#7C4DFF', weight: 3, opacity: 0.55 },
          { color: '#FF5252', weight: 3, opacity: 0.45 },
        ],
        extendToWaypoints:   true,
        missingRouteTolerance: 0,
      },

      plan: L.Routing.plan(
        [fromLL, toLL],
        {
          createMarker: (i, wp) => {
            if (i === 0) {
              // Use the live-location pulse marker only when the origin
              // actually IS the user's GPS fix; otherwise a normal pin.
              return isGpsOrigin ? _makeUserMarker(wp.latLng) : _makeDestMarker(wp.latLng, fromName);
            }
            return _makeDestMarker(wp.latLng, toName);
          },
          draggableWaypoints: true,
          addWaypoints:       true,
        }
      ),

      collapsible:  true,
      collapsed:    false,
      show:         true,
      position: 'topright',

      summaryTemplate:
        '<div class="lrm-summary">' +
          '<span class="lrm-dist">{distance}</span>' +
          '<span class="lrm-time">{time}</span>' +
        '</div>',

      units: 'metric',

    }).addTo(STATE.map);

    _lrmControl.on('routesfound', e => {
      const routes  = e.routes;
      const primary = routes[0];
      const dist    = (primary.summary.totalDistance / 1000).toFixed(2);
      const mins    = Math.ceil(primary.summary.totalTime / 60);
      showToast(
        `🗺️ ${routes.length} route${routes.length > 1 ? 's' : ''} found — ` +
        `${dist} km · ~${mins} min`,
        4000
      );
      _updateRoutePanel(routes, toName, fromName);
    });

    _lrmControl.on('routingerror', e => {
      showToast('❌ Routing failed: ' + (e.error?.message || 'network error'));
    });

    STATE.map.fitBounds(
      L.latLngBounds([fromLL, toLL]).pad(0.2),
      { animate: true, duration: 1 }
    );
  }

  /**
   * routeTo — backward-compatible wrapper: routes from the user's GPS
   * location to a destination. Used by popups ("Route Here") and the
   * "Find Nearest" results panel. Internally just calls routeBetween()
   * with the live location as the origin.
   *
   * @param {[number,number]} destLatLng  – [lat, lng] of destination
   * @param {string}          destName    – label shown in panel
   */
  function routeTo(destLatLng, destName = 'Destination') {
    if (!_userLatLng) {
      showToast('📡 Getting your location first…');
      acquireLocation(() => routeTo(destLatLng, destName));
      return;
    }
    routeBetween(_userLatLng, 'Your location', L.latLng(destLatLng[0], destLatLng[1]), destName);
  }

  /* ── Route summary panel ─────────────────────────────────── */
  function _updateRoutePanel(routes, destName, fromName = null) {
    const panel = document.getElementById('route-results-panel');
    if (!panel) return;

    const colors = ['#00B0FF', '#7C4DFF', '#FF5252'];
    const headerLabel = fromName && fromName !== 'Your location'
      ? `🗺️ <strong>${fromName}</strong> → <strong>${destName}</strong>`
      : `🗺️ Routes to <strong>${destName}</strong>`;
    panel.innerHTML = `
      <div class="rrp-header">
        <span>${headerLabel}</span>
        <button onclick="routingModule.clearAll()" style="
          background:rgba(255,82,82,0.15);border:1px solid #FF5252;
          border-radius:7px;padding:3px 9px;font-size:11px;
          color:#FF5252;cursor:pointer">✕ Clear</button>
      </div>
      ${routes.map((r, i) => {
        const dist = (r.summary.totalDistance / 1000).toFixed(2);
        const mins = Math.ceil(r.summary.totalTime / 60);
        return `
          <div class="rrp-route" onclick="routingModule.selectAlternative(${i})"
            style="border-color:${colors[i]}22">
            <div class="rrp-route-badge" style="background:${colors[i]}22;color:${colors[i]}">
              ${i === 0 ? '⭐ Best' : `Alt ${i}`}
            </div>
            <div class="rrp-route-info">
              <span class="rrp-dist">📏 ${dist} km</span>
              <span class="rrp-time">⏱ ~${mins} min</span>
            </div>
            <div class="rrp-route-bar" style="background:${colors[i]}"></div>
          </div>`;
      }).join('')}`;

    panel.style.display = 'block';
  }

  /* ── Select alternative route by index ──────────────────── */
  function selectAlternative(idx) {
    if (!_lrmControl) return;
    // LRM exposes _routes internally; trigger highlight via internal method
    if (_lrmControl._routes && _lrmControl._routes[idx]) {
      _lrmControl._selectedRoute = idx;
      // Re-draw all routes; LRM re-renders on route selection
      _lrmControl.setWaypoints(_lrmControl.getWaypoints());
    }
    showToast(`🗺️ Viewing alternative route ${idx + 1}`);
  }

  /* ── Clear everything ────────────────────────────────────── */
  function clearAll() {
    _clearRoute();
    _clearNearestMarkers();
    const panel = document.getElementById('route-results-panel');
    if (panel) panel.style.display = 'none';
    showToast('🧹 Routes cleared');
  }

  /* ──────────────────────────────────────────────────────────
     ACQUIRE LOCATION
     Wraps navigator.geolocation.watchPosition so the user dot
     keeps updating as they move. Fires onReady() once on first fix.
     ────────────────────────────────────────────────────────── */
  function acquireLocation(onReady = null) {
    if (!navigator.geolocation) {
      showToast('❌ Geolocation not supported by this browser');
      return;
    }

    showToast('📡 Acquiring GPS location…');

    // Stop any previous watch
    if (_watchId !== null) navigator.geolocation.clearWatch(_watchId);

    _watchId = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const ll = L.latLng(lat, lng);

        /* First fix — centre map */
        if (!_userLatLng) {
          STATE.map.flyTo(ll, 15, { animate: true, duration: 1.2 });
          showToast('✅ Location locked');
          if (onReady) onReady();
        }

        _userLatLng = ll;

        /* Update or create user marker */
        if (_userMarker) {
          _userMarker.setLatLng(ll);
        } else {
          _userMarker = _makeUserMarker(ll).addTo(STATE.map);
        }

        /* Accuracy circle */
        if (_userCircle) {
          _userCircle.setLatLng(ll).setRadius(accuracy);
        } else {
          _userCircle = L.circle(ll, {
            radius:      accuracy,
            color:       '#00E5FF',
            fillColor:   '#00B0FF',
            fillOpacity: 0.08,
            weight:      1,
            dashArray:   '4,4',
          }).addTo(STATE.map);
        }
      },
      err => {
        showToast('❌ GPS error: ' + err.message);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  /* ──────────────────────────────────────────────────────────
     FIND NEAREST SITES
     Computes haversine distances → highlights results on map
     → populates the sidebar nearest-panel.

     @param {object} options  – passed through to findNearestSites()
     ────────────────────────────────────────────────────────── */
  function findNearest(options = {}) {
    if (!_userLatLng) {
      showToast('📡 Getting location first…');
      acquireLocation(() => findNearest(options));
      return;
    }

    // Default: top-5 within 3 km, all categories
    const opts = { topN: 5, radiusKm: 3, ...options };
    const results = findNearestSites(_userLatLng.lat, _userLatLng.lng, opts);

    if (!results.length) {
      showToast('🔍 No sites found within ' + opts.radiusKm + ' km');
      return;
    }

    /* ── Clear previous nearest markers ──────────────────── */
    _clearNearestMarkers();

    /* ── Place ranked markers ─────────────────────────────── */
    results.forEach(({ feature, distanceKm, rank }) => {
      const m = _makeNearestMarker(feature, rank, distanceKm);
      m.addTo(STATE.map);
      _nearestMarkers.push(m);
    });

    /* ── Fit map to user + all results ───────────────────── */
    const allPts = [
      _userLatLng,
      ...results.map(r => L.latLng(r.feature.latlng[0], r.feature.latlng[1]))
    ];
    STATE.map.fitBounds(L.latLngBounds(allPts).pad(0.25), { animate: true });

    /* ── Populate sidebar panel ───────────────────────────── */
    _renderNearestPanel(results);

    showToast(`🎯 ${results.length} nearest sites found`);
  }

  /* ── Nearest panel renderer ──────────────────────────────── */
  function _renderNearestPanel(results) {
    const panel = document.getElementById('nearest-results-panel');
    if (!panel) return;

    panel.innerHTML = `
      <div class="rrp-header">
        <span>🎯 Nearest Sites</span>
        <button onclick="routingModule.clearAll()" style="
          background:rgba(255,82,82,0.15);border:1px solid #FF5252;
          border-radius:7px;padding:3px 9px;font-size:11px;
          color:#FF5252;cursor:pointer">✕ Clear</button>
      </div>
      ${results.map(({ feature, distanceKm, rank }) => {
        const cfg = CAT_CONFIG[feature.cat];
        const distLabel = distanceKm < 1
          ? Math.round(distanceKm * 1000) + ' m'
          : distanceKm.toFixed(2) + ' km';
        return `
          <div class="nearest-item" onclick="routingModule.routeTo([${feature.latlng}],'${feature.name.replace(/'/g,"\\'")}')">
            <div class="ni-rank" style="background:${cfg.color}22;color:${cfg.color}">#${rank}</div>
            <div class="ni-body">
              <div class="ni-name">${feature.name}</div>
              <div class="ni-meta">
                <span style="color:${cfg.color}">${cfg.icon} ${cfg.label.slice(0,-1)}</span>
                <span style="color:var(--text-dim)">· ${distLabel}</span>
              </div>
            </div>
            <div class="ni-action">🗺️</div>
          </div>`;
      }).join('')}`;

    panel.style.display = 'block';
  }

  /* ── Public API ──────────────────────────────────────────── */
  return {
    acquireLocation,
    routeTo,
    routeBetween,
    findNearest,
    clearAll,
    selectAlternative,
    /** Expose current user position for external use */
    getUserLatLng: () => _userLatLng,
  };

})();

/* ──────────────────────────────────────────────────────────────
   4.  DYNAMIC MAP UPDATE HOOK
   Call this whenever the user picks a new destination from the
   search box, a popup, or the "Find Nearest" panel.

   Handles:
     a) Remove the old route + destination marker
     b) Re-run LRM with new waypoints
     c) Re-compute nearest markers if "nearest mode" is active

   This function is exported globally and called from popup HTML
   (onclick="selectDestination(...)") and from the search handler.
   ────────────────────────────────────────────────────────────── */
function selectDestination(latLng, name) {
  routingModule.routeTo(latLng, name);
}

/* ──────────────────────────────────────────────────────────────
   5.  BOOT — wire up the new UI controls after DOM ready
   ────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* "Locate & Route" button in header */
  const btnLocate = document.getElementById('ctrl-locate');
  if (btnLocate) {
    // Override the old locateMe() with the richer version
    btnLocate.addEventListener('click', () => routingModule.acquireLocation(), true);
  }

  /* "Find Nearest" button */
  const btnNearest = document.getElementById('ctrl-nearest');
  if (btnNearest) {
    btnNearest.addEventListener('click', () => {
      const catSel = document.getElementById('nearest-cat-select');
      const radSel = document.getElementById('nearest-radius-select');
      routingModule.findNearest({
        category:  catSel  ? (catSel.value  || null) : null,
        radiusKm:  radSel  ? (+radSel.value  || 3)   : 3,
        topN:      5,
      });
    });
  }

  /* "Clear Route" button */
  const btnClear = document.getElementById('ctrl-clear-route');
  if (btnClear) btnClear.addEventListener('click', () => routingModule.clearAll());

  /* Extend the popup "Route Here" buttons that app.js generates.
     app.js popup HTML uses onclick="routingModule.routeTo(...)"
     which is already wired above — no extra work needed. */
});
