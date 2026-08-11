// ══════════════════════════════════════════════
// ── 地圖模組 (map.js) - 修復版 ──
// ══════════════════════════════════════════════

// 安全讀取全域變數 / 防呆預設值
const _DEFAULT_BRIGHTNESS = typeof DEFAULT_BRIGHTNESS !== 'undefined' ? DEFAULT_BRIGHTNESS : 0.9;

const NLSC_URL  = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}';
const NLSC_DARK = 'https://wmts.nlsc.gov.tw/wmts/EMAP5/default/GoogleMapsCompatible/{z}/{y}/{x}';
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJgCC==';

const _TILE_VER = Date.now();

function buildTile(dark) {
  const baseUrl = dark ? NLSC_DARK : NLSC_URL;
  return L.tileLayer(`${baseUrl}?v=${_TILE_VER}`, {
    maxZoom: 19, tileSize: 256, crossOrigin: true,
    errorTileUrl: BLANK, opacity: 1,
    attribution: '\u00a9 \u570b\u571f\u6e2c\u7e6a\u4e2d\u5fc3'
  });
}

function applyBrightness(val) {
  if (typeof map === 'undefined' || !map || !map.getPane) return;
  const pane = map.getPane('tilePane');
  if (pane) pane.style.filter = `brightness(${val})`;
}

function initMap() {
  if (typeof L === 'undefined') {
    console.error('Leaflet (L) 未載入！');
    return;
  }

  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([24.8039, 120.9647], 14);
  tileLayer = buildTile(true).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);

  map.on('zoomstart', function() {
    const pane = map.getPane('tilePane');
    if (pane) { pane._brightnessFilter = pane.style.filter; pane.style.filter = ''; }
  });
  map.on('zoomend', function() {
    const pane = map.getPane('tilePane');
    if (pane && pane._brightnessFilter !== undefined) pane.style.filter = pane._brightnessFilter;
  });

  applyBrightness(_DEFAULT_BRIGHTNESS);

  // 右鍵選單
  const ctxMenu = document.getElementById('ctx-menu');
  if (ctxMenu) {
    map.on('contextmenu', e => {
      e.originalEvent.preventDefault();
      const lat = e.latlng.lat, lng = e.latlng.lng;
      const [east, north] = typeof to3826 === 'function' ? to3826(lng, lat) : [0, 0];
      _ctxCoord = { lat, lng, east, north };
      const el97 = document.getElementById('ctx-97-val');
      const elWgs = document.getElementById('ctx-wgs-val');
      if (el97) el97.innerText = `E ${east.toFixed(3)}, N ${north.toFixed(3)}`;
      if (elWgs) elWgs.innerText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      const mx = e.originalEvent.clientX, my = e.originalEvent.clientY;
      ctxMenu.style.left = (mx + 240 > window.innerWidth ? mx - 240 : mx) + 'px';
      ctxMenu.style.top  = (my + 120 > window.innerHeight ? my - 120 : my) + 'px';
      ctxMenu.style.display = 'block';
    });

    const c97 = document.getElementById('ctx-97');
    const cwgs = document.getElementById('ctx-wgs');
    const csv = document.getElementById('ctx-streetview');
    if (c97 && typeof copyCoord === 'function') c97.addEventListener('click', () => copyCoord('97'));
    if (cwgs && typeof copyCoord === 'function') cwgs.addEventListener('click', () => copyCoord('wgs'));
    if (csv && typeof openStreetView === 'function') csv.addEventListener('click', openStreetView);
    document.addEventListener('click', e => { if (!ctxMenu.contains(e.target)) ctxMenu.style.display = 'none'; });
    map.on('click', () => ctxMenu.style.display = 'none');
  }
}

// ── 亮度滑桿 ──
document.addEventListener('DOMContentLoaded', () => {
  const slider     = document.getElementById('map-brightness');
  const valDisplay = document.getElementById('map-brightness-val');
  if (slider && valDisplay) {
    slider.value = _DEFAULT_BRIGHTNESS;
    valDisplay.innerText = Math.round(_DEFAULT_BRIGHTNESS * 100) + '%';

    slider.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      valDisplay.innerText = Math.round(val * 100) + '%';
      if (typeof applyBrightness === 'function') applyBrightness(val);
    });
  }
});

