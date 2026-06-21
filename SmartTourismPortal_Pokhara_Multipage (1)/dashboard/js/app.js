/* ============================================================
   POKHARA SMART TOURISM DASHBOARD — app.js
   ============================================================ */

'use strict';

/* ── Constants ────────────────────────────────────────────── */
const POKHARA_CENTER = [28.2096, 83.9856];
const POKHARA_ZOOM   = 13;

const CAT_CONFIG = {
  restaurant: { icon: '🍽️', color: '#FF5252', label: 'Restaurants',   key: 'amenity' },
  hotel:      { icon: '🏨', color: '#FFD54F', label: 'Hotels',        key: 'tourism' },
  hospital:   { icon: '🏥', color: '#00E676', label: 'Hospitals',     key: 'amenity' },
  viewpoint:  { icon: '🏔️', color: '#00E5FF', label: 'Viewpoints',    key: 'tourism' },
  temple:     { icon: '🛕', color: '#7C4DFF', label: 'Temples',       key: 'amenity', match: 'place_of_worship' },
  cafe:       { icon: '☕', color: '#FFA726', label: 'Cafés',         key: 'amenity' },
};

/* ── State ────────────────────────────────────────────────── */
const STATE = {
  map:          null,
  layers:       {},            // cat → L.LayerGroup
  allFeatures:  [],
  darkMode:     true,
  sidebarOpen:  true,
  activeCats:   new Set(Object.keys(CAT_CONFIG)),
  counts:       {},
};

/* ── DOM refs ─────────────────────────────────────────────── */
const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

/* ============================================================
   PARTICLES
   ============================================================ */
