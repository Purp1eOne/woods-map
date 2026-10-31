(() => {
  'use strict';

  // ---------- Config ----------
  const MN = L.latLngBounds([43.45, -97.3], [49.45, -89.4]); // Minnesota, a little padded
  const STORE = { pins: 'woodsmap.pins.v1', view: 'woodsmap.view.v1', layer: 'woodsmap.layer.v1', overlays: 'woodsmap.overlays.v1' };
  const TILE_CACHE = 'woods-tiles-v1';
  const MAX_TILES = 8000;
  const AVG_KB = 30;

  const SOURCES = {
    topo: {
      name: 'Topo',
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
      attr: 'USGS The National Map',
      maxNative: 16
    },
    sat: {
      name: 'Satellite',
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      attr: 'USGS The National Map',
      maxNative: 16
    },
    street: {
      name: 'Street',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '&copy; OpenStreetMap contributors',
      maxNative: 19
    }
  };

  // MN DNR public land overlays. These are dynamic ArcGIS map services (not pre-cut tiles),
  // so each 256px tile is requested as a small transparent image for one web-mercator box.
  const OVERLAYS = {
    wma: {
      name: 'DNR public land (WMAs)',
      url: 'https://gis.dnr.state.mn.us/appserver/rest/services/webGDRS/bdry_dnr_wildlife_mgmt_areas_pub/MapServer',
      opacity: 0.7
    },
    wia: {
      name: 'Walk-in access (SW MN)',
      url: 'https://gis.dnr.state.mn.us/appserver/rest/services/webGDRS/bdry_dnr_walk_in_access_sites/MapServer',
      opacity: 0.7
    }
  };
  const OVERLAY_MAX_SAVE_ZOOM = 15; // keep load on the state server reasonable
  const OVERLAY_AVG_KB = 3;
  const MERC = 20037508.342789244;
  function overlayTileUrl(base, z, x, y) {
    const res = (MERC * 2) / Math.pow(2, z);
    const x0 = -MERC + x * res;
    const y1 = MERC - y * res;
    const f = (n) => n.toFixed(3);
    // layers=show:0 is required: the WMA layer is switched off by default on the server.
    return base + '/export?bbox=' + [f(x0), f(y1 - res), f(x0 + res), f(y1)].join(',') +
      '&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:0&f=image';
  }

  const CATS = {
    stand: { label: 'Stand / blind', icon: '🦌', color: '#b5651d' },
    camp: { label: 'Camp', icon: '⛺', color: '#2e7d32' },
    truck: { label: 'Parking / truck', icon: '🛻', color: '#1565c0' },
    sign: { label: 'Sign (tracks, rub, scrape)', icon: '🐾', color: '#6a1b9a' },
    water: { label: 'Water', icon: '💧', color: '#0277bd' },
    other: { label: 'Other', icon: '📍', color: '#c62828' }
  };

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);

  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { toast('Could not save. Phone storage may be full.'); }
  }
  function recall(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }

  let toastTimer = null;
  function toast(msg, ms = 2800) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  const R = 6371000;
  const rad = (d) => d * Math.PI / 180;
  function dist(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function fmtDist(m) {
    const ft = m * 3.28084;
    if (ft < 100) return Math.round(ft) + ' ft';
    if (ft < 1000) return Math.round(ft / 10) * 10 + ' ft';
    return (m / 1609.344).toFixed(2) + ' mi';
  }
  const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = (deg) => DIRS[Math.round(deg / 22.5) % 16];
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  // ---------- Map ----------
  const savedView = recall(STORE.view, null);
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    maxBounds: MN.pad(0.1),
    maxBoundsViscosity: 0.9,
    minZoom: 6,
    maxZoom: 18,
    center: savedView ? [savedView.lat, savedView.lng] : [46.3, -94.3],
    zoom: savedView ? savedView.zoom : 7
  });

  const layers = {};
  for (const [key, s] of Object.entries(SOURCES)) {
    layers[key] = L.tileLayer(s.url, {
      attribution: s.attr,
      maxNativeZoom: s.maxNative,
      maxZoom: 18,
      bounds: MN.pad(0.1),
      crossOrigin: true
    });
  }
  const startLayer = recall(STORE.layer, 'topo');
  (layers[startLayer] || layers.topo).addTo(map);
  const ArcExport = L.TileLayer.extend({
    getTileUrl(c) { return overlayTileUrl(this._url, this._getZoomForUrl(), c.x, c.y); }
  });
  const overlayLayers = {};
  for (const [key, o] of Object.entries(OVERLAYS)) {
    overlayLayers[key] = new ArcExport(o.url, {
      attribution: 'MN DNR',
      maxZoom: 18,
      bounds: MN.pad(0.1),
      opacity: o.opacity,
      zIndex: 5
    });
  }
  recall(STORE.overlays, ['wma']).forEach((k) => { if (overlayLayers[k]) overlayLayers[k].addTo(map); });
  const overlayControl = {};
  for (const [key, o] of Object.entries(OVERLAYS)) overlayControl[o.name] = overlayLayers[key];
  L.control.layers({ 'Topo': layers.topo, 'Satellite': layers.sat, 'Street': layers.street }, overlayControl, { position: 'topright' }).addTo(map);
  const saveOverlays = () => store(STORE.overlays, Object.keys(overlayLayers).filter((k) => map.hasLayer(overlayLayers[k])));
  map.on('overlayadd', saveOverlays);
  map.on('overlayremove', saveOverlays);
  L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(map);
  map.on('baselayerchange', (e) => {
    const key = Object.keys(layers).find((k) => layers[k] === e.layer);
    if (key) store(STORE.layer, key);
  });

  function updateCoords() {
    const c = map.getCenter();
    $('coords').textContent = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5);
  }
  map.on('move', updateCoords);
  map.on('moveend', () => {
    const c = map.getCenter();
    store(STORE.view, { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    if (!$('offlineSheet').hidden) updateEstimate();
  });
  updateCoords();

  $('coords').addEventListener('click', () => {
    const txt = $('coords').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Coordinates copied'), () => {});
  });

  // ---------- Sheets ----------
  const SHEETS = ['editor', 'pinsSheet', 'offlineSheet', 'moreSheet'];
  function showSheet(id) {
    SHEETS.forEach((s) => { $(s).hidden = s !== id; });
    $('backdrop').hidden = false;
  }
  function closeSheets() {
    SHEETS.forEach((s) => { $(s).hidden = true; });
    $('backdrop').hidden = true;
  }
  $('backdrop').addEventListener('click', closeSheets);

  // ---------- Pins ----------
  let pins = recall(STORE.pins, []);
  const markers = new Map();
  let editing = null;

  const catSel = $('pinCat');
  for (const [k, c] of Object.entries(CATS)) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = c.icon + '  ' + c.label;
    catSel.appendChild(o);
  }

  function pinIcon(cat) {
    const c = CATS[cat] || CATS.other;
    return L.divIcon({
      className: '',
      html: '<div class="pin" style="--c:' + c.color + '"><span>' + c.icon + '</span></div>',
      iconSize: [36, 36],
      iconAnchor: [18, 43],
      popupAnchor: [0, -40]
    });
  }

  function popupFor(p) {
    const div = document.createElement('div');
    div.className = 'pp';
    const h = document.createElement('strong');
    h.textContent = p.name || 'Untitled';
    div.appendChild(h);
    const meta = document.createElement('div');
    meta.className = 'pp-meta';
    meta.textContent = (CATS[p.cat] || CATS.other).label;
    div.appendChild(meta);
    if (me) {
      const d = document.createElement('div');
      d.className = 'pp-meta';
      d.textContent = fmtDist(dist(me, p)) + ' ' + compass(bearing(me, p)) + ' of you';
      div.appendChild(d);
    }
    if (p.notes) {
      const n = document.createElement('div');
      n.className = 'pp-notes';
      n.textContent = p.notes;
      div.appendChild(n);
    }
    const actions = document.createElement('div');
    actions.className = 'pp-actions';
    const go = document.createElement('button');
    go.textContent = 'Go there';
    go.addEventListener('click', () => { map.closePopup(); setTarget(p.id); });
    const ed = document.createElement('button');
    ed.className = 'alt';
    ed.textContent = 'Edit';
    ed.addEventListener('click', () => { map.closePopup(); openEditor(p, false); });
    actions.append(go, ed);
    div.appendChild(actions);
    return div;
  }

  function addMarker(p) {
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(p.cat), title: p.name }).addTo(map);
    m.bindPopup(() => popupFor(p));
    markers.set(p.id, m);
  }
  function refreshMarker(p) {
    const m = markers.get(p.id);
    if (!m) return addMarker(p);
    m.setIcon(pinIcon(p.cat));
    m.setLatLng([p.lat, p.lng]);
  }
  function removeMarker(id) {
    const m = markers.get(id);
    if (m) { map.removeLayer(m); markers.delete(id); }
  }
  pins.forEach(addMarker);

  function openEditor(p, isNew) {
    editing = { p, isNew };
    $('editorTitle').textContent = isNew ? 'New pin' : 'Edit pin';
    $('pinName').value = p.name || '';
    $('pinCat').value = CATS[p.cat] ? p.cat : 'stand';
    $('pinNotes').value = p.notes || '';
    $('pinCoords').textContent = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
    $('btnPinDelete').hidden = isNew;
    showSheet('editor');
    setTimeout(() => $('pinName').focus(), 60);
  }

  $('btnPinSave').addEventListener('click', () => {
    if (!editing) return;
    const { p, isNew } = editing;
    p.cat = $('pinCat').value;
    p.name = $('pinName').value.trim() || (CATS[p.cat].label.split(' ')[0] + ' ' + (pins.length + (isNew ? 1 : 0)));
    p.notes = $('pinNotes').value.trim();
    if (isNew) { p.id = newId(); p.created = Date.now(); pins.push(p); }
    store(STORE.pins, pins);
    refreshMarker(p);
    if (target && target.id === p.id) { target = p; updateNav(); }
    closeSheets();
    editing = null;
    toast('Pin saved');
  });
  $('btnPinCancel').addEventListener('click', () => { closeSheets(); editing = null; });
  $('btnPinDelete').addEventListener('click', () => {
    if (!editing || editing.isNew) return;
    if (!confirm('Delete "' + editing.p.name + '"?')) return;
    const id = editing.p.id;
    pins = pins.filter((x) => x.id !== id);
    store(STORE.pins, pins);
    removeMarker(id);
    if (target && target.id === id) setTarget(null);
    closeSheets();
    editing = null;
  });

  $('btnPinCenter').addEventListener('click', () => {
    const c = map.getCenter();
    openEditor({ lat: c.lat, lng: c.lng, cat: 'stand', name: '', notes: '' }, true);
  });

  $('btnPinMe').addEventListener('click', () => {
    if (!('geolocation' in navigator)) return toast('GPS is not available on this device');
    if (me && Date.now() - me.t < 20000) {
      return openEditor({ lat: me.lat, lng: me.lng, cat: 'stand', name: '', notes: '' }, true);
    }
    toast('Getting GPS fix…', 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        toast('Got it', 800);
        openEditor({ lat: pos.coords.latitude, lng: pos.coords.longitude, cat: 'stand', name: '', notes: '' }, true);
      },
      () => toast('Could not get your location. Check that location is allowed.'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );
  });

  map.on('contextmenu', (e) => {
    openEditor({ lat: e.latlng.lat, lng: e.latlng.lng, cat: 'stand', name: '', notes: '' }, true);
  });

  // ---------- Pin list ----------
  function renderList() {
    const q = $('pinSearch').value.trim().toLowerCase();
    const items = pins.filter((p) => !q || ((p.name || '') + ' ' + (p.notes || '')).toLowerCase().includes(q));
    if (me) items.sort((a, b) => dist(me, a) - dist(me, b));
    else items.sort((a, b) => b.created - a.created);
    const ul = $('pinList');
    ul.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = pins.length ? 'No pins match.' : 'No pins yet. Use "Pin me" or "Pin center" to add one.';
      ul.appendChild(li);
      return;
    }
    for (const p of items) {
      const c = CATS[p.cat] || CATS.other;
      const li = document.createElement('li');
      const b = document.createElement('button');
      const ic = document.createElement('span');
      ic.className = 'pi';
      ic.textContent = c.icon;
      const txt = document.createElement('span');
      const t = document.createElement('span');
      t.className = 'pt';
      t.textContent = p.name;
      const s = document.createElement('span');
      s.className = 'ps';
      s.textContent = c.label + (me ? ' · ' + fmtDist(dist(me, p)) + ' ' + compass(bearing(me, p)) : '');
      txt.append(t, s);
      b.append(ic, txt);
      b.addEventListener('click', () => {
        closeSheets();
        map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
        const m = markers.get(p.id);
        if (m) setTimeout(() => m.openPopup(), 850);
      });
      li.appendChild(b);
      ul.appendChild(li);
    }
  }
  $('btnPins').addEventListener('click', () => { $('pinSearch').value = ''; renderList(); showSheet('pinsSheet'); });
  $('pinSearch').addEventListener('input', renderList);

  // ---------- GPS ----------
  let me = null, watchId = null, meDot = null, meAcc = null, centerOnFix = false;

  function startGPS() {
    if (!('geolocation' in navigator)) return toast('GPS is not available on this device');
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
    $('btnLocate').classList.add('on');
  }
  function onPos(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    me = { lat, lng, acc: accuracy, t: Date.now() };
    const ll = [lat, lng];
    if (!meDot) {
      meAcc = L.circle(ll, { radius: accuracy, color: '#2979ff', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
      meDot = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    } else {
      meAcc.setLatLng(ll).setRadius(accuracy);
      meDot.setLatLng(ll);
    }
    if (centerOnFix) {
      centerOnFix = false;
      map.setView(ll, Math.max(map.getZoom(), 15));
    }
    updateNav();
  }
  function onPosErr(err) {
    if (err.code === 1) {
      toast('Location is blocked. Allow location for this site in your browser settings.', 5000);
      stopGPS();
    } else {
      toast('Waiting for GPS signal…');
    }
  }
  function stopGPS() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    $('btnLocate').classList.remove('on');
  }
  $('btnLocate').addEventListener('click', () => {
    if (watchId === null) {
      centerOnFix = true;
      startGPS();
      toast('Finding you…', 3000);
    } else if (me) {
      map.setView([me.lat, me.lng], Math.max(map.getZoom(), 15));
    } else {
      centerOnFix = true;
    }
  });
  $('btnLocate').addEventListener('contextmenu', (e) => { e.preventDefault(); stopGPS(); toast('GPS tracking off'); });

  // ---------- Navigate to a pin ----------
  let target = null, navLine = null;
  function setTarget(id) {
    target = id ? pins.find((p) => p.id === id) || null : null;
    if (target && watchId === null) { centerOnFix = false; startGPS(); }
    updateNav();
  }
  function updateNav() {
    const box = $('navinfo');
    if (!target) {
      box.hidden = true;
      if (navLine) { map.removeLayer(navLine); navLine = null; }
      return;
    }
    box.hidden = false;
    if (!me) {
      $('navtext').textContent = target.name + ': waiting for GPS…';
      return;
    }
    const d = dist(me, target);
    $('navtext').textContent = target.name + ' · ' + fmtDist(d) + ' · ' + compass(bearing(me, target)) + ' ' + Math.round(bearing(me, target)) + '°';
    const pts = [[me.lat, me.lng], [target.lat, target.lng]];
    if (!navLine) navLine = L.polyline(pts, { color: '#e8b53a', weight: 4, dashArray: '8 8', interactive: false }).addTo(map);
    else navLine.setLatLngs(pts);
  }
  $('navStop').addEventListener('click', () => setTarget(null));

  // ---------- Offline maps ----------
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const lat2y = (lat, z) => {
    const r = rad(lat);
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
  };
  const clampT = (v, z) => Math.max(0, Math.min(2 ** z - 1, v));

  function areaBounds() {
    const b = map.getBounds();
    const w = Math.max(b.getWest(), MN.getWest()), e = Math.min(b.getEast(), MN.getEast());
    const s = Math.max(b.getSouth(), MN.getSouth()), n = Math.min(b.getNorth(), MN.getNorth());
    if (w >= e || s >= n) return null;
    return { w, e, s, n };
  }
  function tileRange(a, z) {
    return {
      x0: clampT(lon2x(a.w, z), z), x1: clampT(lon2x(a.e, z), z),
      y0: clampT(lat2y(a.n, z), z), y1: clampT(lat2y(a.s, z), z)
    };
  }
  function countTiles(a, zMax) {
    let total = 0;
    for (let z = 8; z <= zMax; z++) {
      const r = tileRange(a, z);
      total += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    }
    return total;
  }

  function overlayTileCount(a, zMax) {
    return countTiles(a, Math.min(zMax, OVERLAY_MAX_SAVE_ZOOM)) * Object.keys(OVERLAYS).length;
  }

  function updateEstimate() {
    const a = areaBounds();
    const btn = $('btnOffDownload');
    if (!a) {
      $('offEstimate').textContent = 'Move the map over Minnesota first.';
      btn.disabled = true;
      return;
    }
    const zMax = +$('offZoom').value;
    const n = countTiles(a, zMax);
    const extra = $('offOverlays').checked ? overlayTileCount(a, zMax) * OVERLAY_AVG_KB : 0;
    const mb = Math.round((n * AVG_KB + extra) / 1024);
    if (n > MAX_TILES) {
      $('offEstimate').textContent = 'Too big (about ' + mb + ' MB). Zoom the map in, or pick a lower detail level.';
      btn.disabled = true;
    } else {
      $('offEstimate').textContent = n.toLocaleString() + ' tiles, roughly ' + Math.max(1, mb) + ' MB';
      btn.disabled = off.running;
    }
  }

  async function updateStored() {
    if (!('caches' in window)) { $('offStored').textContent = 'Offline maps need the installed/secure version of the app.'; return; }
    try {
      const c = await caches.open(TILE_CACHE);
      const keys = await c.keys();
      const topo = keys.filter((k) => k.url.includes('USGSTopo')).length;
      const sat = keys.filter((k) => k.url.includes('USGSImageryOnly')).length;
      const dnr = keys.filter((k) => k.url.includes('gis.dnr.state.mn.us')).length;
      let extra = '';
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        extra = ' · phone storage used by app: ' + Math.round((est.usage || 0) / 1048576) + ' MB';
      }
      $('offStored').textContent = 'Saved: ' + topo.toLocaleString() + ' topo, ' + sat.toLocaleString() + ' satellite, ' + dnr.toLocaleString() + ' public-land tiles' + extra;
    } catch (e) {
      $('offStored').textContent = '';
    }
  }

  const off = { running: false, abort: false };

  async function downloadArea() {
    if (!('caches' in window)) return toast('Offline maps need a secure (https) connection.');
    const a = areaBounds();
    if (!a) return;
    const src = SOURCES[$('offLayer').value];
    const zMax = +$('offZoom').value;
    if (countTiles(a, zMax) > MAX_TILES) return;

    const urls = [];
    for (let z = 8; z <= zMax; z++) {
      const r = tileRange(a, z);
      for (let x = r.x0; x <= r.x1; x++) {
        for (let y = r.y0; y <= r.y1; y++) {
          urls.push(src.url.replace('{z}', z).replace('{y}', y).replace('{x}', x));
        }
      }
    }

    if ($('offOverlays').checked) {
      // Probe first: if the DNR server won't allow its images to be saved, skip those layers cleanly.
      const ovUrls = [];
      for (const o of Object.values(OVERLAYS)) {
        for (let z = 8; z <= Math.min(zMax, OVERLAY_MAX_SAVE_ZOOM); z++) {
          const r = tileRange(a, z);
          for (let x = r.x0; x <= r.x1; x++) {
            for (let y = r.y0; y <= r.y1; y++) ovUrls.push(overlayTileUrl(o.url, z, x, y));
          }
        }
      }
      let ok = false;
      try { const probe = await fetch(ovUrls[0], { mode: 'cors' }); ok = probe.ok; } catch (e) { ok = false; }
      if (ok) urls.push(...ovUrls);
      else toast('The DNR server would not let me save its public-land layers. Saving the base map only.', 6000);
    }

    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    off.running = true;
    off.abort = false;
    $('btnOffDownload').disabled = true;
    $('btnOffCancel').hidden = false;
    const prog = $('offProgress');
    prog.hidden = false;
    prog.max = urls.length;
    prog.value = 0;

    const cache = await caches.open(TILE_CACHE);
    let done = 0, fail = 0, idx = 0;
    const worker = async () => {
      while (!off.abort) {
        const i = idx++;
        if (i >= urls.length) return;
        const u = urls[i];
        try {
          const have = await cache.match(u, { ignoreVary: true });
          if (!have) {
            const res = await fetch(u, { mode: 'cors' });
            if (res.ok) await cache.put(u, res);
            else fail++;
          }
        } catch (e) { fail++; }
        done++;
        if (done % 8 === 0 || done === urls.length) {
          prog.value = done;
          $('offStatus').textContent = 'Saved ' + done.toLocaleString() + ' of ' + urls.length.toLocaleString() + (fail ? ' (' + fail + ' failed)' : '');
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));

    prog.value = done;
    off.running = false;
    $('btnOffCancel').hidden = true;
    prog.hidden = true;
    if (off.abort) $('offStatus').textContent = 'Stopped. What was saved so far is kept.';
    else if (fail) $('offStatus').textContent = 'Done, but ' + fail + ' tiles failed. Run it again on a better connection to fill the gaps.';
    else $('offStatus').textContent = 'Done. This area now works without cell service.';
    updateEstimate();
    updateStored();
  }

  $('btnOffline').addEventListener('click', () => {
    showSheet('offlineSheet');
    if (!off.running) $('offStatus').textContent = '';
    updateEstimate();
    updateStored();
  });
  $('offZoom').addEventListener('change', updateEstimate);
  $('offOverlays').addEventListener('change', updateEstimate);
  $('btnOffDownload').addEventListener('click', downloadArea);
  $('btnOffCancel').addEventListener('click', () => { off.abort = true; });
  $('btnOffClear').addEventListener('click', async () => {
    if (!confirm('Delete all saved offline maps?')) return;
    if ('caches' in window) await caches.delete(TILE_CACHE);
    $('offStatus').textContent = 'Saved maps deleted.';
    updateStored();
  });

  // ---------- Backup, share, import ----------
  $('btnMore').addEventListener('click', () => showSheet('moreSheet'));

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  $('btnExportJson').addEventListener('click', () => {
    if (!pins.length) return toast('No pins to export yet');
    download('woods-map-pins-' + stamp() + '.json', JSON.stringify({ app: 'woods-map', pins }, null, 2), 'application/json');
  });

  function toGPX() {
    const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
    const w = pins.map((p) =>
      '  <wpt lat="' + p.lat + '" lon="' + p.lng + '">\n' +
      '    <name>' + esc(p.name) + '</name>\n' +
      '    <desc>' + esc(p.notes || '') + '</desc>\n' +
      '    <type>' + esc(p.cat) + '</type>\n' +
      '  </wpt>'
    ).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Woods Map" xmlns="http://www.topografix.com/GPX/1/1">\n' + w + '\n</gpx>\n';
  }
  $('btnExportGpx').addEventListener('click', () => {
    if (!pins.length) return toast('No pins to export yet');
    download('woods-map-pins-' + stamp() + '.gpx', toGPX(), 'application/gpx+xml');
  });

  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = (await file.text()).trim();
      let incoming = [];
      if (text.startsWith('<')) {
        const doc = new DOMParser().parseFromString(text, 'text/xml');
        incoming = Array.from(doc.getElementsByTagName('wpt')).map((w) => {
          const txt = (tag) => { const el = w.getElementsByTagName(tag)[0]; return el ? el.textContent : ''; };
          return { lat: parseFloat(w.getAttribute('lat')), lng: parseFloat(w.getAttribute('lon')), name: txt('name'), notes: txt('desc'), cat: txt('type') };
        });
      } else {
        const data = JSON.parse(text);
        incoming = Array.isArray(data) ? data : (data.pins || []);
      }
      let added = 0;
      for (const p of incoming) {
        if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
        const dup = pins.some((x) => Math.abs(x.lat - p.lat) < 1e-6 && Math.abs(x.lng - p.lng) < 1e-6 && x.name === (p.name || 'Imported pin'));
        if (dup) continue;
        const np = {
          id: newId(),
          lat: +p.lat,
          lng: +p.lng,
          name: String(p.name || 'Imported pin').slice(0, 60),
          notes: String(p.notes || '').slice(0, 500),
          cat: CATS[p.cat] ? p.cat : 'other',
          created: p.created || Date.now()
        };
        pins.push(np);
        addMarker(np);
        added++;
      }
      store(STORE.pins, pins);
      closeSheets();
      toast(added ? 'Imported ' + added + ' pin' + (added === 1 ? '' : 's') : 'Nothing new to import');
    } catch (err) {
      toast('That file could not be read.');
    }
  });

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