function setOnline(on) {
  const dot = document.getElementById('db-dot'), lbl = document.getElementById('db-label');
  if (dot) { dot.style.background = on ? 'var(--accent)' : 'var(--danger)'; dot.classList.toggle('live', false); }
  if (lbl) { lbl.innerText = on ? 'LIVE' : 'OFFLINE'; lbl.style.color = on ? 'var(--accent)' : 'var(--danger)'; }
  if (typeof rtLog === 'function') {
    rtLog(on ? '✓ Supabase 連線成功，等待 RT channel…' : '✗ DB 連線失敗', on ? '#4edea3' : '#ff6b7a');
  }
}

// ── 資產視覺層 ──
function addAsset(row, sd) {
  if (assets.has(row.id)) return;
  row.type === 'img' ? addImg(row, sd) : addPts(row, sd);
}

function safeSColor(status) {
  return typeof sColor === 'function' ? sColor(status) : '#3b82f6';
}

function addImg(row, sd) {
  if (assets.has(row.id)) return;
  const b = row.bounds_json;
  if (!b || b.w == null || b.e == null || b.s == null || b.n == null) return;
  const sw = typeof to84 === 'function' ? to84(b.w, b.s) : [b.w, b.s];
  const ne = typeof to84 === 'function' ? to84(b.e, b.n) : [b.e, b.n];
  function mkBounds() { return L.latLngBounds(L.latLng(sw[1], sw[0]), L.latLng(ne[1], ne[0])); }
  const overlay = L.imageOverlay(row.img_url || row.img_data || '', mkBounds(), { opacity: 0.85, interactive: false }).addTo(map);
  const rect = L.rectangle(mkBounds(), { color: safeSColor(sd?.status), weight: 2, fill: false, interactive: true }).addTo(map);
  rect.bindTooltip(row.display_name, { className: 'tt', sticky: true, permanent: false });
  const fn = () => { if (typeof openPanel === 'function') openPanel(row.id); };
  rect.on('click', fn);
  rect.on('mouseover', () => rect.setStyle({ color: '#8de8ff', weight: 4 }));
  rect.on('mouseout',  () => rect.setStyle({ color: safeSColor(sd?.status), weight: 2 }));
  assets.set(row.id, { type: 'img', rect, overlay, mkBounds, _clickHandler: fn, name: row.display_name, display_name: row.display_name, statusData: sd, manual_period: row.manual_period || '' });
}

// ── 1. 局部公尺換算 ──
function _localMeterScale(pts) {
  let sumLat = 0; pts.forEach(p => sumLat += p[1]);
  const meanLat = sumLat / pts.length;
  return { mLat: 110574, mLng: 111320 * Math.cos(meanLat * Math.PI / 180) };
}

// ── 2. 網格降採樣 ──
function _gridDownsampleM(ptsM, cellM) {
  const buckets = new Map();
  ptsM.forEach(p => {
    const key = Math.floor(p[0] / cellM) + '_' + Math.floor(p[1] / cellM);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  });
  const out = [];
  buckets.forEach(arr => {
    let sx = 0, sy = 0;
    arr.forEach(p => { sx += p[0]; sy += p[1]; });
    out.push([sx / arr.length, sy / arr.length]);
  });
  return out;
}

// ── 3. Douglas-Peucker 簡化 ──
function _douglasPeucker(pts, epsilon) {
  if (pts.length < 3) return pts.slice();
  function perpDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    const cx = a[0] + t * dx, cy = a[1] + t * dy;
    return Math.hypot(p[0] - cx, p[1] - cy);
  }
  function rdp(list) {
    if (list.length < 3) return list;
    let maxD = 0, idx = 0;
    const first = list[0], last = list[list.length - 1];
    for (let i = 1; i < list.length - 1; i++) {
      const d = perpDist(list[i], first, last);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilon) {
      const left = rdp(list.slice(0, idx + 1));
      const right = rdp(list.slice(idx));
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }
  return rdp(pts);
}

