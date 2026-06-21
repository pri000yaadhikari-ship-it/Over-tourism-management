/* ============================================================
   POKHARA SMART TOURISM DASHBOARD — geocoding-routing.js
   From/To geocode search using Nominatim (OpenStreetMap)
   ============================================================
   HOW IT PLUGS IN:
     • Loaded AFTER routing.js in index.html
     • Reads STATE.map, STATE.allFeatures from app.js
     • Calls routingModule.routeBetween() / acquireLocation() /
       getUserLatLng() from routing.js — does NOT touch LRM
       directly, so there is still exactly one routing code path
     • Wires #route-from-input, #route-to-input, #ft-go-btn,
       #ft-swap-btn, #ft-use-my-location (added in index.html)
   ============================================================
   GEOCODING STRATEGY (two-tier, both free, no API key):
     1. Local POIs first — search STATE.allFeatures (instant,
        no network call, works offline once data is loaded).
     2. Nominatim (OSM) fallback — for addresses/places not in
        our POI dataset (e.g. "Pokhara Airport", "Lakeside Road").
        Nominatim's usage policy requires: a descriptive User-Agent
        or Referer (the browser sends Referer automatically), no
        more than ~1 request/second, and no heavy/bulk geocoding.
        This module debounces input and only queries on demand
        (button press / suggestion list), never on every keystroke
        against Nominatim — local POIs cover the live-typing case.
   ============================================================ */

'use strict';

const geocodingModule = (() => {

  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
  const POKHARA_VIEWBOX = '83.85,28.30,84.05,28.13'; // left,top,right,bottom — biases results to Pokhara

  let _fromPoint = null; // { latlng:[lat,lng], label }
  let _toPoint   = null;
  let _debounceTimer = null;

  /* ── Local POI search (instant, no network) ──────────────── */
  function searchLocalPOIs(query, maxResults = 5) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return STATE.allFeatures
      .filter(f => f.name.toLowerCase().includes(q))
      .slice(0, maxResults)
      .map(f => ({
        label: f.name,
        sublabel: CAT_CONFIG[f.cat]?.label || '',
        latlng: f.latlng,
        source: 'local',
      }));
  }

  /* ── Nominatim geocode (network, rate-limit aware) ────────── */
  async function geocodeNominatim(query, maxResults = 5) {
    const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(query)}` +
                `&viewbox=${POKHARA_VIEWBOX}&bounded=0&limit=${maxResults}`;
    try {
      const resp = await fetch(url, {
        headers: { 'Accept-Language': 'en' }, // Referer is sent by the browser automatically
      });
      if (!resp.ok) throw new Error(`Nominatim HTTP ${resp.status}`);
      const results = await resp.json();
      return results.map(r => ({
        label: r.display_name.split(',').slice(0, 2).join(','),
        sublabel: r.display_name.split(',').slice(2, 4).join(',').trim(),
        latlng: [parseFloat(r.lat), parseFloat(r.lon)],
        source: 'nominatim',
      }));
    } catch (err) {
      console.warn('Nominatim geocoding failed:', err);
      return [];
    }
  }

  /* ── Combined search: local POIs instantly, then Nominatim ── */
  async function search(query) {
    const local = searchLocalPOIs(query);
    if (local.length >= 3) return local; // enough local matches, skip network call
    const remote = await geocodeNominatim(query, 5 - local.length);
    return [...local, ...remote];
  }

  /* ── Render a suggestion dropdown under an input ──────────── */
  function renderSuggestions(suggestEl, results, onPick) {
    if (!results.length) { suggestEl.classList.remove('show'); suggestEl.innerHTML = ''; return; }
    suggestEl.innerHTML = results.map((r, i) => `
      <div class="ft-suggest-item" data-idx="${i}">
        <div>${r.source === 'local' ? '📍' : '🌐'} ${r.label}</div>
        ${r.sublabel ? `<div class="ft-s-sub">${r.sublabel}</div>` : ''}
      </div>`).join('');
    suggestEl.classList.add('show');
    suggestEl.querySelectorAll('.ft-suggest-item').forEach(el => {
      el.addEventListener('click', () => {
        const r = results[+el.dataset.idx];
        onPick(r);
        suggestEl.classList.remove('show');
      });
    });
  }

  /* ── Wire one input + its suggestion box ──────────────────── */
  function wireInput(inputEl, suggestEl, onPick) {
    inputEl.addEventListener('input', () => {
      clearTimeout(_debounceTimer);
      const q = inputEl.value;
      if (q.trim().length < 2) { suggestEl.classList.remove('show'); return; }
      _debounceTimer = setTimeout(async () => {
        const results = await search(q);
        renderSuggestions(suggestEl, results, (r) => {
          inputEl.value = r.label;
          onPick(r);
        });
      }, 350); // debounce so Nominatim only sees ~1 req/sec at most
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.ft-row')) suggestEl.classList.remove('show');
    });
  }

  /* ── "Use my location" → populate From with live GPS fix ──── */
  function useMyLocation(fromInputEl) {
    showToast('📡 Getting your location…');
    routingModule.acquireLocation(() => {
      const ll = routingModule.getUserLatLng();
      if (!ll) return;
      _fromPoint = { latlng: [ll.lat, ll.lng], label: 'Your location' };
      fromInputEl.value = '📍 Your current location';
      showToast('✅ Using your location as From');
    });
  }

  /* ── Run the route once both points are set ───────────────── */
  function goRoute() {
    if (!_fromPoint) { showToast('⚠️ Please set a "From" location'); return; }
    if (!_toPoint)   { showToast('⚠️ Please set a "To" location');   return; }
    routingModule.routeBetween(_fromPoint.latlng, _fromPoint.label, _toPoint.latlng, _toPoint.label);
  }

  function swap() {
    const fromInput = document.getElementById('route-from-input');
    const toInput   = document.getElementById('route-to-input');
    [_fromPoint, _toPoint] = [_toPoint, _fromPoint];
    [fromInput.value, toInput.value] = [toInput.value, fromInput.value];
    if (_fromPoint && _toPoint) goRoute();
  }

  function init() {
    const fromInput   = document.getElementById('route-from-input');
    const toInput     = document.getElementById('route-to-input');
    const fromSuggest = document.getElementById('ft-from-suggest');
    const toSuggest   = document.getElementById('ft-to-suggest');
    const gpsBtn      = document.getElementById('ft-use-my-location');
    const goBtn       = document.getElementById('ft-go-btn');
    const swapBtn     = document.getElementById('ft-swap-btn');

    if (!fromInput || !toInput) return; // UI not present — no-op

    wireInput(fromInput, fromSuggest, (r) => { _fromPoint = { latlng: r.latlng, label: r.label }; });
    wireInput(toInput,   toSuggest,   (r) => { _toPoint   = { latlng: r.latlng, label: r.label }; });

    gpsBtn?.addEventListener('click', () => useMyLocation(fromInput));
    goBtn?.addEventListener('click', goRoute);
    swapBtn?.addEventListener('click', swap);
  }

  return { init, search, useMyLocation, goRoute };
})();
