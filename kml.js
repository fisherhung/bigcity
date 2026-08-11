// ══════════════════════════════════════════════
// ── KML 圖層管理 (kml.js) ──
// ══════════════════════════════════════════════

var kmlLayers   = [];
var kmlPolylines = {};
var roadPanelOpen = false;
var kmlDiffLayer  = null;
var KML_COLORS = ['#94a3b8','#c0c1ff','#ffb95f','#4edea3','#ff6b7a','#ec4899','#06b6d4','#f97316','#ffffff'];
var _colorTargetId = null;

function _getKml(id) { return kmlLayers.filter(x => x.id === id)[0] || null; }

function kmlHide(id) {
  const en = _getKml(id); if (en) en.visible = false;
  const lines = kmlPolylines[id] || [];
  lines.forEach(pl => { try { map.removeLayer(pl); } catch (e) {} });
  kmlPolylines[id] = [];
}

function kmlShow(id) {
  const en = _getKml(id); if (!en || !en._geoJSON) return;
  kmlHide(id);
  const lines = [];
  (en._geoJSON.features || []).forEach(f => {
    const geom = f.geometry; if (!geom) return;
    const rings = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates || [];
    rings.forEach(coords => {
      const lls = coords.map(c => [c[1], c[0]]);
      if (lls.length > 1) {
        const pl = L.polyline(lls, { color: en.color, weight: 2.5, opacity: 0.9 });
        pl.bindTooltip(en.name, { className: 'tt', sticky: true });
        pl.addTo(map); lines.push(pl);
      }
    });
  });
  kmlPolylines[id] = lines; en.visible = true;
}

async function toggleKmlVisibility(id) {
  const en = _getKml(id); if (!en) return;
  const currently = !!(kmlPolylines[id] && kmlPolylines[id].length > 0);
  if (currently) {
    kmlHide(id);
  } else {
    if (!en._geoJSON) {
      if (!en.geojson_url) { toast('無法載入圖層', 'error'); return; }
      try { const r = await fetch(en.geojson_url); en._geoJSON = await r.json(); }
      catch (e) { toast('載入失敗', 'error'); return; }
    }
    kmlShow(id);
  }
  renderKmlList(); renderKmlSidebarList();
}

async function loadKmlLayers() {
  const visibleIds = new Set(Object.keys(kmlPolylines).filter(id => kmlPolylines[id] && kmlPolylines[id].length > 0));
  Object.keys(kmlPolylines).forEach(id => kmlHide(id));
  kmlPolylines = {}; kmlLayers = [];
  try {
    const { data: rows, error } = await sb.from('kml_layers').select('*').order('created_at', { ascending: true });
    if (error) {
      // 表格尚未建立（42P01）或其他 DB 錯誤 → 靜默忽略，不顯示 error
      console.warn('kml_layers 尚未建立或無法存取，跳過載入');
      renderKmlList(); updateKmlCountLabel(); return;
    }
    if (!rows || !rows.length) { renderKmlList(); updateKmlCountLabel(); return; }
    let done = 0;
    rows.forEach(row => {
      const en = { id: row.id, name: row.name, color: row.color || '#94a3b8', visible: false, geojson_url: row.geojson_url, storage_path: row.storage_path, _geoJSON: null };
      kmlLayers.push(en);
      if (row.geojson_url) {
        (async () => {
          try { const res = await fetch(row.geojson_url); en._geoJSON = await res.json(); if (visibleIds.has(String(row.id))) kmlShow(row.id); }
          catch (e) { console.warn('KML fetch err:', e.message || e); }
          done++;
          if (done === rows.length) { renderKmlList(); updateKmlCountLabel(); renderKmlSidebarList(); }
        })();
      } else {
        done++;
        if (done === rows.length) { renderKmlList(); updateKmlCountLabel(); renderKmlSidebarList(); }
      }
    });
  } catch (e) { console.warn('loadKmlLayers 例外:', e?.message || e); renderKmlList(); updateKmlCountLabel(); }
}

function updateKmlCountLabel() {
  const el = document.getElementById('kml-count-label');
  if (el) el.textContent = kmlLayers.length + ' 個圖層';
}

