// ══════════════════════════════════════════════
// ── 地圖模組 (map.js) ──
// ══════════════════════════════════════════════

const NLSC_URL  = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}';
const NLSC_DARK = 'https://wmts.nlsc.gov.tw/wmts/EMAP5/default/GoogleMapsCompatible/{z}/{y}/{x}';
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJgCC==';

// Session-unique cache buster — forces fresh tile requests
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
  if (typeof map === 'undefined' || !map.getPane) return;
  const pane = map.getPane('tilePane');
  if (pane) pane.style.filter = `brightness(${val})`;
}

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([24.8039, 120.9647], 14);
  tileLayer = buildTile(true).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);

  // KEY FIX: remove tilePane filter during zoom to prevent GPU compositing tearing
  map.on('zoomstart', function() {
    const pane = map.getPane('tilePane');
    if (pane) { pane._brightnessFilter = pane.style.filter; pane.style.filter = ''; }
  });
  map.on('zoomend', function() {
    const pane = map.getPane('tilePane');
    if (pane && pane._brightnessFilter !== undefined) pane.style.filter = pane._brightnessFilter;
  });

  // 套用預設亮度 90%
  applyBrightness(DEFAULT_BRIGHTNESS);

  // 右鍵選單
  const ctxMenu = document.getElementById('ctx-menu');
  map.on('contextmenu', e => {
    e.originalEvent.preventDefault();
    const lat = e.latlng.lat, lng = e.latlng.lng;
    const [east, north] = to3826(lng, lat);
    _ctxCoord = { lat, lng, east, north };
    document.getElementById('ctx-97-val').innerText = `E ${east.toFixed(3)}, N ${north.toFixed(3)}`;
    document.getElementById('ctx-wgs-val').innerText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    const mx = e.originalEvent.clientX, my = e.originalEvent.clientY;
    ctxMenu.style.left = (mx + 240 > window.innerWidth ? mx - 240 : mx) + 'px';
    ctxMenu.style.top  = (my + 120 > window.innerHeight ? my - 120 : my) + 'px';
    ctxMenu.style.display = 'block';
  });
  document.getElementById('ctx-97').addEventListener('click', () => copyCoord('97'));
  document.getElementById('ctx-wgs').addEventListener('click', () => copyCoord('wgs'));
  document.getElementById('ctx-streetview').addEventListener('click', openStreetView);
  document.addEventListener('click', e => { if (!ctxMenu.contains(e.target)) ctxMenu.style.display = 'none'; });
  map.on('click', () => ctxMenu.style.display = 'none');
}

// ── 亮度滑桿 ──
document.addEventListener('DOMContentLoaded', () => {
  const slider     = document.getElementById('map-brightness');
  const valDisplay = document.getElementById('map-brightness-val');
  // 設定預設值
  slider.value = DEFAULT_BRIGHTNESS;
  valDisplay.innerText = Math.round(DEFAULT_BRIGHTNESS * 100) + '%';

  slider.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    valDisplay.innerText = Math.round(val * 100) + '%';
    if (typeof applyBrightness === 'function') applyBrightness(val);
  });
});

function setOnline(on) {
  const dot = document.getElementById('db-dot'), lbl = document.getElementById('db-label');
  if (dot) { dot.style.background = on ? 'var(--accent)' : 'var(--danger)'; dot.classList.toggle('live', false); }
  if (lbl) { lbl.innerText = on ? 'LIVE' : 'OFFLINE'; lbl.style.color = on ? 'var(--accent)' : 'var(--danger)'; }
  rtLog(on ? '✓ Supabase 連線成功，等待 RT channel…' : '✗ DB 連線失敗', on ? '#4edea3' : '#ff6b7a');
}

// ── 資產視覺層 ──
function addAsset(row, sd) {
  if (assets.has(row.id)) return;
  row.type === 'img' ? addImg(row, sd) : addPts(row, sd);
}

function addImg(row, sd) {
  if (assets.has(row.id)) return;
  const b = row.bounds_json;
  if (b.w == null || b.e == null || b.s == null || b.n == null) return;
  const sw = to84(b.w, b.s), ne = to84(b.e, b.n);
  function mkBounds() { return L.latLngBounds(L.latLng(sw[1], sw[0]), L.latLng(ne[1], ne[0])); }
  const overlay = L.imageOverlay(row.img_url || row.img_data || '', mkBounds(), { opacity: 0.85, interactive: false }).addTo(map);
  const rect = L.rectangle(mkBounds(), { color: sColor(sd?.status), weight: 2, fill: false, interactive: true }).addTo(map);
  rect.bindTooltip(row.display_name, { className: 'tt', sticky: true, permanent: false });
  const fn = () => openPanel(row.id);
  rect.on('click', fn);
  rect.on('mouseover', () => rect.setStyle({ color: '#8de8ff', weight: 4 }));
  rect.on('mouseout',  () => rect.setStyle({ color: sColor(sd?.status), weight: 2 }));
  assets.set(row.id, { type: 'img', rect, overlay, mkBounds, _clickHandler: fn, name: row.display_name, display_name: row.display_name, statusData: sd, manual_period: row.manual_period || '' });
}

