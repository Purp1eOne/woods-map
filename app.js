(() => {
  'use strict';

  // ---------- Config ----------
  const MN_BOX = L.latLngBounds([43.45, -97.3], [49.45, -89.4]); // Minnesota, a little padded
  const IL_BOX = L.latLngBounds([36.9, -91.6], [42.6, -87.0]); // Illinois, a little padded
  // The map covers Minnesota and Illinois (and the land between, so you can scroll from one to the other).
  const MN = L.latLngBounds([36.9, -97.3], [49.45, -87.0]);
  const inMN = (lat, lng) => MN_BOX.contains([lat, lng]);
  const inIL = (lat, lng) => IL_BOX.contains([lat, lng]);
  const inRegion = (lat, lng) => MN.contains([lat, lng]);
  // Hunting-hour rules by place. Both states: one-half hour before sunrise to one-half hour after sunset for deer / big game.
  function rulesFor(lat, lng) {
    if (inIL(lat, lng)) return { state: 'Illinois', text: 'Illinois rules (17 Ill. Adm. Code 650.10) allow deer hunting from one-half hour before sunrise to one-half hour after sunset. Other seasons and species, such as waterfowl, turkey and furbearers, have different hours, and rules change. Check the current IDNR regulations before you hunt.' };
    return { state: 'Minnesota', text: 'Minnesota statute lets big game be taken from one-half hour before sunrise to one-half hour after sunset. Other seasons and species, such as waterfowl, have different hours, and rules change. Check the current DNR regulations before you hunt.' };
  }
  const STORE = { pins: 'woodsmap.pins.v1', view: 'woodsmap.view.v1', layer: 'woodsmap.layer.v1', overlays: 'woodsmap.overlays.v1', theme: 'woodsmap.theme.v1', pace: 'woodsmap.pace.v1', tracks: 'woodsmap.tracks.v1' };
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
      name: 'MN DNR public land (WMAs)',
      url: 'https://gis.dnr.state.mn.us/appserver/rest/services/webGDRS/bdry_dnr_wildlife_mgmt_areas_pub/MapServer',
      box: MN_BOX,
      opacity: 0.7
    },
    wia: {
      name: 'MN walk-in access (SW)',
      url: 'https://gis.dnr.state.mn.us/appserver/rest/services/webGDRS/bdry_dnr_walk_in_access_sites/MapServer',
      box: MN_BOX,
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
    stand: { label: 'Stand / blind', short: 'Stand', icon: '🦌', color: '#b5651d' },
    cam: { label: 'Trail camera', short: 'Cam', icon: '📷', color: '#455a64' },
    harvest: { label: 'Harvest', short: 'Harvest', icon: '🎯', color: '#ad1457' },
    sign: { label: 'Sign (tracks, rub, scrape)', short: 'Sign', icon: '🐾', color: '#6a1b9a' },
    camp: { label: 'Camp', short: 'Camp', icon: '⛺', color: '#2e7d32' },
    truck: { label: 'Parking / truck', short: 'Truck', icon: '🛻', color: '#1565c0' },
    water: { label: 'Water', short: 'Water', icon: '💧', color: '#0277bd' },
    other: { label: 'Other', short: 'Pin', icon: '📍', color: '#c62828' }
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

  // Walking pace (straight-line estimates only; real routes through brush and hills take longer)
  const PACES = [
    [1.5, '1.5 mph · slow, rough ground'],
    [2, '2 mph · walking in the woods'],
    [2.5, '2.5 mph · open woods'],
    [3, '3 mph · trail or field'],
    [3.5, '3.5 mph · brisk, flat trail']
  ];
  let pace = +recall(STORE.pace, 2);
  if (!PACES.some((p) => p[0] === pace)) pace = 2;
  const walkMin = (meters) => meters / (pace * 26.8224); // 1 mph = 26.8224 m/min
  function fmtTime(min) {
    if (min < 1) return 'under 1 min';
    const r = Math.round(min);
    if (r < 60) return r + ' min';
    const h = Math.floor(r / 60), m = r % 60;
    return h + ' h ' + (m < 10 ? '0' : '') + m + ' min';
  }

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
      bounds: o.box.pad(0.1),
      opacity: o.opacity,
      zIndex: 5
    });
  }
  recall(STORE.overlays, ['wma']).forEach((k) => { if (overlayLayers[k]) overlayLayers[k].addTo(map); });
  const overlayControl = {};
  for (const [key, o] of Object.entries(OVERLAYS)) overlayControl[o.name] = overlayLayers[key];
  const layerControl = L.control.layers({ 'Topo': layers.topo, 'Satellite': layers.sat, 'Street': layers.street }, overlayControl, { position: 'topright' }).addTo(map);
  const saveOverlays = () => store(STORE.overlays, Object.keys(overlayLayers).filter((k) => map.hasLayer(overlayLayers[k])));
  map.on('overlayadd', saveOverlays);
  map.on('overlayremove', saveOverlays);
  L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(map);
  map.on('baselayerchange', (e) => {
    const key = Object.keys(layers).find((k) => layers[k] === e.layer);
    if (key) store(STORE.layer, key);
    setTimeout(() => layerControl.collapse(), 150); // close the menu once a base map is picked
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

  // ---------- Sheets ----------
  const SHEETS = ['editor', 'pinsSheet', 'offlineSheet', 'moreSheet', 'measureSheet', 'sunSheet', 'trackSheet', 'gotoSheet', 'helpSheet'];
  function showSheet(id) {
    SHEETS.forEach((s) => { $(s).hidden = s !== id; });
    $('backdrop').hidden = false;
    clearTimeout(toastTimer); // a message left on screen would float over the sheet
    $('toast').hidden = true;
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
    meta.textContent = [(CATS[p.cat] || CATS.other).label, ageText(p), p.ring > 0 ? p.ring + ' yd range ring' : ''].filter(Boolean).join(' · ');
    div.appendChild(meta);
    if (me) {
      const d = document.createElement('div');
      d.className = 'pp-meta';
      d.textContent = fmtDist(dist(me, p)) + ' ' + compass(bearing(me, p)) + ' of you · about ' + fmtTime(walkMin(dist(me, p)));
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

  // Range rings and the "show only this pin type" filter
  const rings = new Map();
  let filterCat = 'all';
  const YD = 0.9144;

  function drawRing(p) {
    const old = rings.get(p.id);
    if (old) { map.removeLayer(old); rings.delete(p.id); }
    if (!(p.ring > 0)) return;
    const c = (CATS[p.cat] || CATS.other).color;
    rings.set(p.id, L.circle([p.lat, p.lng], {
      radius: p.ring * YD, color: c, weight: 2, dashArray: '6 6', fillColor: c, fillOpacity: 0.07, interactive: false
    }));
  }
  function syncVisibility(p) {
    const show = filterCat === 'all' || p.cat === filterCat;
    [markers.get(p.id), rings.get(p.id)].forEach((l) => {
      if (!l) return;
      if (show && !map.hasLayer(l)) l.addTo(map);
      if (!show && map.hasLayer(l)) map.removeLayer(l);
    });
  }

  function addMarker(p) {
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(p.cat), title: p.name });
    m.bindPopup(() => popupFor(p));
    markers.set(p.id, m);
    drawRing(p);
    syncVisibility(p);
  }
  function refreshMarker(p) {
    const m = markers.get(p.id);
    if (!m) return addMarker(p);
    m.setIcon(pinIcon(p.cat));
    m.setLatLng([p.lat, p.lng]);
    drawRing(p);
    syncVisibility(p);
  }
  function removeMarker(id) {
    const m = markers.get(id);
    if (m) { map.removeLayer(m); markers.delete(id); }
    const r = rings.get(id);
    if (r) { map.removeLayer(r); rings.delete(id); }
  }
  pins.forEach(addMarker);

  function openEditor(p, isNew) {
    editing = { p, isNew };
    $('editorTitle').textContent = isNew ? 'New pin' : 'Edit pin';
    $('pinName').value = p.name || '';
    $('pinCat').value = CATS[p.cat] ? p.cat : 'stand';
    $('pinNotes').value = p.notes || '';
    $('pinRing').value = String(p.ring || 0);
    $('pinDate').value = p.date || '';
    syncDateField(isNew);
    $('pinCoords').textContent = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
    $('btnPinDelete').hidden = isNew;
    showSheet('editor');
    setTimeout(() => $('pinName').focus(), 60);
  }

  $('btnPinSave').addEventListener('click', () => {
    if (!editing) return;
    const { p, isNew } = editing;
    p.cat = $('pinCat').value;
    p.name = $('pinName').value.trim() || (CATS[p.cat].short + ' ' + (pins.length + (isNew ? 1 : 0)));
    p.notes = $('pinNotes').value.trim();
    p.ring = +$('pinRing').value || 0;
    p.date = (p.cat === 'cam' || p.cat === 'harvest') ? $('pinDate').value : '';
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

  // Pin at the phone's own location. The map only covers Minnesota, so warn if you're elsewhere.
  function pinHere(lat, lng) {
    if (!MN.contains([lat, lng]) && !confirm('You are outside the map area (Minnesota and Illinois), so this pin will not show on the map. Save it anyway?')) {
      toast('Not saved. To mark a spot in Minnesota or Illinois, move the map there and use Pin center.', 5000);
      return;
    }
    openEditor({ lat, lng, cat: 'stand', name: '', notes: '' }, true);
  }

  $('btnPinMe').addEventListener('click', () => {
    if (!('geolocation' in navigator)) return toast('GPS is not available on this device');
    if (me && Date.now() - me.t < 20000) {
      return pinHere(me.lat, me.lng);
    }
    toast('Getting GPS fix…', 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        toast('Got it', 800);
        pinHere(pos.coords.latitude, pos.coords.longitude);
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
    const items = pins.filter((p) => (filterCat === 'all' || p.cat === filterCat) &&
      (!q || ((p.name || '') + ' ' + (p.notes || '')).toLowerCase().includes(q)));
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
      b.className = 'rowmain';
      const ic = document.createElement('span');
      ic.className = 'pi';
      ic.textContent = c.icon;
      const txt = document.createElement('span');
      const t = document.createElement('span');
      t.className = 'pt';
      t.textContent = p.name;
      const s = document.createElement('span');
      s.className = 'ps';
      const outside = !MN.contains([p.lat, p.lng]);
      s.textContent = [c.label, ageText(p), outside ? 'outside the map' : '', me ? fmtDist(dist(me, p)) + ' ' + compass(bearing(me, p)) : ''].filter(Boolean).join(' · ');
      txt.append(t, s);
      b.append(ic, txt);
      b.addEventListener('click', () => {
        if (outside) {
          return toast('That pin is outside the map area, so it cannot be shown on the map. Use Edit to change or delete it.', 5000);
        }
        closeSheets();
        map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
        const m = markers.get(p.id);
        if (m) setTimeout(() => m.openPopup(), 850);
      });
      const ed = document.createElement('button');
      ed.className = 'rowedit';
      ed.textContent = 'Edit';
      ed.addEventListener('click', () => openEditor(p, false));
      li.append(b, ed);
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
    addTrackPoint(lat, lng, accuracy);
    if (!firstFix) { firstFix = true; updateSunChip(); }
    if (pendingTruck) { pendingTruck = false; goTruck(); }
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
    $('navtext').textContent = target.name + ' · ' + fmtDist(d) + ' · about ' + fmtTime(walkMin(d)) + ' · ' + compass(bearing(me, target)) + ' ' + Math.round(bearing(me, target)) + '°';
    const pts = [[me.lat, me.lng], [target.lat, target.lng]];
    if (!navLine) navLine = L.polyline(pts, { color: '#e8b53a', weight: 4, dashArray: '8 8', interactive: false }).addTo(map);
    else navLine.setLatLngs(pts);
  }
  $('navStop').addEventListener('click', () => setTarget(null));

  // ---------- Walking pace + measure between two points ----------
  function fillPace(sel) {
    for (const [v, label] of PACES) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = String(pace);
  }
  fillPace($('pace'));
  fillPace($('mPace'));
  function setPace(v) {
    pace = +v;
    store(STORE.pace, pace);
    $('pace').value = String(pace);
    $('mPace').value = String(pace);
    updateNav();
    if (!$('measureSheet').hidden) updateMeasure();
  }
  $('pace').addEventListener('change', (e) => setPace(e.target.value));
  $('mPace').addEventListener('change', (e) => setPace(e.target.value));

  let measureLine = null;
  function pointFor(val) {
    if (val === 'me') return me ? { lat: me.lat, lng: me.lng, label: 'My location' } : null;
    if (val === 'center') { const c = map.getCenter(); return { lat: c.lat, lng: c.lng, label: 'Map center' }; }
    const p = pins.find((x) => x.id === val);
    return p ? { lat: p.lat, lng: p.lng, label: p.name } : null;
  }
  function fillMeasureOptions() {
    const sorted = pins.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    for (const id of ['mFrom', 'mTo']) {
      const sel = $(id);
      const prev = sel.value;
      sel.replaceChildren();
      const add = (value, label, disabled) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        if (disabled) o.disabled = true;
        sel.appendChild(o);
      };
      add('me', me ? 'My location' : 'My location (no GPS fix yet)', !me);
      add('center', 'Map center (crosshair)');
      sorted.forEach((p) => add(p.id, (CATS[p.cat] || CATS.other).icon + '  ' + p.name));
      const valid = Array.from(sel.options).some((o) => o.value === prev && !o.disabled);
      if (valid) sel.value = prev;
      else if (id === 'mFrom') sel.value = me ? 'me' : 'center';
      else sel.value = sorted.length ? sorted[0].id : 'center';
    }
  }
  function updateMeasure() {
    const a = pointFor($('mFrom').value), b = pointFor($('mTo').value);
    const out = $('mResult');
    if (!a || !b) { out.textContent = 'Pick two points.'; return null; }
    const d = dist(a, b);
    if (d < 1) { out.textContent = 'Those are the same spot.'; return null; }
    const br = bearing(a, b);
    out.textContent = fmtDist(d) + ' · about ' + fmtTime(walkMin(d)) + ' · heading ' + compass(br) + ' ' + Math.round(br) + '°';
    return { a, b, text: out.textContent };
  }
  $('btnMeasure').addEventListener('click', () => {
    fillMeasureOptions();
    updateMeasure();
    showSheet('measureSheet');
  });
  $('mFrom').addEventListener('change', updateMeasure);
  $('mTo').addEventListener('change', updateMeasure);
  $('btnMShow').addEventListener('click', () => {
    const r = updateMeasure();
    if (!r) return;
    if (measureLine) map.removeLayer(measureLine);
    measureLine = L.polyline([[r.a.lat, r.a.lng], [r.b.lat, r.b.lng]], { color: '#00897b', weight: 4, dashArray: '2 8', interactive: false }).addTo(map);
    closeSheets();
    map.fitBounds(measureLine.getBounds().pad(0.35), { maxZoom: 17 });
    toast(r.a.label + ' to ' + r.b.label + ': ' + r.text, 7000);
  });
  $('btnMClear').addEventListener('click', () => {
    if (measureLine) { map.removeLayer(measureLine); measureLine = null; }
    toast('Line cleared');
  });
  $('btnMClose').addEventListener('click', closeSheets);

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
      $('offEstimate').textContent = 'Move the map over Minnesota or Illinois first.';
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
        if (!o.box.intersects(L.latLngBounds([a.s, a.w], [a.n, a.e]))) continue;
        for (let z = 8; z <= Math.min(zMax, OVERLAY_MAX_SAVE_ZOOM); z++) {
          const r = tileRange(a, z);
          for (let x = r.x0; x <= r.x1; x++) {
            for (let y = r.y0; y <= r.y1; y++) ovUrls.push(overlayTileUrl(o.url, z, x, y));
          }
        }
      }
      let ok = false;
      if (!ovUrls.length) ok = true;
      else try { const probe = await fetch(ovUrls[0], { mode: 'cors' }); ok = probe.ok; } catch (e) { ok = false; }
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
          ring: [30, 50, 100, 150, 200].includes(+p.ring) ? +p.ring : 0,
          date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : '',
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

  // ---------- Dates ----------
  const CHI = 'America/Chicago'; // Minnesota and Illinois are both on Central time
  const chiDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: CHI, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  function daysSince(ymd) {
    const a = Date.parse(ymd + 'T00:00:00Z'), b = Date.parse(chiDate() + 'T00:00:00Z');
    return isFinite(a) ? Math.round((b - a) / 86400000) : null;
  }
  function ageText(p) {
    if (!p.date) return '';
    if (p.cat === 'cam') {
      const n = daysSince(p.date);
      return n === null ? '' : 'checked ' + (n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago');
    }
    if (p.cat === 'harvest') {
      return new Date(p.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }
    return '';
  }
  function syncDateField(prefill) {
    const cat = $('pinCat').value;
    const show = cat === 'cam' || cat === 'harvest';
    $('pinDateWrap').hidden = !show;
    $('pinDateLabel').textContent = cat === 'harvest' ? 'Harvest date' : 'Last checked';
    if (show && prefill && !$('pinDate').value) $('pinDate').value = chiDate();
  }
  $('pinCat').addEventListener('change', () => syncDateField(editing ? editing.isNew : false));

  // Range ring choices
  for (const [v, label] of [[0, 'None'], [30, '30 yards (bow)'], [50, '50 yards'], [100, '100 yards'], [150, '150 yards'], [200, '200 yards']]) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = label;
    $('pinRing').appendChild(o);
  }

  // ---------- Sunrise, sunset, shooting hours (computed on the phone, no signal needed) ----------
  function sunTimes(y, m, d, lat, lng) {
    const rad = Math.PI / 180;
    const jd = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5;
    const n = Math.round(jd - 2451545.0);
    const Js = n - lng / 360;
    const M = (357.5291 + 0.98560028 * Js) % 360;
    const Mr = M * rad;
    const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
    const lam = ((M + C + 180 + 102.9372) % 360) * rad;
    const Jt = 2451545.0 + Js + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lam);
    const sinD = Math.sin(lam) * Math.sin(23.4397 * rad);
    const D = Math.asin(sinD);
    const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinD) / (Math.cos(lat * rad) * Math.cos(D));
    if (cosW > 1 || cosW < -1) return null;
    const w = Math.acos(cosW) / rad;
    const toDate = (J) => new Date((J - 2440587.5) * 86400000);
    return { rise: toDate(Jt - w / 360), set: toDate(Jt + w / 360) };
  }
  const fmtClock = (d) => d.toLocaleTimeString('en-US', { timeZone: CHI, hour: 'numeric', minute: '2-digit' });
  const shortClock = (d) => fmtClock(d).replace(/\s?AM/, 'a').replace(/\s?PM/, 'p');

  function sunInfo(ymd) {
    const fresh = me && Date.now() - me.t < 600000;
    const c = map.getCenter();
    const pt = fresh ? { lat: me.lat, lng: me.lng, where: 'your location' } : { lat: c.lat, lng: c.lng, where: 'the map center' };
    const [y, m, d] = ymd.split('-').map(Number);
    const t = sunTimes(y, m, d, pt.lat, pt.lng);
    if (!t) return null;
    return { lat: pt.lat, lng: pt.lng, rise: t.rise, set: t.set, first: new Date(+t.rise - 1800000), last: new Date(+t.set + 1800000), where: pt.where };
  }
  function updateSunChip() {
    const info = sunInfo(chiDate());
    $('sunChip').textContent = info ? '☀ ' + shortClock(info.rise) + ' – ' + shortClock(info.set) : '☀ —';
  }
  function fillSun() {
    const ymd = $('sunDate').value || chiDate();
    const info = sunInfo(ymd);
    if (!info) { $('sunWhere').textContent = 'No sunrise or sunset to show for that date.'; return; }
    $('sunWhere').textContent = 'Times for ' + info.where + '. They shift about 4 minutes for every degree you move east or west.';
    $('sunRules').textContent = rulesFor(info.lat, info.lng).text;
    $('sunFirst').textContent = fmtClock(info.first);
    $('sunRise').textContent = fmtClock(info.rise);
    $('sunSet').textContent = fmtClock(info.set);
    $('sunLast').textContent = fmtClock(info.last);
    const mins = Math.round((info.set - info.rise) / 60000);
    $('sunLen').textContent = Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
  }
  $('sunChip').addEventListener('click', () => { $('sunDate').value = chiDate(); fillSun(); showSheet('sunSheet'); });
  $('sunDate').addEventListener('change', fillSun);
  $('btnSunClose').addEventListener('click', closeSheets);
  let firstFix = false;
  map.on('moveend', updateSunChip);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateSunChip(); });
  updateSunChip();

  // ---------- Track recording ----------
  let tracks = recall(STORE.tracks, []);
  tracks.forEach((t) => {
    if (!t.end) t.end = t.pts.length ? t.pts[t.pts.length - 1][2] * 1000 : t.start;
    if (typeof t.meters !== 'number') {
      t.meters = 0;
      for (let i = 1; i < t.pts.length; i++) t.meters += dist({ lat: t.pts[i - 1][0], lng: t.pts[i - 1][1] }, { lat: t.pts[i][0], lng: t.pts[i][1] });
    }
  });
  let rec = null;
  let wakeLock = null;
  const trackLines = new Map();
  const saveTracks = () => store(STORE.tracks, tracks);
  const fmtDur = (ms) => {
    const m = Math.round(ms / 60000);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  };

  function showTrack(t, active) {
    const ll = t.pts.map((p) => [p[0], p[1]]);
    let l = trackLines.get(t.id);
    if (!l) {
      l = L.polyline(ll, { color: active ? '#d84315' : '#ef6c00', weight: 4, opacity: 0.9, interactive: false }).addTo(map);
      trackLines.set(t.id, l);
    } else l.setLatLngs(ll);
  }
  function hideTrack(id) {
    const l = trackLines.get(id);
    if (l) { map.removeLayer(l); trackLines.delete(id); }
  }

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }
  function releaseAwake() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (rec && document.visibilityState === 'visible') keepAwake();
    if (rec && document.visibilityState === 'hidden') saveTracks();
  });

  function startTrack() {
    if (!('geolocation' in navigator)) return toast('GPS is not available on this device');
    const name = 'Walk ' + new Date().toLocaleString('en-US', { timeZone: CHI, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    rec = { id: newId(), name, start: Date.now(), end: null, pts: [], meters: 0 };
    tracks.unshift(rec);
    showTrack(rec, true);
    startGPS();
    keepAwake();
    if (me && Date.now() - me.t < 15000) addTrackPoint(me.lat, me.lng, me.acc);
    saveTracks();
    updateTrackUI();
    toast('Recording. Keep the screen on and the app open.', 4500);
  }
  function stopTrack() {
    if (!rec) return;
    const t = rec;
    rec = null;
    releaseAwake();
    t.end = Date.now();
    hideTrack(t.id);
    if (t.pts.length < 2) {
      tracks = tracks.filter((x) => x !== t);
      toast('That walk was too short to save.');
    } else {
      showTrack(t, false);
      toast('Saved ' + fmtDist(t.meters) + ' in ' + fmtDur(t.end - t.start));
    }
    saveTracks();
    updateTrackUI();
    if (!$('trackSheet').hidden) renderTrackList();
  }
  function addTrackPoint(lat, lng, acc) {
    if (!rec || acc > 35) return;
    const last = rec.pts[rec.pts.length - 1];
    if (last) {
      const d = dist({ lat: last[0], lng: last[1] }, { lat, lng });
      if (d < Math.max(6, acc / 2)) return;
      rec.meters += d;
    }
    rec.pts.push([+lat.toFixed(5), +lng.toFixed(5), Math.round(Date.now() / 1000)]);
    const l = trackLines.get(rec.id);
    if (l) l.addLatLng([lat, lng]);
    if (rec.pts.length % 10 === 0) saveTracks();
    if (rec.pts.length >= 20000) { toast('Track is full, so recording stopped.'); stopTrack(); return; }
    updateTrackUI();
  }
  function updateTrackUI() {
    $('fabTrack').classList.toggle('rec', !!rec);
    $('fabTrackLbl').textContent = rec ? fmtDist(rec.meters) : 'Track';
    $('btnTrkToggle').textContent = rec ? 'Stop recording' : 'Start recording';
    $('btnTrkToggle').classList.toggle('danger', !!rec);
    $('btnTrkToggle').classList.toggle('primary', !rec);
    if (!$('trackSheet').hidden) {
      $('trkStatus').textContent = rec
        ? 'Recording · ' + fmtDist(rec.meters) + ' · ' + fmtDur(Date.now() - rec.start) + ' · ' + rec.pts.length + ' points'
        : 'Not recording';
    }
  }
  function renderTrackList() {
    const ul = $('trkList');
    ul.replaceChildren();
    const done = tracks.filter((t) => t !== rec);
    if (!done.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'No saved walks yet.';
      ul.appendChild(li);
      return;
    }
    for (const t of done) {
      const li = document.createElement('li');
      const info = document.createElement('span');
      info.className = 'trkinfo';
      const a = document.createElement('span');
      a.className = 'pt';
      a.textContent = t.name;
      const b = document.createElement('span');
      b.className = 'ps';
      b.textContent = fmtDist(t.meters) + ' · ' + fmtDur(t.end - t.start);
      info.append(a, b);
      const show = document.createElement('button');
      show.textContent = trackLines.has(t.id) ? 'Hide' : 'Show';
      show.addEventListener('click', () => {
        if (trackLines.has(t.id)) { hideTrack(t.id); }
        else {
          showTrack(t, false);
          const l = trackLines.get(t.id);
          if (l && t.pts.length > 1) { closeSheets(); map.fitBounds(l.getBounds().pad(0.2), { maxZoom: 17 }); return; }
        }
        renderTrackList();
      });
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = 'Delete';
      del.addEventListener('click', () => {
        if (!confirm('Delete "' + t.name + '"?')) return;
        hideTrack(t.id);
        tracks = tracks.filter((x) => x !== t);
        saveTracks();
        renderTrackList();
      });
      li.append(info, show, del);
      ul.appendChild(li);
    }
  }
  function openTrackSheet() {
    showSheet('trackSheet');
    updateTrackUI();
    renderTrackList();
    $('trkStatus').textContent = rec
      ? 'Recording · ' + fmtDist(rec.meters) + ' · ' + fmtDur(Date.now() - rec.start) + ' · ' + rec.pts.length + ' points'
      : 'Not recording';
  }
  $('fabTrack').addEventListener('click', openTrackSheet);
  $('btnTrkToggle').addEventListener('click', () => { if (rec) stopTrack(); else startTrack(); });
  $('btnTrkClose').addEventListener('click', closeSheets);
  const escXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  $('btnTrkGpx').addEventListener('click', () => {
    const done = tracks.filter((t) => t !== rec && t.pts.length > 1);
    if (!done.length) return toast('No saved walks to export yet');
    const body = done.map((t) =>
      '  <trk>\n    <name>' + escXml(t.name) + '</name>\n    <trkseg>\n' +
      t.pts.map((p) => '      <trkpt lat="' + p[0] + '" lon="' + p[1] + '"><time>' + new Date(p[2] * 1000).toISOString() + '</time></trkpt>').join('\n') +
      '\n    </trkseg>\n  </trk>').join('\n');
    download('woods-map-tracks-' + stamp() + '.gpx',
      '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Woods Map" xmlns="http://www.topografix.com/GPX/1/1">\n' + body + '\n</gpx>\n',
      'application/gpx+xml');
  });
  updateTrackUI();

  // ---------- Back to truck ----------
  let pendingTruck = false;
  function goTruck() {
    const trucks = pins.filter((p) => p.cat === 'truck');
    if (!trucks.length) return toast('Add a pin with the type "Parking / truck" first. Then this button leads you back to it.', 5500);
    if (!me || (watchId === null && Date.now() - me.t > 120000)) {
      pendingTruck = true;
      startGPS();
      return toast('Finding you…', 3000);
    }
    let best = trucks[0], bd = dist(me, best);
    for (const p of trucks) { const d = dist(me, p); if (d < bd) { best = p; bd = d; } }
    setTarget(best.id);
    try { map.fitBounds([[me.lat, me.lng], [best.lat, best.lng]], { padding: [70, 70], maxZoom: 17 }); } catch (e) { /* location outside the map area */ }
    toast('Heading to ' + best.name + ': ' + fmtDist(bd) + ', about ' + fmtTime(walkMin(bd)), 5000);
  }
  $('fabTruck').addEventListener('click', goTruck);
  // ---------- Go to coordinates ----------
  const ddm = (v, pos, neg) => {
    const a = Math.abs(v), d = Math.floor(a);
    return (v >= 0 ? pos : neg) + ' ' + d + '° ' + ((a - d) * 60).toFixed(3) + '′';
  };
  function parseCoords(str) {
    const letters = str.toUpperCase().match(/[NSEW]/g) || [];
    const nums = str.replace(/[A-Za-z]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
    if (![2, 4, 6].includes(nums.length)) return null;
    const per = nums.length / 2;
    const conv = (arr) => {
      const neg = arr[0].startsWith('-');
      const v = Math.abs(+arr[0]) + (arr[1] ? Math.abs(+arr[1]) / 60 : 0) + (arr[2] ? Math.abs(+arr[2]) / 3600 : 0);
      return neg ? -v : v;
    };
    let lat = conv(nums.slice(0, per)), lng = conv(nums.slice(per));
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
    if (letters.includes('S')) lat = -Math.abs(lat);
    if (letters.includes('W')) lng = -Math.abs(lng);
    // The map only covers the Midwest, so a longitude typed without a minus sign means west.
    if (!letters.includes('E') && !letters.includes('W') && lng > 0 && lng < 100) lng = -lng;
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  }
  function openGoto() {
    const c = map.getCenter();
    $('gcCur').textContent = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + '\n' + ddm(c.lat, 'N', 'S') + '   ' + ddm(c.lng, 'E', 'W');
    $('gcInput').value = '';
    $('gcMsg').textContent = '';
    showSheet('gotoSheet');
  }
  function gotoFromInput() {
    const pt = parseCoords($('gcInput').value);
    if (!pt) { $('gcMsg').textContent = 'Could not read that. Try 46.3045, -94.2001 or N 46° 18.270 W 94° 12.006'; return null; }
    if (!MN.contains([pt.lat, pt.lng])) { $('gcMsg').textContent = 'That spot is outside the map. It covers Minnesota and Illinois.'; return null; }
    map.setView([pt.lat, pt.lng], Math.max(map.getZoom(), 16));
    return pt;
  }
  $('coords').addEventListener('click', openGoto);
  $('btnGcCopy').addEventListener('click', () => {
    const c = map.getCenter();
    const txt = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5);
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Copied ' + txt), () => toast('Could not copy. Select the numbers by hand.'));
    else toast('Could not copy. Select the numbers by hand.');
  });
  $('btnGcGo').addEventListener('click', () => { if (gotoFromInput()) closeSheets(); });
  $('btnGcPin').addEventListener('click', () => {
    const pt = gotoFromInput();
    if (pt) openEditor({ lat: pt.lat, lng: pt.lng, cat: 'stand', name: '', notes: '' }, true);
  });
  $('btnGcClose').addEventListener('click', closeSheets);
  $('gcInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('btnGcGo').click(); } });

  // ---------- Pin type filter ----------
  {
    const sel = $('pinFilter');
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'All pin types';
    sel.appendChild(all);
    for (const [k, c] of Object.entries(CATS)) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = c.icon + '  ' + c.label;
      sel.appendChild(o);
    }
  }
  function applyFilter() {
    pins.forEach(syncVisibility);
    const chip = $('filterChip');
    chip.hidden = filterCat === 'all';
    if (filterCat !== 'all') chip.textContent = 'Showing only: ' + CATS[filterCat].label + '  ✕';
  }
  $('pinFilter').addEventListener('change', (e) => { filterCat = e.target.value; applyFilter(); renderList(); });
  $('filterChip').addEventListener('click', () => { filterCat = 'all'; $('pinFilter').value = 'all'; applyFilter(); renderList(); });

  // ---------- Theme ----------
  let theme = recall(STORE.theme, 'dark');
  if (!['dark', 'light', 'auto'].includes(theme)) theme = 'dark';
  function applyTheme() {
    const root = document.documentElement;
    if (theme === 'dark') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const bar = getComputedStyle(root).getPropertyValue('--bg').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && bar) meta.setAttribute('content', bar);
  }
  for (const [v, label] of [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match my phone']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    $('theme').appendChild(o);
  }
  $('theme').value = theme;
  $('theme').addEventListener('change', (e) => { theme = e.target.value; store(STORE.theme, theme); applyTheme(); });
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const again = () => { if (theme === 'auto') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', again); else if (mq.addListener) mq.addListener(again);
  }
  applyTheme();

  // ---------- Help ----------
  $('btnHelp').addEventListener('click', () => { showSheet('helpSheet'); $('helpSheet').scrollTop = 0; });
  $('btnHelpClose').addEventListener('click', closeSheets);
  try {
    if (!localStorage.getItem('woodsmap.seen.v1')) {
      localStorage.setItem('woodsmap.seen.v1', '1');
      setTimeout(() => toast('New here? Tap More, then "How to use this app".', 7000), 1200);
    }
  } catch (e) { /* storage unavailable: skip the hint */ }

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
