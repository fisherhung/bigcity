// ══════════════════════════════════════════════
// ── 工具函數 (utils.js) ──
// ══════════════════════════════════════════════

function to84(e, n)      { return proj4('EPSG:3826', 'WGS84', [e, n]); }
function to3826(lng, lat){ return proj4('WGS84', 'EPSG:3826', [lng, lat]); }
function sColor(s)       { return s === 'done' ? '#00b87a' : s === 'claimed' ? '#e07000' : '#e0182e'; }
function looksWGS84(x, y){ return x >= 119 && x <= 123 && y >= 21 && y <= 26; }
function escHtml(s)      { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function highlight(text, kw) {
  if (!kw) return text;
  const idx = text.toLowerCase().indexOf(kw.toLowerCase());
  if (idx < 0) return text;
  return text.slice(0, idx) + '<span class="hl">' + text.slice(idx, idx + kw.length) + '</span>' + text.slice(idx + kw.length);
}
function getMMDD(name)  { const m = name && name.match(/^(\d{4})/); return m ? m[1] : null; }
function getMonth(name) { const m = name && name.match(/^(\d{2})/);  return m ? m[1] : null; }
function getPeriodLabel(p) {
  if (!p || p === 'all') return 'ALL';
  return p;
}

function autoPeriod(name) {
  const mmdd = getMMDD(name);
  if (!mmdd) return null;
  const earlyEnd = periodCfg?.earlyEnd || '0305';
  const midEnd   = periodCfg?.midEnd   || '0320';
  if (mmdd <= earlyEnd) return '初';
  if (mmdd <= midEnd)   return '中';
  return '末';
}
function effectivePeriod(asset) { return asset.manual_period || autoPeriod(asset.name) || '其他'; }
function monthLabel(mm)  { return parseInt(mm, 10) + '月'; }
function dayLabel(mmdd)  { return parseInt(mmdd.slice(0, 2), 10) + '月' + parseInt(mmdd.slice(2), 10) + '日'; }
function isDayDefaultCollapsed() { return curFilter === 'all' && curOp === 'all'; }
function isCollapsed(key, def = false) { return collapsedGroups.has(key) ? collapsedGroups.get(key) : def; }
function toggleCollapse(key, def = false) { collapsedGroups.set(key, !isCollapsed(key, def)); renderList(); }

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  const c = { info: 'var(--accent)', success: 'var(--green)', warn: 'var(--amber)', error: 'var(--danger)' };
  el.style.borderLeftColor = c[type] || c.info;
  el.innerText = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function b64Blob(d) {
  const [h, b] = d.split(','), mime = h.match(/:(.*?);/)[1];
  const bin = atob(b), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function parseDMS(val) {
  if (val == null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const s = String(val).trim();
  if (/^-?[\d.]+$/.test(s)) return parseFloat(s);
  const parts = s.match(/[\d.]+/g);
  if (!parts || parts.length < 2) return null;
  return parseFloat(parts[0]) + parseFloat(parts[1]) / 60 + parseFloat(parts[2] || 0) / 3600;
}

function isFieldFmt(props) { return props && Object.keys(props).some(k => /^field_\d+$/.test(k)); }
function getStdProps(props) {
  if (!props) return {};
  if (isFieldFmt(props)) return { POINT_NAME: String(props['field_1'] ?? ''), EAST: props['field_7'] ?? '', NORTH: props['field_6'] ?? '', ELEV: props['field_8'] ?? '' };
  return { POINT_NAME: String(props['點名'] ?? props['name'] ?? props['NAME'] ?? ''), EAST: props['東坐標'] ?? props['東座標'] ?? '', NORTH: props['北坐標'] ?? props['北座標'] ?? '', ELEV: props['高程'] ?? '' };
}

function copyCoord(type) {
  const c = _ctxCoord; if (!c) return;
  const text = type === '97'
    ? `E ${c.east.toFixed(3)}, N ${c.north.toFixed(3)}`
    : `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
  const ta = document.createElement('textarea'); ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta); ta.focus(); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  document.getElementById('ctx-menu').style.display = 'none';
  toast(ok ? `已複製：${text}` : `複製失敗：${text}`, ok ? 'success' : 'warn');
}

function locateCoord() {
  const raw = document.getElementById('locate-input').value.trim();
  if (!raw) return;
  const parts = raw.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) { toast('格式錯誤', 'error'); return; }
  const e = parseFloat(parts[0]), n = parseFloat(parts[1]);
  if (isNaN(e) || isNaN(n)) { toast('數值解析失敗', 'error'); return; }
  const [lng, lat] = to84(e, n);
  if (lat < 20 || lat > 30 || lng < 118 || lng > 126) { toast('座標超出範圍', 'warn'); return; }
  if (locateMarker) { map.removeLayer(locateMarker); locateMarker = null; }
  const icon = L.divIcon({ className: '', html: `<div style="width:16px;height:16px;border-radius:50%;background:var(--accent);border:2px solid #fff;box-shadow:0 0 12px rgba(192,193,255,0.6);animation:pulse-ring 1.4s ease-out infinite;"></div><style>@keyframes pulse-ring{0%{box-shadow:0 0 0 0 rgba(192,193,255,.6)}70%{box-shadow:0 0 0 14px rgba(192,193,255,0)}100%{box-shadow:0 0 0 0 rgba(192,193,255,0)}}}</style>`, iconSize: [16, 16], iconAnchor: [8, 8] });
  locateMarker = L.marker([lat, lng], { icon }).addTo(map).bindPopup(`<b>📍 97 定位</b><br>E ${e.toFixed(2)}, N ${n.toFixed(2)}`, { maxWidth: 220 }).openPopup();
  locateMarker.on('click', () => { map.removeLayer(locateMarker); locateMarker = null; });
  map.flyTo([lat, lng], 17, { animate: true, duration: 1.2 });
  toast(`已定位 E${Math.round(e)}, N${Math.round(n)}`, 'success');
}

function openStreetView() {
  const c = _ctxCoord; if (!c) return;
  // c.lat and c.lng are converted WGS84 coordinates from TWD97 / Map location
  const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
  window.open(url, '_blank');
  document.getElementById('ctx-menu').style.display = 'none';
  toast(`已於新頁面開啟街景 (${c.lat.toFixed(5)}, ${c.lng.toFixed(5)})`, 'info');
}