function renderKmlList() {
  const el = document.getElementById('kml-layer-list'); if (!el) return;
  el.innerHTML = ''; updateKmlCountLabel();
  if (!kmlLayers.length) { el.innerHTML = '<div class="mono-label" style="text-align:center;padding:8px 0;">尚無 KML 圖層</div>'; return; }
  kmlLayers.forEach(entry => {
    const card = document.createElement('div'); card.className = 'kml-layer-card';
    const dot = document.createElement('div'); dot.className = 'kml-color-dot'; dot.style.background = entry.color; dot.title = '點擊換色';
    dot.onclick = e => { e.stopPropagation(); openColorPopover(entry.id, dot); };
    const nameEl = document.createElement('span'); nameEl.className = 'kml-layer-name'; nameEl.textContent = entry.name; nameEl.title = '雙擊改名';
    nameEl.ondblclick = () => {
      const inp = document.createElement('input'); inp.type = 'text';
      inp.style.cssText = 'flex:1;font-size:11px;font-weight:500;padding:2px 5px;border-radius:3px;min-width:0;background:var(--input-bg);border:1px solid var(--accent-border);color:var(--text);outline:none;';
      inp.value = nameEl.textContent; nameEl.replaceWith(inp); inp.focus(); inp.select();
      async function commit() {
        const n = (inp.value || '').trim() || entry.name;
        try { await sb.from('kml_layers').update({ name: n }).eq('id', entry.id); const en = _getKml(entry.id); if (en) en.name = n; renderKmlList(); toast('已改名', 'success'); }
        catch (e) { toast('改名失敗：' + (e.message || e), 'error'); }
      }
      inp.onblur = commit; inp.onkeydown = ev => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = entry.name; inp.blur(); } };
    };
    const isOn = !!(kmlPolylines[entry.id] && kmlPolylines[entry.id].length > 0);
    const eyeBtn = document.createElement('button'); eyeBtn.className = 'kml-eye-btn' + (isOn ? ' on' : ''); eyeBtn.textContent = isOn ? '👁' : '🙈'; eyeBtn.title = isOn ? '點擊隱藏' : '點擊顯示';
    eyeBtn.onclick = ev => { ev.stopPropagation(); toggleKmlVisibility(entry.id); };
    const delBtn = document.createElement('button'); delBtn.className = 'kml-del-btn'; delBtn.textContent = '🗑️'; delBtn.title = '刪除';
    delBtn.onclick = async ev => {
      ev.stopPropagation();
      if (!confirm('確定刪除此 KML 圖層？')) return;
      kmlHide(entry.id); delete kmlPolylines[entry.id];
      const en = _getKml(entry.id);
      try {
        if (en && en.storage_path) await sb.storage.from('kml-files').remove([en.storage_path]);
        await sb.from('kml_layers').delete().eq('id', entry.id);
        kmlLayers = kmlLayers.filter(x => x.id !== entry.id);
        renderKmlList(); updateKmlCountLabel(); toast('已刪除', 'info');
      } catch (e) { toast('刪除失敗：' + (e.message || e), 'error'); }
    };
    card.append(dot, nameEl, eyeBtn, delBtn); el.appendChild(card);
  });
}

function openColorPopover(entryId, anchorEl) {
  _colorTargetId = entryId;
  let pop = document.getElementById('color-popover');
  pop.innerHTML = ''; pop.style.display = 'flex'; pop.style.flexWrap = 'wrap'; pop.style.gap = '6px';
  const en = _getKml(entryId), cur = en ? en.color : '';
  KML_COLORS.forEach(c => {
    const s = document.createElement('div'); s.className = 'color-preset' + (c === cur ? ' sel' : '');
    s.style.background = c; s.title = c;
    if (c === '#ffffff') s.style.border = '2px solid #444';
    s.onclick = () => { applyKmlColor(entryId, c); pop.style.display = 'none'; };
    pop.appendChild(s);
  });
  const rect = anchorEl.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
  pop.style.top  = (rect.bottom + 4) + 'px';
  setTimeout(() => { document.addEventListener('click', function cp(ev) { if (!pop.contains(ev.target)) { pop.style.display = 'none'; document.removeEventListener('click', cp); } }); }, 0);
}

async function applyKmlColor(entryId, color) {
  const en = _getKml(entryId); if (!en) return;
  en.color = color;
  if (kmlPolylines[entryId] && kmlPolylines[entryId].length > 0) { kmlHide(entryId); kmlShow(entryId); }
  try { await sb.from('kml_layers').update({ color }).eq('id', entryId); } catch (e) {}
  renderKmlList();
}

function onKmlFileChange(event) { const f = event.target.files[0]; if (f) uploadKmlFile(f); event.target.value = ''; }