function initParticles() {
  const canvas = $('#particles-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, pts = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < 70; i++) {
    pts.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.4 + 0.4,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      alpha: Math.random() * 0.5 + 0.15,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,176,255,${p.alpha})`;
      ctx.fill();
    });
    // connect nearby
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < 100) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(0,176,255,${0.06 * (1 - d/100)})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

/* ============================================================
   MAP INIT
   ============================================================ */
function initMap() {
  const map = L.map('map', {
    center: POKHARA_CENTER,
    zoom:   POKHARA_ZOOM,
    zoomControl: false,
    attributionControl: true,
  });

  const darkTile = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com">CARTO</a> © <a href="https://osm.org/copyright">OSM</a>', maxZoom: 19 }
  );
  const lightTile = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://carto.com">CARTO</a>', maxZoom: 19 }
  );
  const satelliteTile = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '© Esri', maxZoom: 19 }
  );

  darkTile.addTo(map);
  STATE.map    = map;
  STATE.tiles  = { dark: darkTile, light: lightTile, satellite: satelliteTile };
  STATE.activeTile = 'dark';

  // custom zoom
  L.control.zoom({ position: 'bottomright' }).addTo(map);
}

/* ============================================================
   MARKER FACTORY
   ============================================================ */
function makeMarker(cat, latlng, feature) {
  const cfg = CAT_CONFIG[cat];
  const div = document.createElement('div');
  div.style.cssText = `
    width:30px;height:30px;border-radius:50%;
    background:${cfg.color}22;
    border:2px solid ${cfg.color};
    display:flex;align-items:center;justify-content:center;
    font-size:14px;cursor:pointer;
    box-shadow:0 0 8px ${cfg.color}55;
    transition:transform 0.15s ease, opacity 0.2s ease;
  `;
  div.textContent = cfg.icon;
  div.onmouseenter = () => div.style.transform = 'scale(1.25)';
  div.onmouseleave = () => div.style.transform = 'scale(1)';

  // Capacity-status ring (no-op if crowding.js absent or no tourism_data)
  if (typeof crowdingModule !== 'undefined' && feature) {
    crowdingModule.decorateMarker(div, feature);
  }

  return L.marker(latlng, {
    icon: L.divIcon({ html: div, className: '', iconSize: [30,30], iconAnchor: [15,15] })
  });
}

/* ============================================================
   POPUP BUILDER
   ============================================================ */
function buildPopup(cat, props) {
  const cfg = CAT_CONFIG[cat];
  const name    = props.name || props['name:en'] || 'Unknown Place';
  const phone   = props.phone || props['contact:phone'] || '';
  const website = props.website || props['contact:website'] || '';
  const stars   = props.stars ? '⭐'.repeat(Math.min(parseInt(props.stars)||0, 5)) : '';
  const cuisine = props.cuisine ? `<div class="popup-row"><span class="pr-icon">🍴</span>${props.cuisine}</div>` : '';
  const beds    = props['capacity:beds'] ? `<div class="popup-row"><span class="pr-icon">🛏️</span>${props['capacity:beds']} beds</div>` : '';
  const rooms   = props.rooms ? `<div class="popup-row"><span class="pr-icon">🚪</span>${props.rooms} rooms</div>` : '';
  const ele     = props.ele ? `<div class="popup-row"><span class="pr-icon">📏</span>${props.ele}m elevation</div>` : '';
  const open    = props.opening_hours ? `<div class="popup-row"><span class="pr-icon">🕐</span>${props.opening_hours}</div>` : '';

  const mapsLink   = `https://maps.google.com/?q=${name} Pokhara Nepal`;
  // Safe latlng string for inline onclick — will be filled by caller via data-attr
  const safeLatLng = `__LATLNG__`;
  const safeName   = name.replace(/'/g, "\\'");

  return `
    <div class="popup-inner">
      <div class="popup-category" style="background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">
        ${cfg.icon} ${cfg.label.slice(0,-1)}
      </div>
      <div class="popup-name">${name}</div>
      ${stars ? `<div style="margin-bottom:6px;font-size:13px">${stars}</div>` : ''}
      ${phone ? `<div class="popup-row"><span class="pr-icon">📞</span>${phone}</div>` : ''}
      ${cuisine}${beds}${rooms}${ele}${open}
      ${website ? `<div class="popup-row"><span class="pr-icon">🌐</span><a href="${website}" target="_blank" style="color:var(--accent);text-decoration:none;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;display:inline-block">${website.replace(/^https?:\/\//,'')}</a></div>` : ''}
      <div class="popup-actions">
        <div class="popup-btn primary" data-route-name="${safeName}" data-route-action="route">🗺️ Route Here</div>
        <div class="popup-btn" onclick="window.open('${mapsLink}','_blank')">📍 Maps</div>
        ${phone ? `<div class="popup-btn" onclick="window.open('tel:${phone}')">📞 Call</div>` : ''}
      </div>
    </div>`;
}

/* ============================================================
   GEOJSON LOADER
   ============================================================ */
function getCentroid(geometry) {
  const t = geometry.type;
  if (t === 'Point') return [geometry.coordinates[1], geometry.coordinates[0]];
  if (t === 'MultiPoint') return [geometry.coordinates[0][1], geometry.coordinates[0][0]];
  // Polygon / MultiPolygon — use first ring's first coord as approximation
  let coords = t === 'Polygon' ? geometry.coordinates[0] :
               t === 'MultiPolygon' ? geometry.coordinates[0][0] :
               t === 'LineString' ? geometry.coordinates : geometry.coordinates[0];
  let latSum = 0, lngSum = 0;
  for (const c of coords) { lngSum += c[0]; latSum += c[1]; }
  return [latSum / coords.length, lngSum / coords.length];
}

function getFeatureCat(props) {
  const a = props.amenity || '';
  const t = props.tourism || '';
  if (a === 'restaurant') return 'restaurant';
  if (a === 'cafe')       return 'cafe';
  if (a === 'hospital' || a === 'clinic') return 'hospital';
  if (a === 'place_of_worship') return 'temple';
  if (t === 'hotel' || t === 'guest_house' || t === 'hostel') return 'hotel';
  if (t === 'viewpoint' || t === 'attraction') return 'viewpoint';
  return null;
}

async function loadOverallData() {
  const resp = await fetch('./data/overalldata.geojson');
  const data = await resp.json();

  // init layer groups
  Object.keys(CAT_CONFIG).forEach(cat => {
    STATE.layers[cat] = L.layerGroup();
    STATE.counts[cat] = 0;
  });

  const searchIndex = [];

  for (const feat of data.features) {
    const props = feat.properties || {};
    const cat   = getFeatureCat(props);
    if (!cat) continue;

    const latlng = getCentroid(feat.geometry);
    if (!latlng || isNaN(latlng[0])) continue;

    const name = props.name || props['name:en'] || '';
    const featureEntry = { name, cat, latlng, props, marker: null };

    const marker = makeMarker(cat, latlng, featureEntry);
    marker.bindPopup(buildPopup(cat, props), { maxWidth: 300, minWidth: 200 });
    // Wire 'Route Here' after popup opens (DOM only exists on open)
    marker.on('popupopen', function(e) {
      const popupEl = e.popup.getElement();
      const btn = popupEl.querySelector('[data-route-action="route"]');
      if (btn) {
        const capLatlng = latlng.slice(); // capture current latlng
        const capName   = name || "Place";
        btn.onclick = () => {
          if (typeof routingModule !== 'undefined') {
            routingModule.routeTo(capLatlng, capName);
          }
        };
      }
      // Crowding: capacity status row + smart suggestions (no-op if no data)
      if (typeof crowdingModule !== 'undefined') {
        crowdingModule.augmentPopup(popupEl, featureEntry);
      }
      // Seasonal: Chart.js monthly visitors chart (no-op if no data)
      if (typeof seasonalModule !== 'undefined') {
        seasonalModule.renderPopupChart(popupEl, featureEntry);
      }
    });
    marker.on('popupclose', function(e) {
      if (typeof seasonalModule !== 'undefined') {
        seasonalModule.destroyPopupChart(e.popup.getElement());
      }
    });
    featureEntry.marker = marker;
    STATE.layers[cat].addLayer(marker);
    STATE.counts[cat]++;

    if (name) {
      searchIndex.push({ name, cat, latlng, props });
      STATE.allFeatures.push(featureEntry);
    }
  }

  // add visible layers
  STATE.activeCats.forEach(cat => STATE.layers[cat].addTo(STATE.map));

  updateCounts();
  buildSearchIndex(searchIndex);
  updateAnalytics();
}

async function loadBoundaries() {
  const files = [
    { url: './data/province_boundary.geojson', color: '#00B0FF', weight: 2, label: 'Province', dash: '8,4' },
    { url: './data/district_boundary.geojson', color: '#00E5FF', weight: 1.5, label: 'District', dash: '4,3' },
    { url: './data/pokharaboundary.geojson',   color: '#FFD54F', weight: 2.5, label: 'Pokhara City', dash: null },
  ];

  for (const f of files) {
    try {
      const resp = await fetch(f.url);
      const data = await resp.json();
      if (!data.features || data.features.length === 0) continue;
      const layer = L.geoJSON(data, {
        style: {
          color: f.color, weight: f.weight,
          fillOpacity: 0.03, dashArray: f.dash,
          opacity: 0.8,
        }
      });
      STATE[`${f.label.replace(/ /g,'_').toLowerCase()}_layer`] = layer;
      layer.addTo(STATE.map);
    } catch(e) { /* empty geojson — skip silently */ }
  }
}

/* ============================================================
   SEARCH
   ============================================================ */
let searchData = [];
function buildSearchIndex(data) { searchData = data; }

function doSearch(query) {
  const q = query.toLowerCase().trim();
  if (!q) { $('#search-results').style.display = 'none'; return; }
  const results = searchData
    .filter(d => d.name.toLowerCase().includes(q))
    .slice(0, 10);

  const box = $('#search-results');
  if (!results.length) { box.style.display = 'none'; return; }

  box.innerHTML = results.map(r => {
    const cfg = CAT_CONFIG[r.cat];
    return `
      <div class="search-item" data-lat="${r.latlng[0]}" data-lng="${r.latlng[1]}" data-name="${r.name}">
        <span class="si-icon">${cfg.icon}</span>
        <div>
          <div class="si-name">${r.name}</div>
          <div class="si-cat">${cfg.label}</div>
        </div>
      </div>`;
  }).join('');
  box.style.display = 'block';

  $$('.search-item', box).forEach(el => {
    el.addEventListener('click', () => {
      const lat = +el.dataset.lat, lng = +el.dataset.lng;
      STATE.map.flyTo([lat, lng], 17, { animate: true, duration: 1 });
      box.style.display = 'none';
      $('#search-input').value = el.dataset.name;
      showToast(`📍 Navigating to ${el.dataset.name}`);
    });
  });
}

/* ============================================================
   LAYER TOGGLES
   ============================================================ */
function toggleCategory(cat) {
  if (STATE.activeCats.has(cat)) {
    STATE.activeCats.delete(cat);
    STATE.map.removeLayer(STATE.layers[cat]);
  } else {
    STATE.activeCats.add(cat);
    STATE.layers[cat].addTo(STATE.map);
  }
  $$('.chip').forEach(c => {
    const dc = c.dataset.cat;
    c.classList.toggle('active', STATE.activeCats.has(dc));
  });
  $$('.layer-btn').forEach(b => {
    const dc = b.dataset.cat;
    if (dc) b.classList.toggle('active', STATE.activeCats.has(dc));
  });
  if (typeof heatmapModule !== 'undefined') heatmapModule.refresh();
  if (typeof seasonalModule !== 'undefined') seasonalModule.refresh();
}

/* ============================================================
   UI UPDATES
   ============================================================ */
function updateCounts() {
  Object.entries(STATE.counts).forEach(([cat, n]) => {
    const badge = $(`.layer-count[data-cat="${cat}"]`);
    if (badge) badge.textContent = n.toLocaleString();
  });
  const total = Object.values(STATE.counts).reduce((a,b) => a+b, 0);
  $('#stat-total').textContent = total.toLocaleString();
  $('#stat-restaurants').textContent = (STATE.counts.restaurant||0).toLocaleString();
  $('#stat-hotels').textContent      = (STATE.counts.hotel||0).toLocaleString();
  $('#stat-hospitals').textContent   = (STATE.counts.hospital||0).toLocaleString();
}

function updateAnalytics() {
  const counts = STATE.counts;
  const total  = Object.values(counts).reduce((a,b)=>a+b,0) || 1;

  const items = Object.entries(CAT_CONFIG).map(([cat, cfg]) => ({
    cat, cfg, n: counts[cat]||0,
    pct: Math.round(((counts[cat]||0)/total)*100)
  })).sort((a,b)=>b.n-a.n);

  const html = items.map(({cat,cfg,n,pct}) => `
    <div class="anal-row">
      <div class="anal-dot" style="background:${cfg.color}"></div>
      <div class="anal-name">${cfg.label}</div>
      <div class="anal-num">${n}</div>
    </div>
    <div class="anal-bar-wrap">
      <div class="anal-bar" style="width:${pct}%;background:${cfg.color}"></div>
    </div>
  `).join('');

  $('#analytics-breakdown').innerHTML = html;
}

/* ============================================================
   TOAST
   ============================================================ */
function showToast(msg, duration = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

/* ============================================================
   DARK / LIGHT / SATELLITE
   ============================================================ */
function setMapStyle(style) {
  Object.values(STATE.tiles).forEach(t => STATE.map.removeLayer(t));
  STATE.tiles[style].addTo(STATE.map);
  STATE.tiles[style].bringToBack();
  STATE.activeTile = style;
  showToast(`🗺️ Map style: ${style}`);
}

/* ============================================================
   FULLSCREEN
   ============================================================ */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

/* ============================================================
   LOCATE ME
   ============================================================ */
function locateMe() {
  if (!navigator.geolocation) { showToast('❌ Geolocation not supported'); return; }
  showToast('📡 Getting your location…');
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    STATE.map.flyTo([lat, lng], 15, { animate: true, duration: 1.2 });
    L.circle([lat, lng], { radius: 80, color: '#00E5FF', fillOpacity: 0.15 }).addTo(STATE.map);
    L.marker([lat, lng], {
      icon: L.divIcon({
        html: '<div style="width:14px;height:14px;background:#00E5FF;border:2px solid white;border-radius:50%;box-shadow:0 0 10px #00E5FF"></div>',
        className: '', iconSize: [14,14], iconAnchor: [7,7]
      })
    }).addTo(STATE.map).bindPopup('📍 You are here').openPopup();
    showToast('✅ Location found!');
  }, () => showToast('❌ Could not get location'));
}

/* ============================================================
   HEATMAP — see js/heatmap.js (heatmapModule) for the real
   Leaflet.heat implementation. The old canvas-based renderer
   was removed here; #btn-heatmap is wired to heatmapModule.toggle
   in the boot block below.
   ============================================================ */

/* ============================================================
   SIDEBAR TOGGLE
   ============================================================ */
function toggleSidebar() {
  STATE.sidebarOpen = !STATE.sidebarOpen;
  $('#sidebar').classList.toggle('collapsed', !STATE.sidebarOpen);
  $('#btn-sidebar').classList.toggle('active', STATE.sidebarOpen);
  setTimeout(() => STATE.map.invalidateSize(), 300);
}

/* ============================================================
   BOOT
   ============================================================ */
window.addEventListener('DOMContentLoaded', async () => {
  // particles
  initParticles();

  // map
  initMap();

  // load data
  await Promise.all([loadOverallData(), loadBoundaries()]);

  showToast('🏔️ Pokhara Smart Tourism Dashboard loaded!');

  // search
  const searchInput = $('#search-input');
  searchInput.addEventListener('input', e => doSearch(e.target.value));
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) {
      $('#search-results').style.display = 'none';
    }
  });

  // layer chips
  $$('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      if (cat === 'all') {
        const allOn = STATE.activeCats.size === Object.keys(CAT_CONFIG).length;
        if (allOn) {
          Object.keys(CAT_CONFIG).forEach(c => {
            STATE.activeCats.delete(c);
            STATE.map.removeLayer(STATE.layers[c]);
          });
        } else {
          Object.keys(CAT_CONFIG).forEach(c => {
            STATE.activeCats.add(c);
            STATE.layers[c].addTo(STATE.map);
          });
        }
        $$('.chip').forEach(c => c.classList.toggle('active', !allOn));
      } else {
        toggleCategory(cat);
      }
    });
  });

  // sidebar layer buttons
  $$('.layer-btn[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      toggleCategory(cat);
    });
  });

  // header buttons
  $('#btn-sidebar').addEventListener('click', toggleSidebar);

  $('#btn-dark').addEventListener('click', () => {
    STATE.darkMode = !STATE.darkMode;
    document.body.classList.toggle('light-mode', !STATE.darkMode);
    setMapStyle(STATE.darkMode ? 'dark' : 'light');
    $('#btn-dark').textContent = STATE.darkMode ? '🌙' : '☀️';
  });

  $('#btn-fullscreen').addEventListener('click', toggleFullscreen);
  $('#btn-heatmap').addEventListener('click', () => heatmapModule.toggle());

  // seasonal filter UI (injected after .filter-chips)
  if (typeof seasonalModule !== 'undefined') seasonalModule.init();

  // From/To geocode routing search
  if (typeof geocodingModule !== 'undefined') geocodingModule.init();

  // map controls
  $('#ctrl-locate').addEventListener('click', locateMe);
  $('#ctrl-satellite').addEventListener('click', () => {
    const next = STATE.activeTile === 'satellite' ? (STATE.darkMode ? 'dark' : 'light') : 'satellite';
    setMapStyle(next);
  });
  $('#ctrl-home').addEventListener('click', () => {
    STATE.map.flyTo(POKHARA_CENTER, POKHARA_ZOOM, { animate: true, duration: 1 });
  });

  // init chip states
  $$('.chip').forEach(c => {
    const cat = c.dataset.cat;
    if (cat && cat !== 'all') c.classList.toggle('active', STATE.activeCats.has(cat));
    if (cat === 'all') c.classList.add('active');
  });
  $$('.layer-btn[data-cat]').forEach(b => b.classList.add('active'));
});