// ── 最近鄰排序：讓散點連成最短路徑折線 ──
function _nnSort(pts) {
  if (pts.length <= 2) return pts;
  const rem = pts.slice(), sorted = [rem.splice(0, 1)[0]];
  while (rem.length) {
    const last = sorted[sorted.length - 1];
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rem.length; i++) {
      const d = Math.hypot(rem[i][0] - last[0], rem[i][1] - last[1]);
      if (d < bd) { bd = d; bi = i; }
    }
    sorted.push(rem.splice(bi, 1)[0]);
  }
  return sorted;
}

// ── Douglas-Peucker 路徑簡化：依原始走訪順序保留轉角形狀，只去除多餘密集點 ──
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

// ── 線性回歸與主成分擬合 (PCA Trend Fitting)：將散點直接收斂為單一擬合直線/趨勢線 ──
function _fitLinearTrendLine(pts) {
  if (!pts || pts.length === 0) return [];
  if (pts.length === 1) return pts;

  // 1. 計算重心 (Center of Mass)
  let sumLng = 0, sumLat = 0;
  pts.forEach(p => { sumLng += p[0]; sumLat += p[1]; });
  const meanLng = sumLng / pts.length;
  const meanLat = sumLat / pts.length;

  // 2. 計算主成分向量 (PCA Principal Axis)
  let xx = 0, yy = 0, xy = 0;
  pts.forEach(p => {
    const dx = p[0] - meanLng;
    const dy = p[1] - meanLat;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  });

  const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
  const vx = Math.cos(theta);
  const vy = Math.sin(theta);

  // 3. 投影所有點至主向量軸 (t 軸) 並排序
  const projected = pts.map(p => {
    const dx = p[0] - meanLng;
    const dy = p[1] - meanLat;
    const t = dx * vx + dy * vy;
    return { t, orig: p };
  }).sort((a, b) => a.t - b.t);

  // 4. 平滑中心軸生成單一順暢直線/趨勢線
  const windowSize = Math.max(3, Math.floor(projected.length / 10));
  const half = Math.floor(windowSize / 2);
  const fittedLine = [];

  for (let i = 0; i < projected.length; i += Math.max(1, Math.floor(windowSize / 3))) {
    const start = Math.max(0, i - half);
    const end = Math.min(projected.length, i + half + 1);
    let sLng = 0, sLat = 0, cnt = 0;
    for (let j = start; j < end; j++) {
      sLng += projected[j].orig[0];
      sLat += projected[j].orig[1];
      cnt++;
    }
    fittedLine.push([sLng / cnt, sLat / cnt]);
  }

  // 確保端點延伸至全區域起終點
  const startPt = [meanLng + projected[0].t * vx, meanLat + projected[0].t * vy];
  const endPt = [meanLng + projected[projected.length - 1].t * vx, meanLat + projected[projected.length - 1].t * vy];
  if (fittedLine.length >= 2) {
    fittedLine[0] = startPt;
    fittedLine[fittedLine.length - 1] = endPt;
  } else {
    return [startPt, endPt];
  }

  return fittedLine;
}

// ── DBSCAN 輕量聚類：依空間分群 ──
function _clusterPoints(pts, eps) {
  const n = pts.length, visited = new Uint8Array(n), clId = new Int32Array(n).fill(-1);
  let cid = 0;
  const neighbors = i => {
    const res = [];
    for (let j = 0; j < n; j++) {
      if (Math.hypot(pts[j][0]-pts[i][0], pts[j][1]-pts[i][1]) <= eps) res.push(j);
    }
    return res;
  };
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const nb = neighbors(i);
    if (nb.length < 2) { clId[i] = -1; continue; }  // noise
    clId[i] = cid;
    const stack = nb.filter(j => j !== i);
    while (stack.length) {
      const j = stack.pop();
      if (!visited[j]) { visited[j] = 1; const nb2 = neighbors(j); if (nb2.length >= 2) nb2.forEach(k => { if (!visited[k]) stack.push(k); }); }
      if (clId[j] < 0) clId[j] = cid;
    }
    cid++;
  }
  // group by cluster; noise points each form own micro-cluster
  const groups = {};
  pts.forEach((p, i) => { const k = clId[i] >= 0 ? clId[i] : 'n'+i; if (!groups[k]) groups[k] = []; groups[k].push(p); });
  return Object.values(groups);
}