// ── 4. 拓撲網絡拆解多路徑 ──
function _reconstructMultiPathsFromScatter(pts) {
  if (pts.length < 2) return [pts.slice()];
  
  const scale = _localMeterScale(pts);
  const ptsM = pts.map(p => [p[0] * scale.mLng, p[1] * scale.mLat]);
  
  const nodes = _gridDownsampleM(ptsM, 2.0);
  const n = nodes.length;
  if (n < 2) return [pts.slice()];

  const maxEdgeDist = 25.0;
  const adj = Array.from({ length: n }, () => []);
  const edgeSet = new Set();

  for (let i = 0; i < n; i++) {
    const dists = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
      if (d <= maxEdgeDist) dists.push({ j, d });
    }
    dists.sort((a, b) => a.d - b.d);
    for (let k = 0; k < Math.min(3, dists.length); k++) {
      const { j, d } = dists[k];
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visitedEdges = new Set();
  const rawSegmentsM = [];

  for (let i = 0; i < n; i++) {
    const degree = adj[i].length;
    if (degree !== 2 || degree === 0) {
      adj[i].forEach(next => {
        const edgeKey = i < next ? `${i}_${next}` : `${next}_${i}`;
        if (visitedEdges.has(edgeKey)) return;

        visitedEdges.add(edgeKey);
        const segment = [nodes[i], nodes[next]];
        let prev = i;
        let curr = next;

        while (adj[curr].length === 2) {
          const neighbors = adj[curr];
          const unvisitedNext = neighbors.find(nbr => nbr !== prev);
          if (!unvisitedNext) break;

          const nextEdgeKey = curr < unvisitedNext ? `${curr}_${unvisitedNext}` : `${unvisitedNext}_${curr}`;
          if (visitedEdges.has(nextEdgeKey)) break;

          visitedEdges.add(nextEdgeKey);
          segment.push(nodes[unvisitedNext]);
          prev = curr;
          curr = unvisitedNext;
        }

        if (segment.length >= 2) {
          rawSegmentsM.push(segment);
        }
      });
    }
  }

  for (let i = 0; i < n; i++) {
    adj[i].forEach(next => {
      const edgeKey = i < next ? `${i}_${next}` : `${next}_${i}`;
      if (!visitedEdges.has(edgeKey)) {
        visitedEdges.add(edgeKey);
        const segment = [nodes[i], nodes[next]];
        let prev = i;
        let curr = next;
        while (adj[curr].length === 2) {
          const unvisitedNext = adj[curr].find(nbr => nbr !== prev);
          if (!unvisitedNext) break;
          const nextEdgeKey = curr < unvisitedNext ? `${curr}_${unvisitedNext}` : `${unvisitedNext}_${curr}`;
          if (visitedEdges.has(nextEdgeKey)) break;
          visitedEdges.add(nextEdgeKey);
          segment.push(nodes[unvisitedNext]);
          prev = curr;
          curr = unvisitedNext;
        }
        if (segment.length >= 2) rawSegmentsM.push(segment);
      }
    });
  }

  const finalPaths = [];
  rawSegmentsM.forEach(segM => {
    const simplifiedM = _douglasPeucker(segM, 1.0);
    if (simplifiedM.length >= 2) {
      const segWGS = simplifiedM.map(p => [p[0] / scale.mLng, p[1] / scale.mLat]);
      finalPaths.push(segWGS);
    }
  });

  return finalPaths.length > 0 ? finalPaths : [pts.slice()];
}

function addPts(row, sd) {
  const group = L.featureGroup().addTo(map);
  const color = safeSColor(sd?.status || 'none');
  let loaded = false;

  async function ensureLoaded() {
    if (loaded) return; loaded = true;
    let features = [];
    if (row.points_url) {
      try { const res = await fetch(row.points_url); const json = await res.json(); if (Array.isArray(json)) features = json; else if (json?.type === 'FeatureCollection') features = json.features || []; else if (json?.type === 'Feature') features = [json]; } catch (e) { console.warn('[addPts]', e); }
    } else if (row.points_json) {
      const raw = row.points_json;
      if (Array.isArray(raw)) features = raw; else if (raw?.type === 'FeatureCollection') features = raw.features || []; else if (raw?.type === 'Feature') features = [raw];
    }

    const allPts = [];
    features.forEach(f => {
      let lat = null, lng = null;
      if (f.geometry?.coordinates) {
        const cx = parseFloat(f.geometry.coordinates[0]), cy = parseFloat(f.geometry.coordinates[1]);
        if (!isNaN(cx) && !isNaN(cy)) {
          if (typeof looksWGS84 === 'function' && looksWGS84(cx, cy)) { lng = cx; lat = cy; }
          else if (typeof to84 === 'function') { const w = to84(cx, cy); lng = w[0]; lat = w[1]; }
          else { lng = cx; lat = cy; }
        }
      }
      if (lat === null && typeof parseDMS === 'function') {
        const p = f.properties || {};
        const pLat = parseDMS(p['緯度'] ?? p['lat'] ?? p['latitude']);
        const pLng = parseDMS(p['經度'] ?? p['lng'] ?? p['longitude']);
        if (pLat !== null && pLng !== null && pLat > 20 && pLat < 30 && pLng > 100 && pLng < 130) { lat = pLat; lng = pLng; }
      }
      if (lat !== null && lng !== null) allPts.push([lng, lat]);
    });

    if (allPts.length === 0) {
      const a = assets.get(row.id); if (a) a._rawFeatures = features;
      return;
    }

    // ── 多線段繪製（防呆 renderer 設定） ──
    const multiPaths = _reconstructMultiPathsFromScatter(allPts);

    multiPaths.forEach(path => {
      if (path.length === 1) {
        const markerOpts = {
          radius: 4, fillColor: color, color: '#ffffff',
          weight: 1, fillOpacity: 0.9
        };
        if (typeof canvasRenderer !== 'undefined') markerOpts.renderer = canvasRenderer;
        L.circleMarker([path[0][1], path[0][0]], markerOpts).addTo(group);
      } else if (path.length >= 2) {
        const latLngs = path.map(p => [p[1], p[0]]);

        const bgLine = L.polyline(latLngs, {
          color, weight: 8, opacity: 0.35,
          lineJoin: 'round', lineCap: 'round'
        }).addTo(group);
        bgLine.options.isBorder = true;

        const mainLine = L.polyline(latLngs, {
          color, weight: 4.5, opacity: 0.95,
          lineJoin: 'round', lineCap: 'round',
          className: 'csv-glow-line'
        }).addTo(group);
        mainLine.options.isBorder = false;
      }
    });

    const a = assets.get(row.id);
    if (a) {
      a._rawFeatures = features;
      const gb = group.getBounds();
      if (gb.isValid()) a.mkBounds = () => gb;
    }
  }

  group.bindTooltip(row.display_name, { className: 'tt', sticky: true });
  const fn = () => { ensureLoaded(); if (typeof openPanel === 'function') openPanel(row.id); };
  group.on('click', fn);
  group.on('mouseover', () => group.eachLayer(l => {
    if (l.setStyle) l.setStyle(l instanceof L.Polyline && !(l instanceof L.Polygon)
      ? { color: '#8de8ff', weight: l.options.isBorder ? 9 : 6, opacity: l.options.isBorder ? 0.5 : 1 }
      : { fillColor: '#8de8ff', color: '#fff', radius: 7 });
  }));
  group.on('mouseout', () => group.eachLayer(l => {
    const curC = safeSColor(sd?.status || 'none');
    if (l.setStyle) l.setStyle(l instanceof L.Polyline && !(l instanceof L.Polygon)
      ? { color: curC, weight: l.options.isBorder ? 7 : 4.5, opacity: l.options.isBorder ? 0.35 : 0.95 }
      : { fillColor: curC, color: '#fff', radius: 5 });
  }));
  assets.set(row.id, { type: 'point', visual: group, mkBounds: null, _clickHandler: fn, _ensureLoaded: ensureLoaded, name: row.display_name, display_name: row.display_name, statusData: sd, _rawFeatures: [], manual_period: row.manual_period || '' });
  ensureLoaded();
}

function removeLayer(id) {
  const a = assets.get(id); if (!a) return;
  if (a.type === 'img') { map.removeLayer(a.rect); map.removeLayer(a.overlay); }
  else map.removeLayer(a.visual);
  assets.delete(id);
}

function applyMapStyles() {
  let csw = null, cne = null;
  const fitNeeded = (typeof curOp !== 'undefined' && curOp !== 'all') || (typeof activePeriod !== 'undefined' && activePeriod !== 'all');
  assets.forEach(a => {
    const op = a.statusData?.operator_name || null, st = a.statusData?.status || 'none';
    const period = typeof effectivePeriod === 'function' ? effectivePeriod(a) : 'all';
    const opMatch     = (typeof curOp === 'undefined' || curOp === 'all') || (op === curOp && (st === 'claimed' || st === 'done'));
    const periodMatch = (typeof activePeriod === 'undefined' || activePeriod === 'all') || period === activePeriod;
    const show = opMatch && periodMatch;
    if (a.type === 'img') {
      a.overlay.setOpacity(show ? 0.85 : 0);
      a.rect.setStyle({ color: safeSColor(st), opacity: show ? 1 : 0, fillOpacity: 0 });
      if (show) a.rect.on('click', a._clickHandler); else a.rect.off('click', a._clickHandler);
    } else {
      const c = safeSColor(st);
      a.visual.eachLayer(l => {
        if (!l.setStyle) return;
        if (l instanceof L.Polyline && !(l instanceof L.Polygon)) {
          const w = l.options.isBorder ? 7 : 4.5;
          const op = l.options.isBorder ? 0.35 : 0.95;
          l.setStyle({ color: c, opacity: show ? op : 0, weight: w });
        } else {
          l.setStyle({ fillColor: c, color: c, fillOpacity: show ? 0.85 : 0, opacity: show ? 0.85 : 0 });
        }
      });
      if (show) a.visual.on('click', a._clickHandler); else a.visual.off('click', a._clickHandler);
    }
    if (show && fitNeeded && a.mkBounds) {
      const bd = a.mkBounds();
      if (bd.isValid()) {
        if (!csw) { csw = bd.getSouthWest(); cne = bd.getNorthEast(); }
        else { csw = L.latLng(Math.min(csw.lat, bd.getSouth()), Math.min(csw.lng, bd.getWest())); cne = L.latLng(Math.max(cne.lat, bd.getNorth()), Math.max(cne.lng, bd.getEast())); }
      }
    }
  });
  if (fitNeeded && csw && cne) map.fitBounds(L.latLngBounds(csw, cne), { padding: [80, 80], maxZoom: 17, animate: false });
}

function pulseBeaconPts(a) {
  const origColor = safeSColor(a.statusData?.status || 'none');
  let cnt = 0;
  const fl = setInterval(() => {
    cnt++;
    a.visual.eachLayer(l => {
      if (!l.setStyle) return;
      if (l instanceof L.Polyline && !(l instanceof L.Polygon)) {
        l.setStyle({ color: cnt % 2 === 0 ? origColor : '#ffffff', weight: cnt % 2 === 0 ? 4 : 7 });
      } else {
        l.setStyle({ fillColor: cnt % 2 === 0 ? origColor : '#ffffff', radius: cnt % 2 === 0 ? 5 : 9 });
      }
    });
    if (cnt >= 6) {
      clearInterval(fl);
      a.visual.eachLayer(l => {
        if (!l.setStyle) return;
        if (l instanceof L.Polyline && !(l instanceof L.Polygon)) l.setStyle({ color: origColor, weight: 4 });
        else l.setStyle({ fillColor: origColor, radius: 5 });
      });
    }
  }, 180);
}

function pulseBeaconImg(a) {
  const orig = safeSColor(a.statusData?.status || 'none');
  let cnt = 0;
  const fl = setInterval(() => {
    cnt++;
    a.rect.setStyle({ color: cnt % 2 === 0 ? orig : '#ffffff', weight: cnt % 2 === 0 ? 2 : 4 });
    if (cnt >= 6) { clearInterval(fl); a.rect.setStyle({ color: orig, weight: 2 }); }
  }, 180);
}
