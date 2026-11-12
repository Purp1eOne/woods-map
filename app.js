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
  const STORE = { pins: 'woodsmap.pins.v1', view: 'woodsmap.view.v1', layer: 'woodsmap.layer.v1', overlays: 'woodsmap.overlays.v1', theme: 'woodsmap.theme.v1', pace: 'woodsmap.pace.v1', tracks: 'woodsmap.tracks.v1', shapes: 'woodsmap.shapes.v1', snap: 'woodsmap.snap.v1', hiddenTypes: 'woodsmap.hiddenTypes.v1', hiddenGroups: 'woodsmap.hiddenGroups.v1', dpa: 'woodsmap.dpa.v1' };
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
    hybrid: {
      // Satellite with the US Topo map's trails, roads, water, names and faint contours on top.
      // Same trails as the Topo map (the separate USGS trails service is missing many of them).
      name: 'Hybrid',
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
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

  const PARCEL_URL = 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/MapServer';
  const PARCEL_WHERE = "co_name IN ('Becker','Otter Tail')";
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
    },
    // Parcel lines from MnGeo's open parcels service (counties that publish their parcels openly),
    // limited to Becker and Otter Tail and drawn as yellow outlines with no fill.
    parcels: {
      name: 'Parcel lines (Becker, Otter Tail)',
      url: PARCEL_URL,
      box: L.latLngBounds([46.08, -96.34], [47.18, -95.12]),
      opacity: 1,
      minZoom: 13,
      attr: 'Parcels: MnGeo, Becker & Otter Tail counties',
      params: '&dynamicLayers=' + encodeURIComponent(JSON.stringify([{
        id: 0,
        source: { type: 'mapLayer', mapLayerId: 0 },
        definitionExpression: PARCEL_WHERE,
        drawingInfo: { renderer: { type: 'simple', symbol: { type: 'esriSFS', style: 'esriSFSNull', outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [255, 214, 0, 255], width: 1.5 } } } }
      }]))
    }
  };
  const OVERLAY_MAX_SAVE_ZOOM = 15; // keep load on the state server reasonable
  const OVERLAY_AVG_KB = 3;
  const MERC = 20037508.342789244;
  function overlayTileUrl(o, z, x, y) {
    const res = (MERC * 2) / Math.pow(2, z);
    const x0 = -MERC + x * res;
    const y1 = MERC - y * res;
    const f = (n) => n.toFixed(3);
    // layers=show:0 is required: the WMA layer is switched off by default on the server.
    return o.url + '/export?bbox=' + [f(x0), f(y1 - res), f(x0 + res), f(y1)].join(',') +
      '&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true' + (o.params || '&layers=show:0') + '&f=image';
  }

  // Pin types, grouped by section in the editor's Type list. Keys are saved with each pin, so never rename one.
  const CATS = {
    stand: { sec: 'Stands & hunting', label: 'Tree stand', short: 'Stand', icon: '🪜', color: '#b5651d' },
    blind: { sec: 'Stands & hunting', label: 'Ground blind', short: 'Blind', icon: '🛖', color: '#8d6e63' },
    glass: { sec: 'Stands & hunting', label: 'Glassing spot', short: 'Glass', icon: '🔭', color: '#5d4037' },
    cam: { sec: 'Stands & hunting', label: 'Trail camera', short: 'Cam', icon: '📷', color: '#455a64' },
    harvest: { sec: 'Stands & hunting', label: 'Harvest', short: 'Harvest', icon: '🎯', color: '#ad1457' },
    buck: { sec: 'Deer sign', label: 'Buck sighting', short: 'Buck', icon: '🦌', color: '#6d4c41' },
    doe: { sec: 'Deer sign', label: 'Doe / deer sighting', short: 'Deer', icon: '👀', color: '#8e6c4a' },
    scrape: { sec: 'Deer sign', label: 'Scrape', short: 'Scrape', icon: '🍂', color: '#bf360c' },
    rub: { sec: 'Deer sign', label: 'Rub', short: 'Rub', icon: '🌲', color: '#33691e' },
    bed: { sec: 'Deer sign', label: 'Bedding area', short: 'Bed', icon: '🛏️', color: '#7b1fa2' },
    trail: { sec: 'Deer sign', label: 'Deer trail', short: 'Trail', icon: '👣', color: '#795548' },
    funnel: { sec: 'Deer sign', label: 'Funnel / crossing', short: 'Funnel', icon: '⏳', color: '#4e342e' },
    shed: { sec: 'Deer sign', label: 'Shed antler', short: 'Shed', icon: '🦴', color: '#9e9d24' },
    sign: { sec: 'Deer sign', label: 'Other sign (tracks, droppings)', short: 'Sign', icon: '🐾', color: '#6a1b9a' },
    food: { sec: 'Food & water', label: 'Food plot / field', short: 'Food', icon: '🌱', color: '#558b2f' },
    mast: { sec: 'Food & water', label: 'Acorns / mast tree', short: 'Mast', icon: '🌰', color: '#a1662f' },
    water: { sec: 'Food & water', label: 'Water', short: 'Water', icon: '💧', color: '#0277bd' },
    turkey: { sec: 'Other game', label: 'Turkey / roost', short: 'Turkey', icon: '🦃', color: '#c2185b' },
    duck: { sec: 'Other game', label: 'Ducks / geese', short: 'Ducks', icon: '🦆', color: '#00796b' },
    game: { sec: 'Other game', label: 'Other game', short: 'Game', icon: '🐇', color: '#827717' },
    truck: { sec: 'Access & camp', label: 'Parking / truck', short: 'Truck', icon: '🛻', color: '#1565c0' },
    gate: { sec: 'Access & camp', label: 'Gate', short: 'Gate', icon: '🚧', color: '#f57f17' },
    entry: { sec: 'Access & camp', label: 'Entry / exit route', short: 'Entry', icon: '🚶', color: '#283593' },
    camp: { sec: 'Access & camp', label: 'Camp', short: 'Camp', icon: '⛺', color: '#2e7d32' },
    corner: { sec: 'Access & camp', label: 'Property line / corner', short: 'Corner', icon: '🚩', color: '#d32f2f' },
    hazard: { sec: 'Access & camp', label: 'Hazard', short: 'Hazard', icon: '⚠️', color: '#e65100' },
    other: { sec: 'Access & camp', label: 'Other', short: 'Pin', icon: '📍', color: '#c62828' }
  };
  // Pin colors (like onX): a pin can use its type's color or one of these. Sort spots by year, hunter, or anything.
  const PIN_COLORS = [
    ['#c62828', 'Red'], ['#ef6c00', 'Orange'], ['#f9a825', 'Yellow'], ['#2e7d32', 'Green'], ['#00897b', 'Teal'],
    ['#1565c0', 'Blue'], ['#6a1b9a', 'Purple'], ['#d81b60', 'Pink'], ['#6d4c41', 'Brown'], ['#212121', 'Black'], ['#eeeeee', 'White']
  ];
  const pinColor = (p) => (PIN_COLORS.some(([c]) => c === p.color) ? p.color : (CATS[p.cat] || CATS.other).color);

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

  const baseTiles = (s) => L.tileLayer(s.url, {
    attribution: s.attr,
    maxNativeZoom: s.maxNative,
    maxZoom: 18,
    bounds: MN.pad(0.1),
    crossOrigin: true
  });
  const layers = {};
  for (const [key, s] of Object.entries(SOURCES)) layers[key] = baseTiles(s);

  // "Satellite + trails": the clean satellite photo with only the orange trail lines copied on
  // from the Hybrid (Imagery Topo) image of the same square. Hybrid also tints public land white
  // and adds names and contours; this keeps the photo untouched. Both images come from the same
  // USGS server, so the service worker caches both and offline saves include both.
  const TRAIL_PARTS = ['sat', 'hybrid'];
  const tileUrl = (key, z, x, y) => SOURCES[key].url.replace('{z}', z).replace('{y}', y).replace('{x}', x);
  const isTrailPixel = (r, g, b) => r > 170 && r - g > 45 && r - b > 70; // the US Topo trail orange
  // Make everything transparent except trail lines. Trail names use the same orange, so orange
  // pixels are grouped into connected shapes and small ones (letters) are dropped. A shape that
  // touches the tile edge may be a trail cut off by the edge, so it only needs to be a little longer.
  const TRAIL_MIN_PX = 40, TRAIL_MIN_EDGE_PX = 8;
  function keepTrailLines(d) {
    const W = 256, N = W * W;
    const mask = new Uint8Array(N); // 1 = orange, 2 = already grouped
    for (let i = 0; i < N; i++) if (isTrailPixel(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) mask[i] = 1;
    const keep = new Uint8Array(N);
    const comp = new Int32Array(N);
    for (let start = 0; start < N; start++) {
      if (mask[start] !== 1) continue;
      let len = 0, top = 0, edge = false;
      comp[len++] = start; mask[start] = 2;
      while (top < len) { // flood fill, 8 neighbours; comp doubles as the queue
        const j = comp[top++], x = j % W, y = (j - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === W - 1) edge = true;
        for (let oy = -1; oy <= 1; oy++) {
          const ny = y + oy;
          if (ny < 0 || ny >= W) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            if (nx < 0 || nx >= W) continue;
            const k = ny * W + nx;
            if (mask[k] === 1) { mask[k] = 2; comp[len++] = k; }
          }
        }
      }
      if (len >= (edge ? TRAIL_MIN_EDGE_PX : TRAIL_MIN_PX)) for (let n = 0; n < len; n++) keep[comp[n]] = 1;
    }
    for (let i = 0; i < N; i++) if (!keep[i]) d[i * 4 + 3] = 0;
  }
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  const TrailBlend = L.GridLayer.extend({
    createTile(c, done) {
      const tile = document.createElement('canvas');
      tile.width = tile.height = 256;
      Promise.allSettled([loadImg(tileUrl('sat', c.z, c.x, c.y)), loadImg(tileUrl('hybrid', c.z, c.x, c.y))]).then(([sat, topo]) => {
        if (sat.status !== 'fulfilled') return done(new Error('no satellite tile'), tile);
        const ctx = tile.getContext('2d');
        ctx.drawImage(sat.value, 0, 0);
        if (topo.status === 'fulfilled') try {
          // Keep only the trail pixels from the Hybrid image, on a transparent sheet.
          const sheet = document.createElement('canvas');
          sheet.width = sheet.height = 256;
          const sctx = sheet.getContext('2d', { willReadFrequently: true });
          sctx.drawImage(topo.value, 0, 0);
          const px = sctx.getImageData(0, 0, 256, 256);
          keepTrailLines(px.data);
          sctx.putImageData(px, 0, 0);
          // Draw it a few times, nudged by a pixel, to make the lines thicker and easier to see.
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) ctx.drawImage(sheet, dx, dy);
        } catch (e) { /* image couldn't be read: show plain satellite for this square */ }
        done(null, tile);
      });
      return tile;
    }
  });
  layers.trails = new TrailBlend({
    attribution: SOURCES.sat.attr,
    maxNativeZoom: SOURCES.sat.maxNative,
    maxZoom: 18,
    bounds: MN.pad(0.1)
  });

  const startLayer = recall(STORE.layer, 'topo');
  (layers[startLayer] || layers.topo).addTo(map);
  const ArcExport = L.TileLayer.extend({
    getTileUrl(c) { return overlayTileUrl(this.options.overlay, this._getZoomForUrl(), c.x, c.y); }
  });
  const overlayLayers = {};
  for (const [key, o] of Object.entries(OVERLAYS)) {
    overlayLayers[key] = new ArcExport(o.url, {
      overlay: o,
      attribution: o.attr || 'MN DNR',
      minZoom: o.minZoom || 0,
      maxZoom: 18,
      bounds: o.box.pad(0.1),
      opacity: o.opacity,
      zIndex: 5
    });
  }
  recall(STORE.overlays, []).forEach((k) => { if (overlayLayers[k]) overlayLayers[k].addTo(map); });
  const overlayControl = {};
  for (const [key, o] of Object.entries(OVERLAYS)) overlayControl[o.name] = overlayLayers[key];
  const layerControl = L.control.layers({ 'Topo': layers.topo, 'Satellite': layers.sat, 'Satellite + trails': layers.trails, 'Hybrid (names, contours)': layers.hybrid, 'Street': layers.street }, overlayControl, { position: 'topright' }).addTo(map);
  const saveOverlays = () => store(STORE.overlays, Object.keys(overlayLayers).filter((k) => map.hasLayer(overlayLayers[k])));
  map.on('overlayadd', saveOverlays);
  map.on('overlayremove', saveOverlays);

  // ---------- Parcels: tap one to see who owns it (Becker and Otter Tail only) ----------
  const escHtml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  map.on('overlayadd', (e) => {
    if (e.layer === overlayLayers.parcels && map.getZoom() < OVERLAYS.parcels.minZoom) toast('Zoom in closer to see parcel lines. Tap a parcel to see its owner.', 4000);
  });
  let parcelAsk = 0;
  map.on('click', async (e) => {
    if (draw || !map.hasLayer(overlayLayers.parcels) || map.getZoom() < OVERLAYS.parcels.minZoom) return;
    if (!OVERLAYS.parcels.box.contains(e.latlng)) return;
    // A tap on a pin, line, area or track opens that item's own popup instead.
    const t = e.originalEvent && e.originalEvent.target;
    if (t && t.closest && t.closest('.leaflet-interactive, .leaflet-marker-icon')) return;
    const ask = ++parcelAsk;
    const q = new URLSearchParams({
      geometry: e.latlng.lng + ',' + e.latlng.lat, geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', where: PARCEL_WHERE, returnGeometry: 'false', f: 'json',
      outFields: 'co_name,owner_name,owner_more,acres_poly,acres_deed,abb_legal,section,township,range,county_pin,ctu_name'
    });
    let a;
    try {
      const r = await fetch(PARCEL_URL + '/0/query?' + q);
      const j = await r.json();
      a = j.features && j.features[0] && j.features[0].attributes;
    } catch (err) {
      if (ask === parcelAsk) toast('Parcel owner lookup needs a signal.');
      return;
    }
    if (ask !== parcelAsk) return;
    if (!a) return toast('No parcel found here.');
    const acres = a.acres_deed || a.acres_poly;
    const rows = [
      ['Owner', [a.owner_name, a.owner_more].filter(Boolean).join(' ') || 'Not listed'],
      ['Acres', acres ? (Math.round(acres * 10) / 10).toLocaleString() + (a.acres_deed ? ' (deed)' : ' (mapped)') : ''],
      ['Township', a.ctu_name],
      ['Sec-Twp-Rng', a.section ? a.section + '-' + a.township + '-' + a.range : ''],
      ['Legal', a.abb_legal],
      ['Parcel #', a.county_pin]
    ].filter(([, v]) => v);
    L.popup({ maxWidth: 280 }).setLatLng(e.latlng).setContent(
      '<b>' + escHtml(a.co_name || '') + ' County parcel</b>' +
      rows.map(([k, v]) => '<div><span class="muted small">' + k + ':</span> ' + escHtml(v) + '</div>').join('') +
      '<div class="muted small" style="margin-top:6px">From county tax records. Lines are approximate and not a survey. Always confirm before you hunt.</div>'
    ).openOn(map);
  });
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
  const SHEETS = ['editor', 'shapeEditor', 'trackDetail', 'pinsSheet', 'insightsSheet', 'offlineSheet', 'moreSheet', 'measureSheet', 'sunSheet', 'trackSheet', 'gotoSheet', 'helpSheet'];
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
  // Lines and areas drawn on the map (like onX): { id, kind: 'line' | 'area', name, notes, color, group, pts: [[lat, lng], ...] }
  let shapes = recall(STORE.shapes, []);
  let draw = null; // set while drawing or moving the points of a line or area

  // Groups (like folders in other map apps): every pin belongs to one, and each can be shown or hidden.
  const DEFAULT_GROUP = 'My pins';
  const cleanGroup = (g) => String(g || '').trim().replace(/\s+/g, ' ').slice(0, 40) || DEFAULT_GROUP;
  const groupOf = (p) => cleanGroup(p.group);
  if (pins.some((p) => !p.group)) { pins.forEach((p) => { p.group = groupOf(p); }); store(STORE.pins, pins); }
  function groupNames() {
    const names = new Set([DEFAULT_GROUP]);
    pins.forEach((p) => names.add(groupOf(p)));
    shapes.forEach((sh) => names.add(groupOf(sh)));
    return [DEFAULT_GROUP, ...[...names].filter((g) => g !== DEFAULT_GROUP).sort((a, b) => a.localeCompare(b))];
  }
  let editing = null;

  const catSel = $('pinCat');
  for (const [k, c] of Object.entries(CATS)) {
    let og = [...catSel.children].find((g) => g.label === c.sec);
    if (!og) { og = document.createElement('optgroup'); og.label = c.sec; catSel.appendChild(og); }
    const o = document.createElement('option');
    o.value = k;
    o.textContent = c.icon + '  ' + c.label;
    og.appendChild(o);
  }

  // Color swatches in the editor. The first one ("Auto") uses the pin type's color.
  let pickedColor = '';
  function renderSwatches() {
    makeSwatches($('pinColors'), pickedColor, (CATS[$('pinCat').value] || CATS.other).color, (c) => { pickedColor = c; renderSwatches(); });
  }
  // A row of color buttons. With auto set, the first button means "use the default color" (value '').
  function makeSwatches(box, current, auto, onPick) {
    box.replaceChildren();
    for (const [c, name] of [...(auto ? [['', 'Type color']] : []), ...PIN_COLORS]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c ? '' : ' auto');
      b.style.setProperty('--c', c || auto);
      b.title = name;
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-pressed', String(c === current));
      b.addEventListener('click', () => onPick(c));
      box.appendChild(b);
    }
  }

  function pinIcon(p) {
    const c = CATS[p.cat] || CATS.other;
    return L.divIcon({
      className: '',
      html: '<div class="pin" style="--c:' + pinColor(p) + '"><span>' + c.icon + '</span></div>',
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
    if (p.photo) {
      const img = document.createElement('img');
      img.className = 'pp-photo';
      img.alt = 'Photo of ' + (p.name || 'this pin');
      img.addEventListener('click', () => showPhoto(p));
      img.addEventListener('load', () => { const m = markers.get(p.id); if (m && m.getPopup()) m.getPopup().update(); }, { once: true });
      photoURL(p.id).then((u) => { if (u) img.src = u; else img.remove(); });
      div.appendChild(img);
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
    const hide = document.createElement('button');
    hide.className = 'alt';
    hide.textContent = 'Hide';
    hide.addEventListener('click', () => { map.closePopup(); setPinHidden(p, true); toast('"' + p.name + '" hidden. It stays in the Pins list, where a tap shows it again.', 4500); });
    const share = document.createElement('button');
    share.className = 'alt';
    share.textContent = 'Share';
    share.addEventListener('click', () => sharePin(p));
    actions.append(go, ed, share, hide);
    div.appendChild(actions);
    return div;
  }

  // Range rings and the "show only this pin type" filter
  const rings = new Map();
  // What's hidden on the map and in the list: pin types and groups. Remembered between visits.
  const hiddenTypes = new Set(recall(STORE.hiddenTypes, []));
  const hiddenGroups = new Set(recall(STORE.hiddenGroups, []));
  // inFilter: its type and group are switched on. isShown: also not hidden one by one (p.hidden).
  const inFilter = (p) => !hiddenTypes.has(CATS[p.cat] ? p.cat : 'other') && !hiddenGroups.has(groupOf(p));
  const isShown = (p) => !p.hidden && inFilter(p);
  function setPinHidden(p, hide) {
    p.hidden = !!hide;
    if (!hide) delete p.hidden;
    store(STORE.pins, pins);
    syncVisibility(p);
    applyFilter();
  }
  const YD = 0.9144;

  function drawRing(p) {
    const old = rings.get(p.id);
    if (old) { map.removeLayer(old); rings.delete(p.id); }
    if (!(p.ring > 0)) return;
    const c = pinColor(p);
    rings.set(p.id, L.circle([p.lat, p.lng], {
      radius: p.ring * YD, color: c, weight: 2, dashArray: '6 6', fillColor: c, fillOpacity: 0.07, interactive: false
    }));
  }
  function syncVisibility(p) {
    const show = isShown(p);
    [markers.get(p.id), rings.get(p.id)].forEach((l) => {
      if (!l) return;
      if (show && !map.hasLayer(l)) l.addTo(map);
      if (!show && map.hasLayer(l)) map.removeLayer(l);
    });
  }

  function addMarker(p) {
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.name });
    m.bindPopup(() => popupFor(p));
    markers.set(p.id, m);
    drawRing(p);
    syncVisibility(p);
  }
  function refreshMarker(p) {
    const m = markers.get(p.id);
    if (!m) return addMarker(p);
    m.setIcon(pinIcon(p));
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
    $('pinGroup').value = isNew ? (p.group || '') : groupOf(p);
    $('pinHide').checked = !!p.hidden;
    $('groupNames').replaceChildren(...groupNames().map((g) => { const o = document.createElement('option'); o.value = g; return o; }));
    $('pinDate').value = p.date || '';
    syncDateField(isNew);
    pickedColor = PIN_COLORS.some(([c]) => c === p.color) ? p.color : '';
    renderSwatches();
    photoEdit = { blob: null, removed: false };
    showEditorPhoto(p.photo && !isNew ? photoURL(p.id) : null);
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
    p.group = cleanGroup($('pinGroup').value);
    if ($('pinHide').checked) p.hidden = true; else delete p.hidden;
    p.date = (p.cat === 'cam' || p.cat === 'harvest') ? $('pinDate').value : '';
    if (pickedColor) p.color = pickedColor; else delete p.color;
    if (isNew) { p.id = newId(); p.created = Date.now(); pins.push(p); }
    if (photoEdit.blob || photoEdit.removed) forgetPhotoURL(p.id);
    if (photoEdit.blob) {
      p.photo = true;
      savePhoto(p.id, photoEdit.blob).catch(() => { delete p.photo; store(STORE.pins, pins); toast('The photo could not be saved. Phone storage may be full.', 5000); });
    } else if (photoEdit.removed) { delete p.photo; deletePhoto(p.id); }
    store(STORE.pins, pins);
    refreshMarker(p);
    if (target && target.id === p.id) { target = p; updateNav(); }
    closeSheets();
    editing = null;
    applyFilter();
    if (isShown(p)) toast('Pin saved');
    else if (p.hidden) toast('Pin saved and hidden. It stays in the Pins list, where a tap shows it again.', 5000);
    else toast('Pin saved. Its type or group is hidden, so turn it on under Pins > Show on map to see it.', 6000);
  });
  $('btnPinCancel').addEventListener('click', () => { closeSheets(); editing = null; });
  $('btnPinDelete').addEventListener('click', () => {
    if (!editing || editing.isNew) return;
    if (!confirm('Delete "' + editing.p.name + '"?')) return;
    const id = editing.p.id;
    pins = pins.filter((x) => x.id !== id);
    store(STORE.pins, pins);
    removeMarker(id);
    deletePhoto(id);
    forgetPhotoURL(id);
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
    if (draw) return;
    openEditor({ lat: e.latlng.lat, lng: e.latlng.lng, cat: 'stand', name: '', notes: '' }, true);
  });

  // ---------- Lines and areas ----------
  // Lines show their length and walking time; areas show acres and the distance around.
  const SHAPE_KINDS = {
    line: { label: 'Line', icon: '〰️', color: '#f9a825', min: 2 },
    area: { label: 'Area', icon: '🔲', color: '#ef6c00', min: 3 },
    route: { label: 'Route', icon: '🧭', color: '#1565c0', min: 2 }
  };
  const shapeKey = (sh) => '_' + sh.kind; // its entry in hiddenTypes, next to the pin types
  const shapeColor = (sh) => (PIN_COLORS.some(([c]) => c === sh.color) ? sh.color : SHAPE_KINDS[sh.kind].color);
  const toLL = (pts) => pts.map(([lat, lng]) => ({ lat, lng }));
  function lengthOf(pts, closed) {
    const ll = toLL(pts);
    if (closed && ll.length > 2) ll.push(ll[0]);
    let m = 0;
    for (let i = 1; i < ll.length; i++) m += dist(ll[i - 1], ll[i]);
    return m;
  }
  // Area on the earth's surface in square meters (spherical polygon formula).
  function areaOf(pts) {
    if (pts.length < 3) return 0;
    const R = 6378137;
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const [la1, lo1] = pts[i], [la2, lo2] = pts[(i + 1) % pts.length];
      sum += rad(lo2 - lo1) * (2 + Math.sin(rad(la1)) + Math.sin(rad(la2)));
    }
    return Math.abs(sum * R * R / 2);
  }
  function fmtArea(m2) {
    const ac = m2 / 4046.856;
    const txt = ac < 10 ? ac.toFixed(2) : ac < 100 ? ac.toFixed(1) : Math.round(ac).toLocaleString('en-US');
    return txt + ' acre' + (txt === '1.00' ? '' : 's') + (ac >= 640 ? ' (' + (ac / 640).toFixed(2) + ' sq mi)' : '');
  }
  function shapeMeasure(sh) {
    if (sh.kind === 'area') return fmtArea(areaOf(sh.pts)) + ' · ' + fmtDist(lengthOf(sh.pts, true)) + ' around';
    const m = lengthOf(sh.pts);
    const e = elevFor(sh);
    return fmtDist(m) + ' · about ' + fmtTime(walkMin(m) + climbMin(e)) + ' walking' + (e ? ' · ' + elevText(e) : '');
  }

  // ---------- Elevation (USGS 3DEP: 1 m bare-earth, needs a signal; the result is saved with the route or track) ----------
  const ELEV_URL = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';
  const ftOf = (m) => Math.round(m * 3.28084).toLocaleString('en-US') + ' ft';
  const elevText = (e) => '↗ ' + ftOf(e.gain) + ' up · ↘ ' + ftOf(e.loss) + ' down';
  const climbMin = (e) => (e ? e.gain / 10 : 0); // about 1 extra minute for every 10 m (33 ft) of climbing
  const elevKey = (pts) => pts.length + ':' + pts[0][0] + ',' + pts[0][1] + ':' + pts[pts.length - 1][0] + ',' + pts[pts.length - 1][1];
  const elevFor = (o) => (o && o.elev && o.pts && o.pts.length > 1 && o.elev.k === elevKey(o.pts) ? o.elev : null);
  // Evenly spaced points along a path, with their distance from the start: [[lat, lng, meters], ...]
  function samplePath(pts, n) {
    const ll = toLL(pts), cum = [0];
    for (let i = 1; i < ll.length; i++) cum.push(cum[i - 1] + dist(ll[i - 1], ll[i]));
    const total = cum[cum.length - 1], out = [];
    let j = 1;
    for (let k = 0; k < n; k++) {
      const s = total * k / (n - 1);
      while (j < cum.length - 1 && cum[j] < s) j++;
      const seg = cum[j] - cum[j - 1], t = seg ? (s - cum[j - 1]) / seg : 0;
      out.push([ll[j - 1].lat + (ll[j].lat - ll[j - 1].lat) * t, ll[j - 1].lng + (ll[j].lng - ll[j - 1].lng) * t, s]);
    }
    return out;
  }
  async function fetchElev(pts) {
    // A walk's pauses (gap = 1 on a point) split it into stretches; the jump across a pause isn't walked, so it's skipped.
    const parts = [[]];
    pts.forEach((p, i) => { if (i && p[3]) parts.push([]); parts[parts.length - 1].push(p); });
    const lens = parts.map((pp) => (pp.length > 1 ? lengthOf(pp) : 0));
    const total = lens.reduce((a, b) => a + b, 0);
    const samples = [], starts = new Set();
    let off = 0;
    parts.forEach((pp, k) => {
      if (pp.length < 2 || !lens[k]) return;
      const n = Math.max(2, Math.round(Math.min(120, Math.ceil(total / 15) + 1) * lens[k] / total));
      starts.add(samples.length);
      samplePath(pp, n).forEach(([la, lo, d]) => samples.push([la, lo, off + d]));
      off += lens[k];
    });
    if (samples.length < 2) return null;
    const geometry = JSON.stringify({ points: samples.map(([la, lo]) => [+lo.toFixed(6), +la.toFixed(6)]), spatialReference: { wkid: 4326 } });
    const q = new URLSearchParams({ geometry, geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', interpolation: 'RSP_BilinearInterpolation', f: 'json' });
    const r = await fetch(ELEV_URL + '?' + q, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const vals = new Map((j.samples || []).map((x) => [x.locationId, parseFloat(x.value)]));
    const prof = samples.map((x, i) => [Math.round(x[2]), vals.get(i), starts.has(i)]).filter(([, e]) => isFinite(e) && e > -100);
    if (prof.length < 2) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i < prof.length; i++) { if (prof[i][2]) continue; const d = prof[i][1] - prof[i - 1][1]; if (d > 0) gain += d; else loss -= d; }
    return { k: elevKey(pts), prof: prof.map(([d, e]) => [d, +e.toFixed(1)]), gain: Math.round(gain), loss: Math.round(loss) };
  }
  const elevBusy = new WeakSet();
  // Look up elevation once (if there's a signal), then save it and call after().
  function ensureElev(o, save, after) {
    if (!o.pts || o.pts.length < 2 || elevFor(o) || elevBusy.has(o)) return;
    elevBusy.add(o);
    fetchElev(o.pts).then((e) => { if (e) { o.elev = e; save(); if (after) after(); } })
      .catch(() => {}).finally(() => elevBusy.delete(o));
  }
  function profileSVG(e) {
    const W = 300, H = 90, B = H - 14;
    const d1 = e.prof[e.prof.length - 1][0] || 1;
    const es = e.prof.map((p) => p[1]);
    const lo = Math.min(...es), hi = Math.max(...es), span = Math.max(hi - lo, 3);
    const x = (d) => (d / d1 * W).toFixed(1), y = (v) => (B - (v - lo) / span * (B - 14)).toFixed(1);
    const line = e.prof.map(([d, v], i) => (i ? 'L' : 'M') + x(d) + ' ' + y(v)).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="prof" role="img" aria-label="Elevation profile from ' + ftOf(lo) + ' to ' + ftOf(hi) + '">' +
      '<path class="prof-fill" d="' + line + ' L' + W + ' ' + B + ' L0 ' + B + ' Z"/><path class="prof-line" d="' + line + '"/>' +
      '<text class="prof-t" x="2" y="10">' + ftOf(hi) + '</text><text class="prof-t" x="2" y="' + (H - 2) + '">' + ftOf(lo) + '</text>' +
      '<text class="prof-t" x="' + W + '" y="' + (H - 2) + '" text-anchor="end">' + fmtDist(d1) + '</text></svg>';
  }
  // The elevation box in an editor: the profile, or a note while it loads (or if there's no signal).
  function renderElevBox(box, o, save, onLoad) {
    if (!o.pts || o.pts.length < 2 || o.kind === 'area') { box.hidden = true; return; }
    box.hidden = false;
    const e = elevFor(o);
    if (e) { box.innerHTML = profileSVG(e) + '<div class="muted small">' + elevText(e) + ' · USGS elevation</div>'; return; }
    box.innerHTML = '<div class="muted small">' + (navigator.onLine === false ? 'Elevation needs a signal. It will load next time you open this with service.' : 'Loading elevation…') + '</div>';
    ensureElev(o, save, () => { renderElevBox(box, o, save); if (onLoad) onLoad(); });
  }

  const shapeLayers = new Map();
  const shapeInFilter = (sh) => !hiddenTypes.has(shapeKey(sh)) && !hiddenGroups.has(groupOf(sh));
  const shapeShown = (sh) => !sh.hidden && shapeInFilter(sh) && !(draw && draw.shape === sh);
  function shapeLayer(sh) {
    const c = shapeColor(sh);
    const ll = sh.pts.map(([a, b]) => [a, b]);
    const l = sh.kind === 'area'
      ? L.polygon(ll, { color: c, weight: 3, fillColor: c, fillOpacity: 0.18 })
      : L.polyline(ll, { color: c, weight: 5, opacity: 0.95 });
    // While drawing, a tap on an existing line or area adds a point instead of opening it.
    l.on('click', (e) => { if (!draw) L.popup().setLatLng(e.latlng).setContent(shapePopup(sh)).openOn(map); });
    return l;
  }
  function refreshShape(sh) {
    const old = shapeLayers.get(sh.id);
    if (old) map.removeLayer(old);
    shapeLayers.set(sh.id, shapeLayer(sh));
    syncShape(sh);
  }
  function syncShape(sh) {
    const l = shapeLayers.get(sh.id);
    if (!l) return;
    const show = shapeShown(sh);
    if (show && !map.hasLayer(l)) l.addTo(map);
    if (!show && map.hasLayer(l)) map.removeLayer(l);
  }
  function removeShape(id) {
    const l = shapeLayers.get(id);
    if (l) { map.removeLayer(l); shapeLayers.delete(id); }
  }
  shapes.forEach(refreshShape);
  const saveShapes = () => store(STORE.shapes, shapes);
  function setShapeHidden(sh, hide) {
    if (hide) sh.hidden = true; else delete sh.hidden;
    saveShapes();
    syncShape(sh);
    applyFilter();
  }

  function shapePopup(sh) {
    const k = SHAPE_KINDS[sh.kind];
    const div = document.createElement('div');
    div.className = 'pp';
    const h = document.createElement('strong');
    h.textContent = sh.name || 'Untitled';
    div.appendChild(h);
    const meta = document.createElement('div');
    meta.className = 'pp-meta';
    meta.textContent = k.label + ' · ' + shapeMeasure(sh);
    div.appendChild(meta);
    if (sh.notes) {
      const n = document.createElement('div');
      n.className = 'pp-notes';
      n.textContent = sh.notes;
      div.appendChild(n);
    }
    const actions = document.createElement('div');
    actions.className = 'pp-actions';
    const btn = (label, alt, fn) => {
      const b = document.createElement('button');
      if (alt) b.className = 'alt';
      b.textContent = label;
      b.addEventListener('click', () => { map.closePopup(); fn(); });
      actions.appendChild(b);
    };
    btn('Edit', false, () => openShapeEditor(sh, false));
    if (sh.kind !== 'area') btn('Follow', true, () => startFollow(sh));
    btn('Move points', true, () => startDraw(sh.kind, sh));
    btn('Share', true, () => shareShape(sh));
    btn('Hide', true, () => { setShapeHidden(sh, true); toast('"' + sh.name + '" hidden. It stays in the Pins list, where a tap shows it again.', 4500); });
    div.appendChild(actions);
    return div;
  }
  function zoomToShape(sh) {
    const l = shapeLayers.get(sh.id);
    if (!l) return;
    map.flyToBounds(l.getBounds(), { padding: [40, 40], maxZoom: 17, duration: 0.8 });
    setTimeout(() => L.popup().setLatLng(sh.kind === 'area' ? l.getBounds().getCenter() : l.getLatLngs()[Math.floor(l.getLatLngs().length / 2)]).setContent(shapePopup(sh)).openOn(map), 900);
  }

  // Drawing: tap the map (or use the crosshair) to add points, drag a point to move it.
  // A route can follow trails and roads (like onX's Snap To): each leg between two of your points comes
  // from the OpenStreetMap walking router, which needs a signal. Woods trails missing from OpenStreetMap won't snap.
  const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
  let snapOn = recall(STORE.snap, true) !== false;
  const vtxIcon = (first) => L.divIcon({ className: '', html: '<div class="vtx' + (first ? ' first' : '') + '"></div>', iconSize: [30, 30], iconAnchor: [15, 15] });
  // A route's own points (the ones you placed) as indexes into its full path. Imported routes get a few spread along them.
  function viaOf(sh) {
    if (sh.kind !== 'route') return null;
    const n = sh.pts.length;
    if (Array.isArray(sh.vi) && sh.vi.length >= 2 && sh.vi[0] === 0 && sh.vi[sh.vi.length - 1] === n - 1) return sh.vi;
    if (n <= 40) return sh.pts.map((_, i) => i);
    return Array.from({ length: 25 }, (_, i) => Math.round(i * (n - 1) / 24));
  }
  function startDraw(kind, existing) {
    if (draw) stopDraw();
    closeSheets();
    map.closePopup();
    draw = { kind, shape: existing || null, pts: [], segs: [], vtx: [], preview: null, busy: 0 };
    if (existing) {
      const vi = viaOf(existing);
      const xy = (p) => [p[0], p[1]];
      if (vi) {
        draw.pts = vi.map((i) => xy(existing.pts[i]));
        draw.segs = vi.slice(1).map((j, n) => existing.pts.slice(vi[n], j + 1).map(xy));
        draw.segs.forEach((sg, n) => { sg[0] = draw.pts[n]; sg[sg.length - 1] = draw.pts[n + 1]; });
      } else draw.pts = existing.pts.map(xy);
      syncShape(existing); // hide the saved copy while its points are moved
    }
    document.body.classList.add('drawing');
    $('drawbar').hidden = false;
    $('btnDrawSnap').hidden = kind !== 'route';
    redrawDraft();
  }
  // The whole path being drawn: the points themselves, or for a route its legs joined end to end.
  function draftPath() {
    if (draw.kind !== 'route' || draw.pts.length < 2) return draw.pts.slice();
    return draw.segs.reduce((acc, sg, i) => acc.concat(i ? sg.slice(1) : sg), []);
  }
  async function snapLeg(i) {
    const d = draw;
    const a = d.pts[i], b = d.pts[i + 1];
    d.segs[i] = [a, b];
    if (!snapOn) return;
    d.busy++;
    drawStatus();
    try {
      const r = await fetch(ROUTER + a[1] + ',' + a[0] + ';' + b[1] + ',' + b[0] + '?overview=full&geometries=geojson', { signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      const c = j.code === 'Ok' && j.routes && j.routes[0] && j.routes[0].geometry.coordinates;
      if (!c || c.length < 2) throw new Error('no route');
      const straight = dist({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
      // A huge detour means there's no trail between these points; a straight line is more useful.
      if (j.routes[0].distance > straight * 4 + 400) throw new Error('detour');
      if (draw !== d || d.pts[i] !== a || d.pts[i + 1] !== b) return; // the points moved while we waited
      d.segs[i] = [a, ...c.map(([lo, la]) => [+la.toFixed(6), +lo.toFixed(6)]), b];
    } catch (e) {
      if (draw === d) toast(navigator.onLine === false ? 'No signal, so that leg is a straight line.' : 'No trail or road links those points, so that leg is a straight line.', 3500);
    } finally {
      d.busy--;
      if (draw === d) redrawDraft();
    }
  }
  function redrawDraft() {
    if (!draw) return;
    const k = SHAPE_KINDS[draw.kind];
    const c = draw.shape ? shapeColor(draw.shape) : k.color;
    if (draw.preview) map.removeLayer(draw.preview);
    const ll = draftPath();
    draw.preview = (draw.kind === 'area' && ll.length > 2
      ? L.polygon(ll, { color: c, weight: 3, dashArray: '6 6', fillColor: c, fillOpacity: 0.15, interactive: false })
      : L.polyline(ll, { color: c, weight: 4, dashArray: draw.kind === 'route' ? null : '6 6', interactive: false })).addTo(map);
    draw.vtx.forEach((m) => map.removeLayer(m));
    draw.vtx = draw.pts.map((p, i) => {
      const m = L.marker(p, { icon: vtxIcon(i === 0 && draw.kind !== 'line'), draggable: true, zIndexOffset: 1000, keyboard: false });
      m.on('drag', (e) => {
        const q = e.target.getLatLng();
        draw.pts[i] = [q.lat, q.lng];
        if (draw.kind === 'route') { // straight while dragging, snapped again on release
          if (i > 0) draw.segs[i - 1] = [draw.pts[i - 1], draw.pts[i]];
          if (i < draw.pts.length - 1) draw.segs[i] = [draw.pts[i], draw.pts[i + 1]];
        }
        draw.preview.setLatLngs(draftPath());
        drawStatus();
      });
      m.on('dragend', () => {
        if (draw.kind !== 'route') return;
        if (i > 0) snapLeg(i - 1);
        if (i < draw.pts.length - 1) snapLeg(i);
        redrawDraft();
      });
      // Tapping the first point of an area closes it.
      m.on('click', () => { if (i === 0 && draw.kind === 'area' && draw.pts.length >= 3) finishDraw(); });
      return m.addTo(map);
    });
    drawStatus();
  }
  function drawStatus() {
    const k = SHAPE_KINDS[draw.kind];
    const n = draw.pts.length;
    const what = draw.shape ? 'Moving points: ' + draw.shape.name : 'New ' + k.label.toLowerCase();
    let m = '';
    if (draw.kind !== 'area' && n >= 2) m = shapeMeasure({ kind: draw.kind, pts: draftPath() });
    if (draw.kind === 'area' && n >= 3) m = shapeMeasure({ kind: 'area', pts: draw.pts });
    $('drawText').textContent = what + (m ? ' · ' + m : '');
    $('drawHint').textContent = draw.busy ? 'Finding the trail…'
      : n < k.min ? 'Tap the map to add points' + (n ? ' (' + n + ' so far, ' + k.min + ' needed)' : '') + ', or line up the crosshair and tap ✚.'
      : 'Drag a point to move it.' + (draw.kind === 'area' ? ' Tap the first point or Done to finish.' : ' Tap Done to finish.');
    $('btnDrawUndo').disabled = !n;
    $('btnDrawDone').disabled = n < k.min || draw.busy > 0;
    $('btnDrawSnap').textContent = snapOn ? '🥾 Follow trails & roads: on' : '🥾 Follow trails & roads: off (straight lines)';
    $('btnDrawSnap').setAttribute('aria-pressed', String(snapOn));
  }
  function addDrawPoint(lat, lng) {
    if (!draw) return;
    if (draw.pts.length >= 500) return toast('That\'s the most points one line or area can have.');
    draw.pts.push([lat, lng]);
    const n = draw.pts.length;
    if (draw.kind === 'route' && n >= 2) snapLeg(n - 2);
    redrawDraft();
  }
  map.on('click', (e) => addDrawPoint(e.latlng.lat, e.latlng.lng));
  function stopDraw() {
    if (!draw) return;
    if (draw.preview) map.removeLayer(draw.preview);
    draw.vtx.forEach((m) => map.removeLayer(m));
    const sh = draw.shape;
    draw = null;
    if (sh) syncShape(sh);
    document.body.classList.remove('drawing');
    $('drawbar').hidden = true;
  }
  function finishDraw() {
    if (!draw || draw.pts.length < SHAPE_KINDS[draw.kind].min || draw.busy) return;
    const r6 = ([a, b]) => [+a.toFixed(6), +b.toFixed(6)];
    const pts = draftPath().map(r6);
    let vi;
    if (draw.kind === 'route') { vi = [0]; draw.segs.forEach((sg) => vi.push(vi[vi.length - 1] + sg.length - 1)); }
    const { kind, shape } = draw;
    stopDraw();
    if (shape) {
      shape.pts = pts;
      if (vi) shape.vi = vi;
      saveShapes();
      refreshShape(shape);
      if (kind !== 'area') ensureElev(shape, saveShapes);
      toast(shape.name + ': ' + shapeMeasure(shape), 4000);
    } else {
      openShapeEditor({ kind, pts, ...(vi ? { vi } : {}), name: '', notes: '' }, true);
    }
  }
  $('btnDrawUndo').addEventListener('click', () => {
    if (!draw || !draw.pts.length) return;
    draw.pts.pop();
    draw.segs.length = Math.max(0, draw.pts.length - 1);
    redrawDraft();
  });
  $('btnDrawCenter').addEventListener('click', () => { const c = map.getCenter(); addDrawPoint(c.lat, c.lng); });
  $('btnDrawDone').addEventListener('click', finishDraw);
  $('btnDrawSnap').addEventListener('click', () => { snapOn = !snapOn; store(STORE.snap, snapOn); drawStatus(); toast(snapOn ? 'New legs follow trails and roads where it can find them.' : 'New legs are straight lines.', 3000); });
  $('btnDrawCancel').addEventListener('click', () => {
    if (draw && !draw.shape && draw.pts.length > 1 && !confirm('Throw away this ' + SHAPE_KINDS[draw.kind].label.toLowerCase() + '?')) return;
    stopDraw();
  });
  $('btnDrawLine').addEventListener('click', () => startDraw('line'));
  $('btnDrawArea').addEventListener('click', () => startDraw('area'));
  $('btnDrawRoute').addEventListener('click', () => startDraw('route'));

  // Line / area editor sheet
  let shapeEditing = null, shapePicked = '';
  function renderShapeSwatches() {
    makeSwatches($('shapeColors'), shapePicked, '', (c) => { shapePicked = c; renderShapeSwatches(); });
  }
  function openShapeEditor(sh, isNew) {
    shapeEditing = { sh, isNew };
    const k = SHAPE_KINDS[sh.kind];
    $('shapeTitle').textContent = (isNew ? 'New ' : 'Edit ') + k.label.toLowerCase();
    $('shapeName').value = sh.name || '';
    $('shapeName').placeholder = sh.kind === 'area' ? 'e.g. North bedding area' : sh.kind === 'route' ? 'e.g. Dark-morning walk to ridge stand' : 'e.g. Fence line';
    $('shapeNotes').value = sh.notes || '';
    $('shapeGroup').value = isNew ? '' : groupOf(sh);
    $('groupNames').replaceChildren(...groupNames().map((g) => { const o = document.createElement('option'); o.value = g; return o; }));
    $('shapeHide').checked = !!sh.hidden;
    $('shapeMeasure').textContent = shapeMeasure(sh);
    renderElevBox($('shapeElev'), sh, () => { if (shapes.includes(sh)) saveShapes(); },
      () => { if (shapeEditing && shapeEditing.sh === sh) $('shapeMeasure').textContent = shapeMeasure(sh); });
    shapePicked = shapeColor(sh);
    renderShapeSwatches();
    $('btnShapeDelete').hidden = isNew;
    $('btnShapePoints').hidden = isNew;
    $('btnShapeFollow').hidden = isNew || sh.kind === 'area';
    showSheet('shapeEditor');
  }
  $('btnShapeSave').addEventListener('click', () => {
    if (!shapeEditing) return;
    const { sh, isNew } = shapeEditing;
    const k = SHAPE_KINDS[sh.kind];
    sh.name = $('shapeName').value.trim() || (k.label + ' ' + (shapes.filter((x) => x.kind === sh.kind).length + (isNew ? 1 : 0)));
    sh.notes = $('shapeNotes').value.trim();
    sh.group = cleanGroup($('shapeGroup').value);
    sh.color = shapePicked || k.color;
    if ($('shapeHide').checked) sh.hidden = true; else delete sh.hidden;
    if (isNew) { sh.id = newId(); sh.created = Date.now(); shapes.push(sh); }
    saveShapes();
    refreshShape(sh);
    if (sh.kind !== 'area') ensureElev(sh, saveShapes);
    closeSheets();
    shapeEditing = null;
    applyFilter();
    if (shapeShown(sh)) toast(sh.name + ' saved · ' + shapeMeasure(sh), 4000);
    else toast('Saved. It\'s hidden right now; turn it on under Pins > Show on map.', 5000);
  });
  $('btnShapeCancel').addEventListener('click', () => { closeSheets(); shapeEditing = null; });
  $('btnShapeFollow').addEventListener('click', () => { const sh = shapeEditing && shapeEditing.sh; shapeEditing = null; if (sh) startFollow(sh); });
  $('btnShapePoints').addEventListener('click', () => { const sh = shapeEditing && shapeEditing.sh; shapeEditing = null; if (sh) startDraw(sh.kind, sh); });
  $('btnShapeDelete').addEventListener('click', () => {
    if (!shapeEditing || shapeEditing.isNew) return;
    const { sh } = shapeEditing;
    if (!confirm('Delete "' + sh.name + '"?')) return;
    shapes = shapes.filter((x) => x.id !== sh.id);
    saveShapes();
    removeShape(sh.id);
    if (follow && follow.obj === sh) stopFollow();
    closeSheets();
    shapeEditing = null;
    applyFilter();
  });

  // KML for lines and areas: the format Google Earth, onX and most map apps read.
  const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  function kmlColor(hex) { const h = hex.slice(1); return 'ff' + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); } // KML is aabbggrr
  function shapeKML(sh) {
    const c = kmlColor(shapeColor(sh));
    const coords = (sh.kind === 'area' ? [...sh.pts, sh.pts[0]] : sh.pts).map(([la, lo]) => lo + ',' + la + ',0').join(' ');
    const geom = sh.kind === 'area'
      ? '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + coords + '</coordinates></LinearRing></outerBoundaryIs></Polygon>'
      : '<LineString><tessellate>1</tessellate><coordinates>' + coords + '</coordinates></LineString>';
    return '  <Placemark>\n    <name>' + xmlEsc(sh.name) + '</name>\n    <description>' + xmlEsc([shapeMeasure(sh), sh.notes].filter(Boolean).join('\n')) + '</description>\n' +
      '    <Style><LineStyle><color>' + c + '</color><width>3</width></LineStyle><PolyStyle><color>4d' + c.slice(2) + '</color></PolyStyle></Style>\n    ' + geom + '\n  </Placemark>';
  }
  const kmlDoc = (body) => '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Woods Map</name>\n' + body + '\n</Document></kml>\n';
  async function shareShape(sh) {
    const k = SHAPE_KINDS[sh.kind];
    const fname = (sh.name || k.label).replace(/[^\w-]+/g, '_') + '.kml';
    const kml = kmlDoc(shapeKML(sh));
    const text = k.icon + ' ' + sh.name + ' (' + k.label + ')\n' + shapeMeasure(sh) + (sh.notes ? '\n' + sh.notes : '') +
      '\nOpen the attached KML in Woods Map (More > Import pins), Google Earth, onX or another map app.';
    const file = new File([kml], fname, { type: 'application/vnd.google-earth.kml+xml' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ title: sh.name, text, files: [file] }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    download(fname, kml, 'application/vnd.google-earth.kml+xml');
    toast('Saved ' + fname + '. Send that file to share it.', 4500);
  }

  // Turns imported lines and areas (from GPX, KML or a backup) into saved shapes; long tracks are thinned out.
  function cleanShape(x, intoGroup) {
    if (!x || !SHAPE_KINDS[x.kind] || !Array.isArray(x.pts)) return null;
    let pts = x.pts.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180).map(([a, b]) => [+a, +b]);
    if (x.kind === 'area' && pts.length > 3) {
      const [f, l] = [pts[0], pts[pts.length - 1]];
      if (f[0] === l[0] && f[1] === l[1]) pts.pop(); // KML and GPX repeat the first point to close an area
    }
    const cap = x.kind === 'route' ? 3000 : 500;
    if (pts.length > cap) { const step = (pts.length - 1) / (cap - 1); pts = Array.from({ length: cap }, (_, i) => pts[Math.round(i * step)]); }
    const vi = x.kind === 'route' && Array.isArray(x.vi) && x.vi.every((v, i) => Number.isInteger(v) && v >= 0 && v < pts.length && (!i || v > x.vi[i - 1])) ? x.vi : null;
    if (pts.length < SHAPE_KINDS[x.kind].min) return null;
    return {
      id: newId(),
      kind: x.kind,
      name: String(x.name || 'Imported ' + SHAPE_KINDS[x.kind].label.toLowerCase()).slice(0, 60),
      notes: String(x.notes || '').slice(0, 500),
      color: PIN_COLORS.some(([c]) => c === x.color) ? x.color : SHAPE_KINDS[x.kind].color,
      group: intoGroup || cleanGroup(x.group),
      ...(!intoGroup && x.hidden ? { hidden: true } : {}),
      pts,
      ...(vi ? { vi } : {}),
      ...(x.elev && x.elev.k === elevKey(pts) && Array.isArray(x.elev.prof) ? { elev: x.elev } : {}),
      created: x.created || Date.now()
    };
  }
  // Nearest of our colors to a KML aabbggrr color, so imports keep roughly the color they had.
  function nearestColor(kml) {
    const m = /^[0-9a-f]{8}$/i.exec(kml || '');
    if (!m) return '';
    const rgb = [kml.slice(6, 8), kml.slice(4, 6), kml.slice(2, 4)].map((h) => parseInt(h, 16));
    let best = '', bd = Infinity;
    for (const [c] of PIN_COLORS) {
      const q = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      const d = q.reduce((a, v, i) => a + (v - rgb[i]) ** 2, 0);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // ---------- Pin photos ----------
  // Photos are too big for localStorage, so they live in IndexedDB, one per pin, keyed by pin id.
  // A pin with a photo has p.photo = true. Photos are shrunk to about 1600 px so they stay small.
  let photoDB = null;
  function db() {
    if (!photoDB) photoDB = new Promise((resolve, reject) => {
      const req = indexedDB.open('woodsmap', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return photoDB;
  }
  async function photoTx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('photos', mode);
      const r = fn(tx.objectStore('photos'));
      tx.oncomplete = () => resolve(r && r.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  const savePhoto = (id, blob) => photoTx('readwrite', (st) => st.put(blob, id));
  const getPhoto = (id) => photoTx('readonly', (st) => st.get(id)).catch(() => null);
  const deletePhoto = (id) => photoTx('readwrite', (st) => st.delete(id)).catch(() => {});
  const photoURLs = new Map(); // pin id -> object URL, reused so popups don't leak memory
  async function photoURL(id) {
    if (photoURLs.has(id)) return photoURLs.get(id);
    const b = await getPhoto(id);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    photoURLs.set(id, u);
    return u;
  }
  function forgetPhotoURL(id) {
    const u = photoURLs.get(id);
    if (u) { URL.revokeObjectURL(u); photoURLs.delete(id); }
  }
  async function shrinkPhoto(file, max = 1600) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImg(url);
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k);
      cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('no blob'))), 'image/jpeg', 0.8));
    } finally { URL.revokeObjectURL(url); }
  }
  // Editor: the photo being added or removed, applied when Save is tapped.
  let photoEdit = { blob: null, removed: false };
  let editorPreviewURL = null;
  function showEditorPhoto(urlPromise) {
    if (editorPreviewURL) { URL.revokeObjectURL(editorPreviewURL); editorPreviewURL = null; }
    const img = $('pinPhotoPrev');
    img.hidden = true;
    img.removeAttribute('src');
    $('btnPhotoRemove').hidden = true;
    $('btnPhotoAdd').textContent = '📷 Add photo';
    if (!urlPromise) return;
    urlPromise.then((u) => {
      if (!u) return;
      img.src = u;
      img.hidden = false;
      $('btnPhotoRemove').hidden = false;
      $('btnPhotoAdd').textContent = '📷 Change photo';
    });
  }
  $('btnPhotoAdd').addEventListener('click', () => $('pinPhotoFile').click());
  $('pinPhotoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      photoEdit = { blob: await shrinkPhoto(file), removed: false };
      const u = URL.createObjectURL(photoEdit.blob);
      showEditorPhoto(Promise.resolve(u));
      editorPreviewURL = u;
    } catch (err) { toast('That photo could not be opened.'); }
  });
  $('btnPhotoRemove').addEventListener('click', () => {
    photoEdit = { blob: null, removed: true };
    showEditorPhoto(null);
  });
  // Full-screen photo. Tap anywhere to close.
  async function showPhoto(p) {
    const u = await photoURL(p.id);
    if (!u) return;
    $('photoViewImg').src = u;
    $('photoViewCap').textContent = p.name || '';
    $('photoView').hidden = false;
  }
  $('photoView').addEventListener('click', () => { $('photoView').hidden = true; });

  // ---------- Share one pin ----------
  // The link opens Woods Map (or any browser) with the pin ready to save; #wp=lat,lng&n=name&t=type...
  // It's in the # part so it never reaches a server and works with the offline app.
  function pinLink(p) {
    const q = new URLSearchParams({ wp: p.lat.toFixed(6) + ',' + p.lng.toFixed(6), n: p.name || '', t: p.cat });
    if (p.color) q.set('c', p.color.slice(1));
    if (p.ring) q.set('r', String(p.ring));
    if (p.notes) q.set('d', p.notes.slice(0, 300));
    return location.origin + location.pathname + '#' + q.toString().replace('%2C', ','); // keep the comma in lat,lng readable
  }
  async function sharePin(p) {
    const c = CATS[p.cat] || CATS.other;
    const ll = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
    const link = pinLink(p);
    const text = c.icon + ' ' + (p.name || 'Pin') + ' (' + c.label + ')\n' + ll +
      (p.notes ? '\n' + p.notes : '') +
      '\nGoogle Maps: https://www.google.com/maps/search/?api=1&query=' + p.lat.toFixed(6) + ',' + p.lng.toFixed(6) +
      '\nOpen in Woods Map:';
    const data = { title: p.name || 'Pin', text, url: link };
    if (p.photo && navigator.canShare) {
      const b = await getPhoto(p.id);
      if (b) {
        const f = new File([b], (p.name || 'pin').replace(/[^\w-]+/g, '_') + '.jpg', { type: 'image/jpeg' });
        if (navigator.canShare({ ...data, files: [f] })) data.files = [f];
      }
    }
    if (navigator.share) {
      try { await navigator.share(data); return; }
      catch (err) { if (err && err.name === 'AbortError') return; delete data.files; try { await navigator.share(data); return; } catch (e2) { if (e2 && e2.name === 'AbortError') return; } }
    }
    try {
      await navigator.clipboard.writeText(text + ' ' + link);
      toast('Pin copied. Paste it into a text or email.', 4000);
    } catch (e) {
      prompt('Copy this and send it:', text + ' ' + link);
    }
  }
  // Opening a shared link: show the spot and open the editor so the pin can be saved.
  function openSharedLink() {
    if (!/^#wp=/.test(location.hash)) return;
    const q = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    const [lat, lng] = (q.get('wp') || '').split(',').map(Number);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return toast('That shared pin link is not complete.');
    const color = '#' + (q.get('c') || '');
    const ring = +q.get('r');
    const p = {
      lat, lng,
      name: (q.get('n') || '').slice(0, 60),
      notes: (q.get('d') || '').slice(0, 500),
      cat: CATS[q.get('t')] ? q.get('t') : 'other',
      group: 'Shared with me',
      ...(PIN_COLORS.some(([c]) => c === color) ? { color } : {}),
      ...([30, 50, 100, 150, 200].includes(ring) ? { ring } : {})
    };
    const dup = pins.find((x) => Math.abs(x.lat - lat) < 1e-5 && Math.abs(x.lng - lng) < 1e-5);
    if (MN.contains([lat, lng])) map.setView([lat, lng], Math.max(map.getZoom(), 16));
    if (dup) {
      const m = markers.get(dup.id);
      if (m && isShown(dup)) setTimeout(() => m.openPopup(), 300);
      return toast('You already have this pin: "' + dup.name + '"', 4500);
    }
    openEditor(p, true);
    toast('Shared pin. Tap Save to keep it.', 4500);
  }

  // ---------- Pin list ----------
  function renderList() {
    const q = $('pinSearch').value.trim().toLowerCase();
    const shown = pins.filter(inFilter); // pins hidden one by one stay in the list, greyed out
    const items = shown.filter((p) => !q || ((p.name || '') + ' ' + (p.notes || '') + ' ' + groupOf(p) + ' ' + (CATS[p.cat] || CATS.other).label).toLowerCase().includes(q));
    if (me) items.sort((a, b) => dist(me, a) - dist(me, b));
    else items.sort((a, b) => b.created - a.created);
    const ul = $('pinList');
    ul.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = pins.length ? (shown.length ? 'No pins match.' : 'All pins are hidden. Use Show on map above to turn some back on.') : 'No pins yet. Use "Pin me" or "Pin center" to add one.';
      ul.appendChild(li);
    }
    for (const p of items) {
      const c = CATS[p.cat] || CATS.other;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'rowmain';
      const ic = document.createElement('span');
      ic.className = 'pi';
      ic.style.setProperty('--c', pinColor(p));
      ic.textContent = c.icon;
      const txt = document.createElement('span');
      const t = document.createElement('span');
      t.className = 'pt';
      t.textContent = p.name;
      const s = document.createElement('span');
      s.className = 'ps';
      const outside = !MN.contains([p.lat, p.lng]);
      const g = groupOf(p);
      if (p.hidden) li.classList.add('off');
      s.textContent = [p.hidden ? 'hidden' : '', c.label, p.photo ? '📷 photo' : '', g !== DEFAULT_GROUP ? g : '', ageText(p), outside ? 'outside the map' : '', me ? fmtDist(dist(me, p)) + ' ' + compass(bearing(me, p)) : ''].filter(Boolean).join(' · ');
      txt.append(t, s);
      b.append(ic, txt);
      b.addEventListener('click', () => {
        if (outside) {
          return toast('That pin is outside the map area, so it cannot be shown on the map. Use Edit to change or delete it.', 5000);
        }
        if (p.hidden) { setPinHidden(p, false); toast('"' + p.name + '" is showing again'); }
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
    const nHidden = pins.length - shown.length;
    if (nHidden) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = nHidden + ' more pin' + (nHidden === 1 ? ' is' : 's are') + ' hidden (Show on map, above).';
      ul.appendChild(li);
    }
    renderShapeList(q);
  }
  // Lines and areas, under the pins. Nearest first once GPS is on (by their closest point).
  function renderShapeList(q) {
    const ul = $('shapeList');
    ul.replaceChildren();
    const shown = shapes.filter(shapeInFilter);
    const items = shown.filter((sh) => !q || ((sh.name || '') + ' ' + (sh.notes || '') + ' ' + groupOf(sh) + ' ' + SHAPE_KINDS[sh.kind].label).toLowerCase().includes(q));
    const near = (sh) => Math.min(...toLL(sh.pts).map((p) => dist(me, p)));
    if (me) items.sort((a, b) => near(a) - near(b)); else items.sort((a, b) => b.created - a.created);
    $('shapeHead').hidden = !shapes.length;
    for (const sh of items) {
      const k = SHAPE_KINDS[sh.kind];
      const li = document.createElement('li');
      if (sh.hidden) li.classList.add('off');
      const b = document.createElement('button');
      b.className = 'rowmain';
      const ic = document.createElement('span');
      ic.className = 'pi';
      ic.style.setProperty('--c', shapeColor(sh));
      ic.textContent = k.icon;
      const txt = document.createElement('span');
      const t = document.createElement('span');
      t.className = 'pt';
      t.textContent = sh.name;
      const sub = document.createElement('span');
      sub.className = 'ps';
      const g = groupOf(sh);
      sub.textContent = [sh.hidden ? 'hidden' : '', k.label, shapeMeasure(sh), g !== DEFAULT_GROUP ? g : '', me ? fmtDist(near(sh)) + ' away' : ''].filter(Boolean).join(' · ');
      txt.append(t, sub);
      b.append(ic, txt);
      b.addEventListener('click', () => {
        if (sh.hidden) { setShapeHidden(sh, false); toast('"' + sh.name + '" is showing again'); }
        closeSheets();
        zoomToShape(sh);
      });
      const ed = document.createElement('button');
      ed.className = 'rowedit';
      ed.textContent = 'Edit';
      ed.addEventListener('click', () => openShapeEditor(sh, false));
      li.append(b, ed);
      ul.appendChild(li);
    }
    if (shapes.length && !items.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = shown.length ? 'No routes, lines or areas match.' : 'All routes, lines and areas are hidden (Show on map, above).';
      ul.appendChild(li);
    }
  }
  $('btnPins').addEventListener('click', () => { $('pinSearch').value = ''; renderShowBox(); renderList(); showSheet('pinsSheet'); });
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
  let target = null, navLine = null, follow = null; // follow: following a route, line or walk (see below)
  function setTarget(id) {
    if (id) stopFollow(true);
    target = id ? pins.find((p) => p.id === id) || null : null;
    if (target && watchId === null) { centerOnFix = false; startGPS(); }
    updateNav();
  }
  function updateNav() {
    if (follow) return updateFollow();
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
  $('navStop').addEventListener('click', () => { if (follow) stopFollow(); else setTarget(null); });

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
    const n = countTiles(a, zMax) * ($('offLayer').value === 'trails' ? TRAIL_PARTS.length : 1);
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
      const dnr = keys.filter((k) => k.url.includes('gis.dnr.state.mn.us') || k.url.includes('plan_parcels_open')).length;
      const hybrid = keys.filter((k) => k.url.includes('USGSImageryTopo')).length;
      let extra = '';
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        extra = ' · phone storage used by app: ' + Math.round((est.usage || 0) / 1048576) + ' MB';
      }
      $('offStored').textContent = 'Saved: ' + topo.toLocaleString() + ' topo, ' + sat.toLocaleString() + ' satellite, ' + hybrid.toLocaleString() + ' hybrid, ' + dnr.toLocaleString() + ' public-land & parcel tiles' + extra;
    } catch (e) {
      $('offStored').textContent = '';
    }
  }

  const off = { running: false, abort: false };

  async function downloadArea() {
    if (!('caches' in window)) return toast('Offline maps need a secure (https) connection.');
    const a = areaBounds();
    if (!a) return;
    const choice = $('offLayer').value;
    const keys = choice === 'trails' ? TRAIL_PARTS : [choice]; // Satellite + trails needs both images
    const zMax = +$('offZoom').value;
    if (countTiles(a, zMax) * keys.length > MAX_TILES) return;

    const urls = [];
    for (let z = 8; z <= zMax; z++) {
      const r = tileRange(a, z);
      for (let x = r.x0; x <= r.x1; x++) {
        for (let y = r.y0; y <= r.y1; y++) {
          for (const k of keys) urls.push(tileUrl(k, z, x, y));
        }
      }
    }

    if ($('offOverlays').checked) {
      // Probe first: if the DNR server won't allow its images to be saved, skip those layers cleanly.
      const ovUrls = [];
      for (const o of Object.values(OVERLAYS)) {
        if (!o.box.intersects(L.latLngBounds([a.s, a.w], [a.n, a.e]))) continue;
        for (let z = Math.max(8, o.minZoom || 0); z <= Math.min(zMax, OVERLAY_MAX_SAVE_ZOOM); z++) {
          const r = tileRange(a, z);
          for (let x = r.x0; x <= r.x1; x++) {
            for (let y = r.y0; y <= r.y1; y++) ovUrls.push(overlayTileUrl(o, z, x, y));
          }
        }
      }
      let ok = false;
      if (!ovUrls.length) ok = true;
      else try { const probe = await fetch(ovUrls[0], { mode: 'cors' }); ok = probe.ok; } catch (e) { ok = false; }
      if (ok) urls.push(...ovUrls);
      else toast('The state server would not let me save its public-land and parcel layers. Saving the base map only.', 6000);
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
    if (!off.running) {
      $('offStatus').textContent = '';
      // Start on the map you're looking at, when it's one that can be saved.
      const cur = Object.keys(layers).find((k) => map.hasLayer(layers[k]));
      if (cur && cur !== 'street') $('offLayer').value = cur;
    }
    updateEstimate();
    updateStored();
  });
  $('offLayer').addEventListener('change', updateEstimate);
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

  const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  $('btnExportJson').addEventListener('click', async () => {
    if (!pins.length && !shapes.length && !tracks.length) return toast('No pins to export yet');
    // Photos go in the backup too (as text), so a restore or a friend gets them.
    const out = [];
    for (const p of pins) {
      const b = p.photo ? await getPhoto(p.id) : null;
      out.push(b ? { ...p, photoData: await blobToDataURL(b) } : p);
    }
    download('woods-map-pins-' + stamp() + '.json', JSON.stringify({ app: 'woods-map', pins: out, shapes, tracks: tracks.filter((t) => t !== rec) }, null, 2), 'application/json');
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
    // Lines and areas go in as tracks; an area is closed (ends where it starts) and has type "area".
    const t = shapes.map((sh) => sh.kind === 'route'
      ? '  <rte>\n    <name>' + esc(sh.name) + '</name>\n    <desc>' + esc(sh.notes || '') + '</desc>\n' +
        sh.pts.map(([la, lo]) => '    <rtept lat="' + la + '" lon="' + lo + '"/>').join('\n') + '\n  </rte>'
      : '  <trk>\n    <name>' + esc(sh.name) + '</name>\n    <desc>' + esc(sh.notes || '') + '</desc>\n    <type>' + sh.kind + '</type>\n    <trkseg>\n' +
      (sh.kind === 'area' ? [...sh.pts, sh.pts[0]] : sh.pts).map(([la, lo]) => '      <trkpt lat="' + la + '" lon="' + lo + '"/>').join('\n') +
      '\n    </trkseg>\n  </trk>'
    ).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Woods Map" xmlns="http://www.topografix.com/GPX/1/1">\n' + [w, t].filter(Boolean).join('\n') + '\n</gpx>\n';
  }
  $('btnExportGpx').addEventListener('click', () => {
    if (!pins.length && !shapes.length) return toast('No pins to export yet');
    download('woods-map-pins-' + stamp() + '.gpx', toGPX(), 'application/gpx+xml');
  });

  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = (await file.text()).trim();
      let incoming = [], inShapes = [], inTracks = [];
      if (text.startsWith('<')) {
        const doc = new DOMParser().parseFromString(text, 'text/xml');
        const txtIn = (node, tag) => { const el = node.getElementsByTagName(tag)[0]; return el ? el.textContent.trim() : ''; };
        // GPX waypoints
        incoming = Array.from(doc.getElementsByTagName('wpt')).map((w) => (
          { lat: parseFloat(w.getAttribute('lat')), lng: parseFloat(w.getAttribute('lon')), name: txtIn(w, 'name'), notes: txtIn(w, 'desc') || txtIn(w, 'cmt'), cat: txtIn(w, 'type') }
        ));
        // KML placemarks with a point (Google Earth, onX and other map apps export these). KML is "lng,lat,alt".
        for (const pm of Array.from(doc.getElementsByTagName('Placemark'))) {
          const pt = pm.getElementsByTagName('Point')[0];
          if (!pt) continue;
          const [lng, lat] = txtIn(pt, 'coordinates').split(',').map(parseFloat);
          const desc = txtIn(pm, 'description').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
          incoming.push({ lat, lng, name: txtIn(pm, 'name'), notes: desc });
        }
        // Lines and areas. KML: LineString and Polygon (outer edge). GPX: tracks and routes.
        const kmlPts = (el) => txtIn(el, 'coordinates').split(/\s+/).filter(Boolean).map((c) => { const [lo, la] = c.split(',').map(parseFloat); return [la, lo]; });
        for (const pm of Array.from(doc.getElementsByTagName('Placemark'))) {
          const base = {
            name: txtIn(pm, 'name'),
            notes: txtIn(pm, 'description').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(),
            color: nearestColor(txtIn(pm.getElementsByTagName('LineStyle')[0] || pm, 'color'))
          };
          for (const ls of Array.from(pm.getElementsByTagName('LineString'))) inShapes.push({ ...base, kind: 'line', pts: kmlPts(ls) });
          for (const pg of Array.from(pm.getElementsByTagName('Polygon'))) {
            const outer = pg.getElementsByTagName('outerBoundaryIs')[0] || pg;
            inShapes.push({ ...base, kind: 'area', pts: kmlPts(outer.getElementsByTagName('LinearRing')[0] || outer) });
          }
        }
        const gpxPts = (el, tag) => Array.from(el.getElementsByTagName(tag)).map((p) => [parseFloat(p.getAttribute('lat')), parseFloat(p.getAttribute('lon'))]);
        for (const tr of Array.from(doc.getElementsByTagName('trk'))) {
          inShapes.push({ kind: txtIn(tr, 'type') === 'area' ? 'area' : 'line', name: txtIn(tr, 'name'), notes: txtIn(tr, 'desc'), pts: gpxPts(tr, 'trkpt') });
        }
        for (const rt of Array.from(doc.getElementsByTagName('rte'))) inShapes.push({ kind: 'route', name: txtIn(rt, 'name'), notes: txtIn(rt, 'desc'), pts: gpxPts(rt, 'rtept') });
      } else {
        const data = JSON.parse(text);
        incoming = Array.isArray(data) ? data : (data.pins || []);
        inShapes = Array.isArray(data.shapes) ? data.shapes : [];
        inTracks = Array.isArray(data.tracks) ? data.tracks : [];
      }
      incoming = incoming.filter((p) => p && isFinite(p.lat) && isFinite(p.lng));
      inShapes = inShapes.filter((x) => cleanShape(x, 'x'));
      if (!incoming.length && !inShapes.length && !inTracks.length) return toast('No pins, lines, areas, routes or walks found in that file.');
      // Put imported pins in their own group so they can be hidden in one tap.
      const fileGroups = new Set([...incoming, ...inShapes].map((p) => p.group).filter(Boolean));
      const suggest = 'Imported ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
      const nK = (k) => inShapes.filter((x) => x.kind === k).length;
      const what = [incoming.length ? plural(incoming.length, 'pin') : '', ...Object.keys(SHAPE_KINDS).map((k) => (nK(k) ? plural(nK(k), k) : ''))].filter(Boolean).join(', ');
      // Walks (tracks) aren't in groups, so a file with only walks doesn't ask.
      const answer = !what ? '' : prompt(what + ' in this file. Put them in which group? (for example: Mike\'s pins)' +
        (fileGroups.size ? '\nLeave it empty to keep the groups saved in the file, e.g. when restoring your own backup.' : ''), fileGroups.size ? '' : suggest);
      if (answer === null) return toast('Import cancelled');
      const intoGroup = !what ? null : answer.trim() ? cleanGroup(answer) : (fileGroups.size ? null : cleanGroup(suggest));
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
          ...(PIN_COLORS.some(([c]) => c === p.color) ? { color: p.color } : {}),
          group: intoGroup || cleanGroup(p.group),
          ...(!intoGroup && p.hidden ? { hidden: true } : {}), // keep hidden pins hidden when restoring a backup
          created: p.created || Date.now()
        };
        if (typeof p.photoData === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p.photoData)) {
          try { await savePhoto(np.id, await (await fetch(p.photoData)).blob()); np.photo = true; } catch (e) { /* skip the photo, keep the pin */ }
        }
        pins.push(np);
        addMarker(np);
        added++;
      }
      store(STORE.pins, pins);
      let addedShapes = 0;
      for (const x of inShapes) {
        const sh = cleanShape(x, intoGroup);
        const dup = shapes.some((y) => y.kind === sh.kind && y.name === sh.name && y.pts.length === sh.pts.length &&
          Math.abs(y.pts[0][0] - sh.pts[0][0]) < 1e-6 && Math.abs(y.pts[0][1] - sh.pts[0][1]) < 1e-6);
        if (dup) continue;
        shapes.push(sh);
        refreshShape(sh);
        addedShapes++;
      }
      if (addedShapes) saveShapes();
      const addedTracks = importTracks(inTracks);
      if (intoGroup && (added || addedShapes)) hiddenGroups.delete(intoGroup); // show what was just imported
      applyFilter();
      closeSheets();
      const got = [added ? plural(added, 'pin') : '', addedShapes ? addedShapes + (addedShapes === 1 ? ' line, area or route' : ' lines, areas and routes') : '', addedTracks ? plural(addedTracks, 'walk') : ''].filter(Boolean).join(' and ');
      toast(got ? 'Imported ' + got + (intoGroup ? ' into "' + intoGroup + '"' : '') : 'Nothing new to import');
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
  $('pinCat').addEventListener('change', () => { syncDateField(editing ? editing.isNew : false); renderSwatches(); });

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
  function openSun(ymd) { $('sunDate').value = ymd || chiDate(); fillSun(); showSheet('sunSheet'); }
  $('sunChip').addEventListener('click', () => openSun());
  $('sunDate').addEventListener('change', fillSun);

  // ---------- Whitetail rut calendar (Minnesota, statewide) ----------
  // Peak anchored on Nov 12 / Nov 10-14 conception (MN DNR White-tailed Deer Handbook 2000;
  // Fuller 1990 northern MN data). The other boundaries are estimates, not DNR dates.
  // Month/day ranges, inclusive, the same every year.
  const RUT = [
    { name: 'Pre-rut', short: 'Pre', from: [9, 1], to: [10, 14],
      what: 'Bucks are in hard antler, making their first rubs and scrapes and getting territorial. Few does are close to breeding yet.',
      tip: 'Look for fresh rubs and early scrapes, and pattern bucks on their food sources.' },
    { name: 'Seeking', short: 'Seek', from: [10, 15], to: [10, 31],
      what: 'Mature bucks are ready to breed but few does are, so bucks travel and search. The DNR calls the last half of October a very active time for mature bucks.',
      tip: 'Hunt scrape lines, travel corridors, and the routes does use between bedding and food.' },
    { name: 'Chasing', short: 'Chase', from: [11, 1], to: [11, 9],
      what: 'More does are coming into heat, and bucks start pushing and chasing them. Buck movement can pick up a lot.',
      tip: 'Sit longer, including midday. Stay near doe bedding areas and the trails between them.' },
    { name: 'Peak rut', short: 'Peak', from: [11, 10], to: [11, 16], peak: true,
      what: 'Core breeding. About half of adult does are bred by the week of November 12. Bucks often stay with one doe for a day or more, so you may see fewer bucks even at the height of the rut.',
      tip: 'Hunt where the does are. A buck tending a doe goes wherever she goes.' },
    { name: 'Post-rut', short: 'Post', from: [11, 17], to: [12, 15],
      what: 'Most adult does are bred. Worn-down bucks turn back to food to recover before winter.',
      tip: 'Hunt food sources, especially on cold days.' }
  ];
  const SECOND_RUT = { from: [12, 8], to: [12, 12] };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const md = (a) => MON[a[0] - 1] + ' ' + a[1];
  const mdRange = (ph) => ph.from[0] === ph.to[0] ? md(ph.from) + '–' + ph.to[1] : md(ph.from) + ' – ' + md(ph.to);
  const dayNum = (y, a) => Date.UTC(y, a[0] - 1, a[1]) / 86400000; // whole days since 1970, no time zone games
  function fillRut() {
    const ymd = $('rutDate').value || chiDate();
    const [y, m, d] = ymd.split('-').map(Number);
    const today = Date.UTC(y, m - 1, d) / 86400000;
    const idx = RUT.findIndex((ph) => today >= dayNum(y, ph.from) && today <= dayNum(y, ph.to));
    const ph = RUT[idx];
    const days = (n) => n === 1 ? 'tomorrow' : 'in ' + n + ' days';
    if (ph) {
      const left = dayNum(y, ph.to) - today + 1, len = dayNum(y, ph.to) - dayNum(y, ph.from) + 1;
      $('rutNow').textContent = ph.name + ' · ' + mdRange(ph) + ' · day ' + (len - left + 1) + ' of ' + len;
      const nx = RUT[idx + 1];
      $('rutNext').textContent = nx ? nx.name + ' starts ' + md(nx.from) + ', ' + days(dayNum(y, nx.from) - today) + '.' : 'The rut season wraps up after ' + md(ph.to) + '.';
      $('rutWhat').textContent = ph.what;
      $('rutTip').textContent = 'Where to hunt: ' + ph.tip;
    } else {
      const startY = today < dayNum(y, RUT[0].from) ? y : y + 1;
      $('rutNow').textContent = 'Outside the rut season';
      $('rutNext').textContent = 'Pre-rut starts ' + md(RUT[0].from) + ', ' + days(dayNum(startY, RUT[0].from) - today) + '. Peak breeding is usually ' + mdRange(RUT[3]) + ', centered on Nov 12.';
      $('rutWhat').textContent = '';
      $('rutTip').textContent = '';
    }
    const s2a = dayNum(y, SECOND_RUT.from), s2b = dayNum(y, SECOND_RUT.to);
    const notes = [];
    if (idx === 4) notes.push(today >= s2a && today <= s2b
      ? 'Second rut: does that weren\'t bred come back into heat about 28 days after the peak, and some doe fawns breed in December. Expect a smaller burst of chasing around now.'
      : 'A smaller second rut is possible around Dec 8–12, when does that weren\'t bred come back into heat (about 28 days after the peak).');
    const info = sunInfo(ymd);
    if (info && inIL(info.lat, info.lng) && !inMN(info.lat, info.lng)) notes.push('These dates come from Minnesota research, not Illinois data.');
    $('rutNote').textContent = notes.join(' ');
    // Timeline: one equal-width box per phase, the current one highlighted with a marker for the date.
    const bar = $('rutBar');
    bar.replaceChildren();
    RUT.forEach((p2, i) => {
      const li = document.createElement('li');
      if (p2.peak) li.classList.add('peak');
      if (i === idx) {
        li.classList.add('now');
        const mark = document.createElement('span');
        mark.className = 'mark';
        const len = dayNum(y, p2.to) - dayNum(y, p2.from) + 1;
        mark.style.left = ((today - dayNum(y, p2.from) + 0.5) / len * 100) + '%';
        li.appendChild(mark);
      }
      const n = document.createElement('b');
      n.textContent = p2.short;
      const dt = document.createElement('span');
      dt.textContent = md(p2.from);
      li.append(n, dt);
      bar.appendChild(li);
    });
  }
  $('btnSunClose').addEventListener('click', closeSheets);
  let firstFix = false;
  map.on('moveend', updateSunChip);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateSunChip(); });
  updateSunChip();

  // ---------- Insights sheet (rut calendar; hunting seasons later) ----------
  $('btnInsights').addEventListener('click', () => { $('rutDate').value = chiDate(); fillRut(); showSheet('insightsSheet'); loadDpa(false); });
  $('rutDate').addEventListener('change', () => { fillRut(); renderDpa(); });
  $('btnDpaRefresh').addEventListener('click', () => loadDpa(true));

  // ---------- Deer seasons for the permit area you're in (MN DNR permit-area data) ----------
  // The DNR's deer permit area layer carries this year's season dates for every area, and it
  // allows apps on other sites to read it, so no scraping is needed. Updated by the DNR each year.
  const DPA_URL = 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_deer_permit_areas/MapServer/0/query';
  const DPA_FIELDS = 'dpa,zone_,designatio,archery,firearma,firearmb,muzzleload,effperiod';
  const SEASONS = [['archery', 'Archery'], ['firearma', 'Firearms A'], ['firearmb', 'Firearms B'], ['muzzleload', 'Muzzleloader']];
  let dpa = recall(STORE.dpa, null); // { attrs, at, lat, lng, where }
  let dpaBusy = false;
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  // "Sept. 19 to Dec. 31, 2026" (the year is sometimes left off) -> two [y, m, d] dates; null for "N/A".
  function parseSeason(txt, yearHint) {
    const m = String(txt || '').match(/([A-Za-z]+)\.?\s+(\d{1,2})\s*(?:to|-|–)\s*([A-Za-z]+)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/);
    if (!m) return null;
    const m1 = MONTHS[m[1].toLowerCase()], m2 = MONTHS[m[3].toLowerCase()];
    if (!m1 || !m2) return null;
    const y2 = m[5] ? +m[5] : yearHint;
    const y1 = m1 > m2 ? y2 - 1 : y2;
    return { from: [y1, m1, +m[2]], to: [y2, m2, +m[4]] };
  }
  const ymdNum = (a) => Date.UTC(a[0], a[1] - 1, a[2]) / 86400000;
  function rutPhasesFor(r) {
    const a = ymdNum(r.from), b = ymdNum(r.to);
    const hit = RUT.filter((ph) => dayNum(r.from[0], ph.from) <= b && dayNum(r.from[0], ph.to) >= a);
    if (hit.length === RUT.length) return 'the whole rut';
    const names = hit.map((ph) => ph.name.toLowerCase());
    if (dayNum(r.from[0], SECOND_RUT.from) <= b && dayNum(r.from[0], SECOND_RUT.to) >= a) names.push('the possible second rut');
    return names.length ? names.join(', ') : 'outside the rut';
  }
  function renderDpa(status) {
    const head = $('dpaHead'), info = $('dpaInfo'), list = $('dpaSeasons'), note = $('dpaNote');
    list.replaceChildren();
    if (!dpa) {
      head.textContent = '';
      info.textContent = status || 'Tap the button to look up your permit area.';
      note.textContent = '';
      return;
    }
    const a = dpa.attrs;
    const yearHint = +((String(a.effperiod || '').match(/(\d{4})/) || [])[1]) || new Date().getFullYear();
    head.textContent = 'Deer permit area ' + a.dpa + (a.zone_ ? ' · zone ' + a.zone_ : '');
    info.textContent = [a.designatio && a.designatio.trim(), status].filter(Boolean).join(' · ');
    const pick = $('rutDate').value || chiDate();
    const [py, pm, pd] = pick.split('-').map(Number);
    const today = Date.UTC(py, pm - 1, pd) / 86400000;
    for (const [key, label] of SEASONS) {
      const r = parseSeason(a[key], yearHint);
      if (!r && (!a[key] || /^n\/?a$/i.test(String(a[key]).trim()))) continue; // no such season here
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      if (!r) { dd.textContent = String(a[key]); list.append(dt, dd); continue; }
      const f = ymdNum(r.from), t = ymdNum(r.to);
      let when;
      if (today < f) when = 'opens in ' + (f - today) + ' day' + (f - today === 1 ? '' : 's');
      else if (today <= t) when = 'open, ' + (t - today === 0 ? 'last day' : (t - today) + ' day' + (t - today === 1 ? '' : 's') + ' left');
      else when = 'closed';
      const main = document.createElement('span');
      main.textContent = md([r.from[1], r.from[2]]) + ' – ' + md([r.to[1], r.to[2]]);
      const sub = document.createElement('span');
      sub.className = 'ssub' + (today >= f && today <= t ? ' open' : '');
      sub.textContent = when + ' · ' + rutPhasesFor(r);
      dd.append(main, sub);
      list.append(dt, dd);
    }
    const saved = new Date(dpa.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    note.textContent = 'From the MN DNR permit-area data for ' + (a.effperiod || 'this season') + ', looked up ' + saved + ' at ' + dpa.where + '. Seasons can differ by zone and special hunt. Always confirm in the current DNR regulations before you hunt.';
  }
  function getFix(fresh) {
    return new Promise((resolve) => {
      if (me && Date.now() - me.t < (fresh ? 30000 : 120000)) return resolve({ lat: me.lat, lng: me.lng, where: 'your location' });
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, where: 'your location' }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: fresh ? 0 : 300000 }
      );
    });
  }
  async function loadDpa(force) {
    if (dpaBusy) return;
    // Use the saved area if it was looked up today, unless asked to refresh.
    if (!force && dpa && Date.now() - dpa.at < 6 * 3600000) return renderDpa();
    dpaBusy = true;
    renderDpa('Finding your location…');
    try {
      let pt = await getFix(force);
      if (!pt) {
        const c = map.getCenter();
        pt = { lat: c.lat, lng: c.lng, where: 'the map center (no GPS)' };
      }
      if (!inMN(pt.lat, pt.lng)) {
        renderDpa(dpa ? 'You are outside Minnesota, so this is your last Minnesota area.' : '');
        if (!dpa) $('dpaInfo').textContent = 'Deer permit areas are Minnesota only.';
        return;
      }
      renderDpa('Looking up your permit area…');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      const q = '?geometry=' + pt.lng.toFixed(5) + ',' + pt.lat.toFixed(5) + '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=' + DPA_FIELDS + '&returnGeometry=false&f=json';
      const res = await fetch(DPA_URL + q, { signal: ctl.signal });
      clearTimeout(timer);
      const data = await res.json();
      const f = data && data.features && data.features[0];
      if (!f) {
        renderDpa(dpa ? 'No permit area found at ' + pt.where + '. Showing your last one.' : '');
        if (!dpa) $('dpaInfo').textContent = 'No deer permit area found at ' + pt.where + '.';
        return;
      }
      dpa = { attrs: f.attributes, at: Date.now(), lat: pt.lat, lng: pt.lng, where: pt.where };
      store(STORE.dpa, dpa);
      renderDpa();
    } catch (e) {
      renderDpa(dpa ? 'No signal, so this is your saved area.' : '');
      if (!dpa) $('dpaInfo').textContent = 'Could not look up your permit area. It needs a signal the first time.';
    } finally {
      dpaBusy = false;
    }
  }
  $('btnInsSun').addEventListener('click', () => openSun($('rutDate').value));
  $('btnInsClose').addEventListener('click', closeSheets);

  // ---------- Track recording ----------
  // A track (a recorded walk): { id, name, start, end, pts: [[lat, lng, unixSeconds, gap?], ...], meters, color?, notes?, shown?, elev? }
  // gap = 1 marks the first point after a pause, so the pause doesn't count as distance or walking time.
  const TRACK_COLOR = '#ef6c00';
  const trackMeters = (pts) => {
    let m = 0;
    for (let i = 1; i < pts.length; i++) if (!pts[i][3]) m += dist({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] });
    return m;
  };
  let tracks = recall(STORE.tracks, []);
  tracks.forEach((t) => {
    if (!t.end) t.end = t.pts.length ? t.pts[t.pts.length - 1][2] * 1000 : t.start;
    if (typeof t.meters !== 'number') t.meters = trackMeters(t.pts);
    delete t.paused; delete t.gapNext;
  });
  let rec = null;
  let wakeLock = null;
  const trackLines = new Map();
  const saveTracks = () => store(STORE.tracks, tracks);
  const fmtDur = (ms) => {
    const m = Math.round(ms / 60000);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  };
  const trackColor = (t) => (PIN_COLORS.some(([c]) => c === t.color) ? t.color : TRACK_COLOR);
  // Moving time counts the stretches where you were walking at least 0.2 m/s (about half a mile an hour).
  function trackStats(t) {
    let moving = 0;
    for (let i = 1; i < t.pts.length; i++) {
      const a = t.pts[i - 1], b = t.pts[i];
      const dt = b[2] - a[2];
      if (b[3] || dt <= 0 || dt > 120) continue;
      if (dist({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) / dt >= 0.2) moving += dt;
    }
    return { total: (t.end || Date.now()) - t.start, moving: moving * 1000, mph: moving > 30 ? t.meters / moving * 2.23694 : 0 };
  }
  function trackSummary(t) {
    const st = trackStats(t), e = elevFor(t);
    return [fmtDist(t.meters), fmtDur(st.total), st.mph ? st.mph.toFixed(1) + ' mph' : '', e ? elevText(e) : ''].filter(Boolean).join(' · ');
  }

  function showTrack(t, active) {
    const ll = t.pts.map((p) => [p[0], p[1]]);
    let l = trackLines.get(t.id);
    if (!l) {
      l = L.polyline(ll, { color: active ? '#d84315' : trackColor(t), weight: 4, opacity: 0.9, dashArray: active ? null : '10 6', interactive: !active }).addTo(map);
      l.on('click', (e) => { if (!draw) L.popup().setLatLng(e.latlng).setContent(trackPopup(t)).openOn(map); });
      trackLines.set(t.id, l);
    } else l.setLatLngs(ll);
    if (!active && !t.shown) { t.shown = true; saveTracks(); }
  }
  function hideTrack(id, keepShown) {
    const l = trackLines.get(id);
    if (l) { map.removeLayer(l); trackLines.delete(id); }
    const t = tracks.find((x) => x.id === id);
    if (t && t.shown && !keepShown) { delete t.shown; saveTracks(); }
  }
  function restyleTrack(t) {
    if (!trackLines.has(t.id)) return;
    hideTrack(t.id, true);
    showTrack(t, false);
  }
  tracks.forEach((t) => { if (t.shown && t.pts.length > 1) showTrack(t, false); });

  function trackPopup(t) {
    const div = document.createElement('div');
    div.className = 'pp';
    const h = document.createElement('strong');
    h.textContent = t.name;
    const meta = document.createElement('div');
    meta.className = 'pp-meta';
    meta.textContent = 'Walk · ' + trackSummary(t);
    div.append(h, meta);
    if (t.notes) {
      const n = document.createElement('div');
      n.className = 'pp-notes';
      n.textContent = t.notes;
      div.appendChild(n);
    }
    const actions = document.createElement('div');
    actions.className = 'pp-actions';
    const btn = (label, alt, fn) => {
      const b = document.createElement('button');
      if (alt) b.className = 'alt';
      b.textContent = label;
      b.addEventListener('click', () => { map.closePopup(); fn(); });
      actions.appendChild(b);
    };
    btn('Details', false, () => openTrackDetail(t));
    btn('Follow back', true, () => startFollow(t, true));
    btn('Share', true, () => shareTrack(t));
    btn('Hide', true, () => hideTrack(t.id));
    div.appendChild(actions);
    return div;
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
    if (rec && !rec.paused && document.visibilityState === 'visible') keepAwake();
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
  function pauseTrack() {
    if (!rec) return;
    rec.paused = !rec.paused;
    if (rec.paused) { releaseAwake(); toast('Paused. Distance and time stop counting until you resume.', 4000); }
    else { rec.gapNext = true; keepAwake(); toast('Recording again'); }
    saveTracks();
    updateTrackUI();
  }
  function stopTrack() {
    if (!rec) return;
    const t = rec;
    rec = null;
    releaseAwake();
    delete t.paused; delete t.gapNext;
    t.end = Date.now();
    hideTrack(t.id, true);
    if (t.pts.length < 2) {
      tracks = tracks.filter((x) => x !== t);
      toast('That walk was too short to save.');
    } else {
      showTrack(t, false);
      toast('Saved ' + fmtDist(t.meters) + ' in ' + fmtDur(t.end - t.start));
      ensureElev(t, saveTracks);
    }
    saveTracks();
    updateTrackUI();
    if (!$('trackSheet').hidden) renderTrackList();
  }
  function addTrackPoint(lat, lng, acc) {
    if (!rec || rec.paused || acc > 35) return;
    const last = rec.pts[rec.pts.length - 1];
    const gap = rec.gapNext && last;
    if (last && !gap) {
      const d = dist({ lat: last[0], lng: last[1] }, { lat, lng });
      if (d < Math.max(6, acc / 2)) return;
      rec.meters += d;
    }
    delete rec.gapNext;
    rec.pts.push([+lat.toFixed(5), +lng.toFixed(5), Math.round(Date.now() / 1000), ...(gap ? [1] : [])]);
    const l = trackLines.get(rec.id);
    if (l) l.addLatLng([lat, lng]);
    if (rec.pts.length % 10 === 0) saveTracks();
    if (rec.pts.length >= 20000) { toast('Track is full, so recording stopped.'); stopTrack(); return; }
    updateTrackUI();
  }
  function recStatus() {
    if (!rec) return 'Not recording';
    const st = trackStats(rec);
    return (rec.paused ? 'Paused' : 'Recording') + ' · ' + fmtDist(rec.meters) + ' · ' + fmtDur(st.total) + (st.mph ? ' · ' + st.mph.toFixed(1) + ' mph' : '') + ' · ' + rec.pts.length + ' points';
  }
  function updateTrackUI() {
    $('fabTrack').classList.toggle('rec', !!rec && !rec.paused);
    $('fabTrackLbl').textContent = rec ? (rec.paused ? 'Paused' : fmtDist(rec.meters)) : 'Track';
    $('btnTrkToggle').textContent = rec ? 'Stop & save' : 'Start recording';
    $('btnTrkToggle').classList.toggle('danger', !!rec);
    $('btnTrkToggle').classList.toggle('primary', !rec);
    $('btnTrkPause').hidden = !rec;
    $('btnTrkPause').textContent = rec && rec.paused ? '▶ Resume' : '⏸ Pause';
    if (!$('trackSheet').hidden) $('trkStatus').textContent = recStatus();
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
      const info = document.createElement('button');
      info.className = 'trkinfo';
      const sw = document.createElement('span');
      sw.className = 'tsw';
      sw.style.setProperty('--c', trackColor(t));
      const tx = document.createElement('span');
      const a = document.createElement('span');
      a.className = 'pt';
      a.textContent = t.name;
      const b = document.createElement('span');
      b.className = 'ps';
      b.textContent = new Date(t.start).toLocaleDateString('en-US', { timeZone: CHI, month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + trackSummary(t);
      tx.append(a, b);
      info.append(sw, tx);
      info.addEventListener('click', () => openTrackDetail(t));
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
      li.append(info, show);
      ul.appendChild(li);
    }
  }
  function openTrackSheet() {
    showSheet('trackSheet');
    updateTrackUI();
    renderTrackList();
    $('trkStatus').textContent = recStatus();
  }
  $('fabTrack').addEventListener('click', openTrackSheet);
  $('btnTrkToggle').addEventListener('click', () => { if (rec) stopTrack(); else startTrack(); });
  $('btnTrkPause').addEventListener('click', pauseTrack);
  $('btnTrkClose').addEventListener('click', closeSheets);

  // Walk details: stats, elevation, rename, color, notes, follow back, share, save as a route.
  let trackEditing = null, trackPicked = '';
  function renderTrackSwatches() {
    makeSwatches($('tdColors'), trackPicked, '', (c) => { trackPicked = c; renderTrackSwatches(); });
  }
  function fillTrackStats(t) {
    const st = trackStats(t), e = elevFor(t);
    const rows = [
      ['Distance', fmtDist(t.meters)],
      ['Total time', fmtDur(st.total)],
      ['Moving time', st.moving ? fmtDur(st.moving) : '—'],
      ['Average speed', st.mph ? st.mph.toFixed(1) + ' mph (while moving)' : '—'],
      ['Climb', e ? ftOf(e.gain) : '—'],
      ['Descent', e ? ftOf(e.loss) : '—'],
      ['Started', new Date(t.start).toLocaleString('en-US', { timeZone: CHI, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })]
    ];
    $('tdStats').replaceChildren(...rows.flatMap(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; return [dt, dd]; }));
  }
  function openTrackDetail(t) {
    trackEditing = t;
    $('tdName').value = t.name;
    $('tdNotes').value = t.notes || '';
    trackPicked = trackColor(t);
    renderTrackSwatches();
    fillTrackStats(t);
    renderElevBox($('tdElev'), t, saveTracks, () => { if (trackEditing === t) fillTrackStats(t); });
    showSheet('trackDetail');
  }
  $('btnTdSave').addEventListener('click', () => {
    const t = trackEditing;
    if (!t) return;
    t.name = $('tdName').value.trim().slice(0, 60) || t.name;
    t.notes = $('tdNotes').value.trim().slice(0, 500);
    if (!t.notes) delete t.notes;
    if (trackPicked && trackPicked !== TRACK_COLOR) t.color = trackPicked; else delete t.color;
    saveTracks();
    restyleTrack(t);
    trackEditing = null;
    openTrackSheet();
    toast('Walk saved');
  });
  $('btnTdBack').addEventListener('click', () => { trackEditing = null; openTrackSheet(); });
  $('btnTdFollow').addEventListener('click', () => { const t = trackEditing; trackEditing = null; if (t) startFollow(t, true); });
  $('btnTdShare').addEventListener('click', () => { if (trackEditing) shareTrack(trackEditing); });
  $('btnTdRoute').addEventListener('click', () => {
    const t = trackEditing;
    if (!t) return;
    trackEditing = null;
    // Drop points closer than 5 m apart and keep at most 1500, so the route stays light.
    let pts = [];
    for (const p of t.pts) {
      const q = [+p[0].toFixed(6), +p[1].toFixed(6)];
      const last = pts[pts.length - 1];
      if (!last || dist({ lat: last[0], lng: last[1] }, { lat: q[0], lng: q[1] }) >= 5) pts.push(q);
    }
    const lastP = t.pts[t.pts.length - 1];
    if (pts.length < 2) pts.push([lastP[0], lastP[1]]);
    if (pts.length > 1500) { const step = (pts.length - 1) / 1499; pts = Array.from({ length: 1500 }, (_, i) => pts[Math.round(i * step)]); }
    openShapeEditor({ kind: 'route', pts, name: t.name.replace(/^Walk/, 'Route'), notes: t.notes || '' }, true);
  });
  $('btnTdDelete').addEventListener('click', () => {
    const t = trackEditing;
    if (!t || !confirm('Delete "' + t.name + '"?')) return;
    hideTrack(t.id, true);
    if (follow && follow.obj === t) stopFollow();
    tracks = tracks.filter((x) => x !== t);
    saveTracks();
    trackEditing = null;
    openTrackSheet();
  });

  const escXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  // GPX for walks; a pause starts a new segment.
  function tracksGPX(list) {
    const body = list.map((t) => {
      const segs = [[]];
      t.pts.forEach((p) => { if (p[3]) segs.push([]); segs[segs.length - 1].push(p); });
      return '  <trk>\n    <name>' + escXml(t.name) + '</name>\n' + (t.notes ? '    <desc>' + escXml(t.notes) + '</desc>\n' : '') +
        segs.map((sg) => '    <trkseg>\n' + sg.map((p) => '      <trkpt lat="' + p[0] + '" lon="' + p[1] + '"><time>' + new Date(p[2] * 1000).toISOString() + '</time></trkpt>').join('\n') + '\n    </trkseg>').join('\n') +
        '\n  </trk>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Woods Map" xmlns="http://www.topografix.com/GPX/1/1">\n' + body + '\n</gpx>\n';
  }
  async function shareTrack(t) {
    const fname = t.name.replace(/[^\w-]+/g, '_') + '.gpx';
    const gpx = tracksGPX([t]);
    const file = new File([gpx], fname, { type: 'application/gpx+xml' });
    const text = '🥾 ' + t.name + '\n' + trackSummary(t) + (t.notes ? '\n' + t.notes : '') + '\nOpen the attached GPX in Woods Map (More > Import pins), onX, Google Earth or another map app.';
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ title: t.name, text, files: [file] }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    download(fname, gpx, 'application/gpx+xml');
    toast('Saved ' + fname + '. Send that file to share it.', 4500);
  }
  $('btnTrkGpx').addEventListener('click', () => {
    const done = tracks.filter((t) => t !== rec && t.pts.length > 1);
    if (!done.length) return toast('No saved walks to export yet');
    download('woods-map-tracks-' + stamp() + '.gpx', tracksGPX(done), 'application/gpx+xml');
  });
  // Walks from a Woods Map backup. Skips ones already here (same id or same start time).
  function importTracks(list) {
    let n = 0;
    for (const x of list) {
      if (!x || !Array.isArray(x.pts) || !isFinite(x.start)) continue;
      if (tracks.some((t) => t.id === x.id || t.start === x.start)) continue;
      const pts = x.pts.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2])).slice(0, 20000)
        .map((p) => [+p[0], +p[1], +p[2], ...(p[3] ? [1] : [])]);
      if (pts.length < 2) continue;
      const t = {
        id: typeof x.id === 'string' ? x.id.slice(0, 64) : newId(),
        name: String(x.name || 'Walk').slice(0, 60),
        start: +x.start,
        end: isFinite(x.end) ? +x.end : pts[pts.length - 1][2] * 1000,
        pts,
        meters: trackMeters(pts),
        ...(PIN_COLORS.some(([c]) => c === x.color) ? { color: x.color } : {}),
        ...(x.notes ? { notes: String(x.notes).slice(0, 500) } : {}),
        ...(x.elev && x.elev.k === elevKey(pts) && Array.isArray(x.elev.prof) ? { elev: x.elev } : {})
      };
      tracks.push(t);
      n++;
    }
    if (n) { tracks.sort((a, b) => b.start - a.start); saveTracks(); }
    return n;
  }
  updateTrackUI();

  // ---------- Follow a route, line or walk ----------
  // Shows distance to go along it, time, and which way to head; warns when you're off it and points back.
  let followGlow = null, followLink = null;
  function startFollow(obj, reverse) {
    const path = obj.pts.map((p) => [p[0], p[1]]);
    if (path.length < 2) return;
    stopFollow(true);
    target = null;
    if (navLine) { map.removeLayer(navLine); navLine = null; }
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] }));
    // Lines and routes: head for whichever end is farther from you.
    if (reverse === undefined) reverse = !!(me && dist(me, { lat: path[path.length - 1][0], lng: path[path.length - 1][1] }) < dist(me, { lat: path[0][0], lng: path[0][1] }));
    follow = { obj, path, cum, total: cum[cum.length - 1], reverse, lastS: null, arrived: false };
    followGlow = L.polyline(path, { color: '#e8b53a', weight: 11, opacity: 0.45, interactive: false }).addTo(map);
    closeSheets();
    map.closePopup();
    if (watchId === null) { centerOnFix = false; startGPS(); }
    map.fitBounds(followGlow.getBounds().pad(0.15), { maxZoom: 17 });
    toast('Following "' + obj.name + '" to its ' + (reverse ? 'start' : 'end') + '.', 3500);
    updateNav();
  }
  function stopFollow(quiet) {
    if (!follow) return;
    follow = null;
    if (followGlow) { map.removeLayer(followGlow); followGlow = null; }
    if (followLink) { map.removeLayer(followLink); followLink = null; }
    if (!quiet) updateNav();
  }
  // Nearest spot on the path to p: { off: meters away, s: meters along the path, lat, lng }.
  function projectOnPath(f, p) {
    const k = Math.cos(rad(p.lat)), M = 111320;
    const X = (q) => (q[1] - p.lng) * k * M, Y = (q) => (q[0] - p.lat) * M;
    let best = null;
    for (let i = 1; i < f.path.length; i++) {
      const ax = X(f.path[i - 1]), ay = Y(f.path[i - 1]), dx = X(f.path[i]) - ax, dy = Y(f.path[i]) - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const px = ax + t * dx, py = ay + t * dy;
      const c = { off: Math.hypot(px, py), s: f.cum[i - 1] + t * (f.cum[i] - f.cum[i - 1]), lat: p.lat + py / M, lng: p.lng + px / (k * M) };
      if (!best) best = c;
      // Where the path doubles back near itself, stay on the stretch you were already on.
      else if (f.lastS !== null && Math.abs(c.off - best.off) < 20) { if (Math.abs(c.s - f.lastS) < Math.abs(best.s - f.lastS)) best = c; }
      else if (c.off < best.off) best = c;
    }
    return best;
  }
  function pointAt(f, s) {
    s = Math.max(0, Math.min(f.total, s));
    let i = 1;
    while (i < f.cum.length - 1 && f.cum[i] < s) i++;
    const seg = f.cum[i] - f.cum[i - 1], t = seg ? (s - f.cum[i - 1]) / seg : 0;
    const a = f.path[i - 1], b = f.path[i];
    return { lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t };
  }
  function updateFollow() {
    $('navinfo').hidden = false;
    const name = follow.obj.name || 'Route';
    if (!me) { $('navtext').textContent = name + ': waiting for GPS…'; return; }
    const pr = projectOnPath(follow, me);
    follow.lastS = pr.s;
    const toGo = follow.reverse ? pr.s : follow.total - pr.s;
    const off = pr.off > 35;
    const end = follow.reverse ? 'start' : 'end';
    if (toGo < 20 && !off) {
      $('navtext').textContent = name + ' · you\'re at the ' + end;
      if (!follow.arrived) { follow.arrived = true; toast('You made it to the ' + end + ' of "' + name + '".', 5000); }
    } else {
      const aim = off ? pr : pointAt(follow, pr.s + (follow.reverse ? -30 : 30));
      const br = bearing(me, aim);
      $('navtext').textContent = name + ' · ' + fmtDist(toGo) + ' to go · about ' + fmtTime(walkMin(toGo)) +
        (off ? ' · off route ' + fmtDist(pr.off) + ', go ' : ' · head ') + compass(br) + ' ' + Math.round(br) + '°';
    }
    const link = [[me.lat, me.lng], [pr.lat, pr.lng]];
    if (off) {
      if (!followLink) followLink = L.polyline(link, { color: '#e8b53a', weight: 4, dashArray: '8 8', interactive: false }).addTo(map);
      else followLink.setLatLngs(link);
    } else if (followLink) { map.removeLayer(followLink); followLink = null; }
  }

  // ---------- Back to truck ----------
  let pendingTruck = false;
  function goTruck() {
    const trucks = pins.filter((p) => p.cat === 'truck' && isShown(p)); // hidden pins (e.g. a friend's group) are skipped
    if (!trucks.length) {
      if (pins.some((p) => p.cat === 'truck')) return toast('Your Parking / truck pins are hidden. Turn them on under Pins > Show on map.', 5500);
      return toast('Add a pin with the type "Parking / truck" first. Then this button leads you back to it.', 5500);
    }
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

  // ---------- Show / hide pins by type and group ----------
  function saveHidden() {
    store(STORE.hiddenTypes, [...hiddenTypes]);
    store(STORE.hiddenGroups, [...hiddenGroups]);
  }
  function hiddenSummary() {
    const t = hiddenTypes.size, g = [...hiddenGroups].filter((x) => groupNames().includes(x)).length;
    const one = pins.filter((p) => p.hidden).length + shapes.filter((sh) => sh.hidden).length;
    if (!t && !g && !one) return '';
    const shownTypes = Object.keys(CATS).filter((k) => !hiddenTypes.has(k));
    if (shapes.length && Object.keys(SHAPE_KINDS).some((k) => !hiddenTypes.has('_' + k))) shownTypes.push('');
    const parts = [];
    if (t) parts.push(shownTypes.length === 1 && shownTypes[0] ? 'only ' + CATS[shownTypes[0]].label : t + ' type' + (t === 1 ? '' : 's') + ' hidden');
    if (g) parts.push(g + ' group' + (g === 1 ? '' : 's') + ' hidden');
    if (one) parts.push(one + ' item' + (one === 1 ? '' : 's') + ' hidden');
    return parts.join(', ');
  }
  function renderShowBox() {
    const chips = $('typeChips');
    chips.replaceChildren();
    // Only the types you've used (or hidden), so the list stays short.
    const used = Object.entries(CATS).filter(([k]) => hiddenTypes.has(k) || pins.some((p) => (CATS[p.cat] ? p.cat : 'other') === k));
    for (const [kind, sk] of Object.entries(SHAPE_KINDS)) {
      if (hiddenTypes.has('_' + kind) || shapes.some((sh) => sh.kind === kind)) used.push(['_' + kind, { icon: sk.icon, short: sk.label + 's', label: sk.label + 's' }]);
    }
    if (!used.length) chips.textContent = 'No pins yet.';
    for (const [k, c] of used) {
      const b = document.createElement('button');
      b.textContent = c.icon + ' ' + c.short;
      b.title = c.label;
      b.setAttribute('aria-pressed', String(!hiddenTypes.has(k)));
      b.addEventListener('click', () => {
        if (hiddenTypes.has(k)) hiddenTypes.delete(k); else hiddenTypes.add(k);
        applyFilter();
      });
      chips.appendChild(b);
    }
    const box = $('groupChecks');
    box.replaceChildren();
    for (const g of groupNames()) {
      const n = pins.filter((p) => groupOf(p) === g).length + shapes.filter((sh) => groupOf(sh) === g).length;
      const lab = document.createElement('label');
      lab.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !hiddenGroups.has(g);
      cb.addEventListener('change', () => {
        if (cb.checked) hiddenGroups.delete(g); else hiddenGroups.add(g);
        applyFilter();
      });
      const name = document.createElement('span');
      name.textContent = g + ' ';
      const cnt = document.createElement('span');
      cnt.className = 'gcount';
      cnt.textContent = '(' + n + ')';
      name.appendChild(cnt);
      lab.append(cb, name);
      box.appendChild(lab);
    }
    $('showSummary').textContent = hiddenSummary() || 'all pins';
  }
  function applyFilter() {
    saveHidden();
    pins.forEach(syncVisibility);
    shapes.forEach(syncShape);
    const sum = hiddenSummary();
    const chip = $('filterChip');
    chip.hidden = !sum;
    if (sum) chip.textContent = 'Pins: ' + sum + ' · show all ✕';
    if (!$('pinsSheet').hidden) { renderShowBox(); renderList(); }
  }
  function showAllPins() {
    hiddenTypes.clear();
    hiddenGroups.clear();
    if (pins.some((p) => p.hidden)) { pins.forEach((p) => { delete p.hidden; }); store(STORE.pins, pins); }
    if (shapes.some((sh) => sh.hidden)) { shapes.forEach((sh) => { delete sh.hidden; }); saveShapes(); }
    applyFilter();
  }
  $('btnShowAll').addEventListener('click', showAllPins);
  $('filterChip').addEventListener('click', showAllPins);
  applyFilter();

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

  openSharedLink();
  window.addEventListener('hashchange', openSharedLink);

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