function uploadKmlFile(file) {
  const reader = new FileReader();
  reader.onload = async ev => {
    let kmlDoc;
    try { const parser = new DOMParser(); kmlDoc = parser.parseFromString(ev.target.result, 'application/xml'); const parseErr = kmlDoc.querySelector('parsererror'); if (parseErr) throw new Error('XML解析失敗'); }
    catch (e) { toast('KML 解析失敗：' + (e.message || e), 'error'); return; }
    const tgj = window.toGeoJSON || window.togeojson;
    if (!tgj || !tgj.kml) { toast('toGeoJSON 函式庫未載入', 'error'); return; }
    let gj;
    try { gj = tgj.kml(kmlDoc); } catch (e) { toast('KML 轉換失敗：' + (e.message || e), 'error'); return; }
    const lines = { type: 'FeatureCollection', features: (gj.features || []).filter(ft => { const t = ft.geometry && ft.geometry.type; return t === 'LineString' || t === 'MultiLineString'; }) };
    if (!lines.features.length) { toast('KML 中找不到線段', 'warn'); return; }
    toast('上傳中…', 'info');
    try {
      const fname = 'kml/' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blob = new Blob([JSON.stringify(lines)], { type: 'application/geo+json' });
      const upRes = await sb.storage.from('kml-files').upload(fname, blob, { contentType: 'application/geo+json', upsert: false });
      if (upRes.error) throw upRes.error;
      const url = sb.storage.from('kml-files').getPublicUrl(fname).data.publicUrl;
      const dname = file.name.replace(/\.(kml|kmz)$/i, '');
      const insRes = await sb.from('kml_layers').insert({ name: dname, color: '#c0c1ff', visible: false, storage_path: fname, geojson_url: url }).select().single();
      if (insRes.error) throw insRes.error;
      const entry = { id: insRes.data.id, name: insRes.data.name, color: insRes.data.color, visible: false, geojson_url: insRes.data.geojson_url, storage_path: insRes.data.storage_path, _geoJSON: lines };
      kmlLayers.push(entry); kmlPolylines[entry.id] = [];
      renderKmlList(); updateKmlCountLabel();
      toast('KML 已保存：' + entry.name + '（點 👁 開啟顯示）', 'success');
    } catch (err) { toast('上傳失敗：' + (err.message || err), 'error'); }
  };
  reader.readAsText(file);
}

function toggleRoadPanel() {
  roadPanelOpen = !roadPanelOpen;
  const body = document.getElementById('road-panel-body'), chev = document.getElementById('road-chevron');
  if (roadPanelOpen) { body.style.display = 'flex'; body.classList.add('open'); }
  else { body.style.display = 'none'; body.classList.remove('open'); }
  chev.style.transform = roadPanelOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
}

function setRoadStatus(msg, show) {
  if (show === undefined) show = true;
  const el = document.getElementById('road-status'); if (!el) return;
  el.textContent = msg; el.classList.toggle('show', !!show);
}

function calcTotalLength(gj) {
  let l = 0;
  (gj && gj.features || []).forEach(f => {
    const geom = f.geometry; if (!geom) return;
    const coords = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates || [];
    coords.forEach(ring => { for (let i = 1; i < ring.length; i++) l += Math.hypot(ring[i][0]-ring[i-1][0], ring[i][1]-ring[i-1][1]); });
  }); return l;
}

function calcTotalLengthKm(gj) {
  var R = 6371, l = 0;
  (gj && gj.features || []).forEach(f => {
    const geom = f.geometry; if (!geom) return;
    const coords = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates || [];
    coords.forEach(ring => {
      for (var i = 1; i < ring.length; i++) {
        var lat1 = ring[i-1][1]*Math.PI/180, lat2 = ring[i][1]*Math.PI/180;
        var dlat = (ring[i][1]-ring[i-1][1])*Math.PI/180, dlng = (ring[i][0]-ring[i-1][0])*Math.PI/180;
        var a = Math.sin(dlat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlng/2)**2;
        l += R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      }
    });
  }); return l;
}