function addPts(row, sd) {
  const group = L.featureGroup().addTo(map);
  const color = sColor(sd?.status || 'none');
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

    // Collect valid [lng, lat] pairs
    const allPts = [];
    features.forEach(f => {
      let lat = null, lng = null;
      if (f.geometry?.coordinates) {
        const cx = parseFloat(f.geometry.coordinates[0]), cy = parseFloat(f.geometry.coordinates[1]);
        if (!isNaN(cx) && !isNaN(cy)) {
          if (looksWGS84(cx, cy)) { lng = cx; lat = cy; }
          else { const w = to84(cx, cy); lng = w[0]; lat = w[1]; }
        }
      }
      if (lat === null) {
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

    // 依原始走訪順序簡化路徑 (Douglas-Peucker)：保留轉角，去除多餘密集點
    // epsilon 約 1.5 公尺（以經緯度換算，適用於台灣緯度附近）
    const RDP_EPSILON = 0.000015;
    const trendPts = _douglasPeucker(allPts, RDP_EPSILON);
    if (trendPts.length === 1) {
      L.circleMarker([trendPts[0][1], trendPts[0][0]], {
        radius: 5, fillColor: color, color: '#ffffff',
        weight: 1.5, fillOpacity: 0.9, renderer: canvasRenderer
      }).addTo(group);
    } else if (trendPts.length >= 2) {
      const latLngs = trendPts.map(p => [p[1], p[0]]);
      // 外層光暈底線 (Glow Line)
      const bgLine = L.polyline(latLngs, {
        color, weight: 8, opacity: 0.35,
        lineJoin: 'round', lineCap: 'round'
      }).addTo(group);
      bgLine.options.isBorder = true;

      // 主體擬合直線 / 趨勢線 (Core Trend Line)
      const mainLine = L.polyline(latLngs, {
        color, weight: 5, opacity: 0.95,
        lineJoin: 'round', lineCap: 'round',
        className: 'csv-glow-line'
      }).addTo(group);
      mainLine.options.isBorder = false;
    }

    const a = assets.get(row.id);
    if (a) {
      a._rawFeatures = features;
      const gb = group.getBounds();
      if (gb.isValid()) a.mkBounds = () => gb;
    }
  }

  group.bindTooltip(row.display_name, { className: 'tt', sticky: true });
  const fn = () => { ensureLoaded(); openPanel(row.id); };
  group.on('click', fn);
  group.on('mouseover', () => group.eachLayer(l => {
    if (l.setStyle) l.setStyle(l instanceof L.Polyline && !(l instanceof L.Polygon)
      ? { color: '#8de8ff', weight: l.options.isBorder ? 9 : 6, opacity: l.options.isBorder ? 0.5 : 1 }
      : { fillColor: '#8de8ff', color: '#fff', radius: 7 });
  }));
  group.on('mouseout', () => group.eachLayer(l => {
    const curC = sColor(sd?.status || 'none');
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
  const fitNeeded = curOp !== 'all' || activePeriod !== 'all';
  assets.forEach(a => {
    const op = a.statusData?.operator_name || null, st = a.statusData?.status || 'none';
    const period = effectivePeriod(a);
    const opMatch     = curOp === 'all' || (op === curOp && (st === 'claimed' || st === 'done'));
    const periodMatch = activePeriod === 'all' || period === activePeriod;
    const show = opMatch && periodMatch;
    if (a.type === 'img') {
      a.overlay.setOpacity(show ? 0.85 : 0);
      a.rect.setStyle({ color: sColor(st), opacity: show ? 1 : 0, fillOpacity: 0 });
      if (show) a.rect.on('click', a._clickHandler); else a.rect.off('click', a._clickHandler);
    } else {
      const c = sColor(st);
      a.visual.eachLayer(l => {
        if (!l.setStyle) return;
        if (l instanceof L.Polyline && !(l instanceof L.Polygon)) {
          // Polyline layer
          const w = l.options.isBorder ? 7 : 4.5;
          const op = l.options.isBorder ? 0.35 : 0.95;
          l.setStyle({ color: c, opacity: show ? op : 0, weight: w });
        } else {
          // CircleMarker fallback
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

// ── 地圖 Pulse Beacon 特效 ──
function pulseBeaconPts(a) {
  const origColor = sColor(a.statusData?.status || 'none');
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
  const orig = sColor(a.statusData?.status || 'none');
  let cnt = 0;
  const fl = setInterval(() => {
    cnt++;
    a.rect.setStyle({ color: cnt % 2 === 0 ? orig : '#ffffff', weight: cnt % 2 === 0 ? 2 : 4 });
    if (cnt >= 6) { clearInterval(fl); a.rect.setStyle({ color: orig, weight: 2 }); }
  }, 180);
}