function previewDiff() {
  const allFeatures = [];
  kmlLayers.forEach(en => { if (kmlPolylines[en.id] && kmlPolylines[en.id].length > 0 && en._geoJSON) (en._geoJSON.features || []).forEach(f => allFeatures.push(f)); });
  if (!allFeatures.length) { toast('請先點 👁 開啟至少一個 KML 圖層', 'warn'); return; }
  const mergedGJ = { type: 'FeatureCollection', features: allFeatures };
  const btn = document.getElementById('btn-preview');
  btn.innerHTML = '<span class="kml-spinner"></span> 計算中…'; btn.disabled = true; setRoadStatus('⏳ 計算中…');
  (async () => {
    try {
      const res = await fetch(EDGE_BASE + '/diff_lines_by_markers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPA_KEY }, body: JSON.stringify({ lines: mergedGJ }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const result = await res.json();
      const diffGJ = result.geojson || result;
      if (!diffGJ || !diffGJ.features) throw new Error('格式錯誤');
      showDiffResult(mergedGJ, diffGJ); toast('預覽完成', 'success');
    } catch (err) { console.warn('Edge Function 未連線，使用前端模擬:', err.message); frontendDiffFallback(mergedGJ); }
    btn.innerHTML = '⚡ 預覽消除'; btn.disabled = false;
  })();
}

function showDiffResult(origGJ, diffGJ) {
  if (kmlDiffLayer) { map.removeLayer(kmlDiffLayer); kmlDiffLayer = null; }
  kmlDiffLayer = L.geoJSON(diffGJ, { style: { color: '#1e40af', weight: 4, opacity: 1, className: 'space-glow-line' } }).addTo(map);
  const cnt = diffGJ.features.length, orig = calcTotalLength(origGJ);
  const pct = orig > 0 ? Math.round((1 - calcTotalLength(diffGJ)/orig)*100) : 0;
  const origKm = calcTotalLengthKm(origGJ), remKm = calcTotalLengthKm(diffGJ);
  const remKmStr = remKm >= 1 ? remKm.toFixed(2)+' km' : (remKm*1000).toFixed(0)+' m';
  const origKmStr = origKm >= 1 ? origKm.toFixed(2)+' km' : (origKm*1000).toFixed(0)+' m';
  document.getElementById('diff-stat').innerHTML = '剩餘 '+cnt+' 段 \u00a0<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;color:var(--accent);">'+remKmStr+'</span><br><span style="font-size:9px;color:var(--text-muted);">原始 '+origKmStr+'\u30fb消除 '+pct+'%</span>';
  setRoadStatus('\u2705 預覽完成（不儲存）');
  document.getElementById('btn-clear-diff').style.display = 'block';
}

function frontendDiffFallback(origGJ) {
  toast('Edge Function 未連線，前端模擬', 'warn');
  const pts = [];
  assets.forEach(a => { if (a.type === 'point' && a._rawFeatures) { a._rawFeatures.forEach(f => { let lat=null,lng=null; if (f.geometry?.coordinates) { const cx=parseFloat(f.geometry.coordinates[0]),cy=parseFloat(f.geometry.coordinates[1]); if (looksWGS84(cx,cy)) {lng=cx;lat=cy;} else {const w=to84(cx,cy);lng=w[0];lat=w[1];} } if (lat!==null) pts.push([lng,lat]); }); } });
  const THRESH = 0.0001617, resultFeatures = [];
  (origGJ.features || []).forEach(f => {
    const geom = f.geometry; if (!geom) return;
    const coords = geom.type === 'LineString' ? [geom.coordinates] : (geom.coordinates || []);
    coords.forEach(ring => {
      let seg = [];
      ring.forEach(pt => { const near = pts.some(p => Math.hypot(pt[0]-p[0],pt[1]-p[1]) < THRESH); if (!near) { seg.push(pt); } else { if (seg.length >= 2) resultFeatures.push({ type:'Feature',geometry:{type:'LineString',coordinates:seg.slice()},properties:{} }); seg = []; } });
      if (seg.length >= 2) resultFeatures.push({ type:'Feature',geometry:{type:'LineString',coordinates:seg},properties:{} });
    });
  });
  const diffGJ = { type:'FeatureCollection', features:resultFeatures };
  showDiffResult(origGJ, diffGJ); setRoadStatus('\u26a0\ufe0f 前端模擬');
}

function clearDiff() {
  if (kmlDiffLayer) { map.removeLayer(kmlDiffLayer); kmlDiffLayer = null; }
  document.getElementById('diff-stat').textContent = '開啟圖層後可預覽';
  document.getElementById('btn-clear-diff').style.display = 'none';
  setRoadStatus('', false); toast('已清除消除預覽', 'info');
}

function renderKmlSidebarList() {
  if (curTab !== 'kml') return;
  const list = document.getElementById('asset-list'); list.innerHTML = '';
  if (!kmlLayers.length) { list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px;">尚無 KML 圖層<br>請點右下角面板上傳</div>'; return; }
  const frag = document.createDocumentFragment();
  kmlLayers.forEach(entry => {
    const isOn = !!(kmlPolylines[entry.id] && kmlPolylines[entry.id].length > 0);
    const card = document.createElement('div'); card.className = 'asset-card'; card.style.cursor = 'pointer';
    const dot = document.createElement('div'); dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${entry.color};flex-shrink:0;box-shadow:0 0 5px ${entry.color}88;`;
    const info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0;';
    info.innerHTML = `<div style="font-weight:600;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(entry.name)}</div><div class="mono-label" style="margin-top:1px;color:${isOn ? 'var(--green)' : 'var(--text-muted)'}">${isOn ? '👁 顯示中' : '🙈 已隱藏'}</div>`;
    const toggleBtn = document.createElement('button'); toggleBtn.style.cssText = `padding:3px 8px;border-radius:3px;border:1px solid ${isOn ? 'var(--green-border)' : 'var(--border)'};background:${isOn ? 'var(--green-dim)' : 'var(--input-bg)'};color:${isOn ? 'var(--green)' : 'var(--text-muted)'};cursor:pointer;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;`; toggleBtn.textContent = isOn ? '隱藏' : '顯示';
    toggleBtn.onclick = e => { e.stopPropagation(); toggleKmlVisibility(entry.id); };
    card.append(dot, info, toggleBtn); frag.appendChild(card);
  });
  list.appendChild(frag);
}
