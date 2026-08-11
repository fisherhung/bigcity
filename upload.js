// ══════════════════════════════════════════════
// ── 上傳模組 (upload.js) ──
// ══════════════════════════════════════════════

let _csvPendingFiles = [];
let _csvParsedData   = null;

// 讀取 ArrayBuffer
function _csvReadBytes(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(new Uint8Array(e.target.result));
    r.onerror = () => rej(new Error('讀取失敗'));
    r.readAsArrayBuffer(file);
  });
}

// 自動偵測編碼並解碼
async function _csvDecode(file) {
  const bytes = await _csvReadBytes(file);
  const tryDec = cs => { try { return new TextDecoder(cs, { fatal: true }).decode(bytes); } catch { return null; } };
  const u = tryDec('utf-8'); if (u) return { text: u, enc: 'UTF-8' };
  const c = tryDec('cp950') || tryDec('big5');
  if (c) return { text: c, enc: 'CP950/Big5' };
  throw new Error('無法判斷編碼，請確認檔案格式');
}

// 解析 CSV（支援引號跳脫）
function _parseCSV(raw) {
  const rows = []; let cur = [''], ci = 0, inQ = false, prev = '';
  for (const ch of raw) {
    if (ch === '"') { if (inQ && ch === prev) cur[ci] += ch; inQ = !inQ; }
    else if (ch === ',' && !inQ) cur[++ci] = '';
    else if ((ch === '\n' || ch === '\r') && !inQ) { if (ch === '\n') { rows.push(cur); cur = ['']; ci = 0; } }
    else cur[ci] += ch;
    prev = ch;
  }
  if (cur.join('').trim() !== '') rows.push(cur);
  return rows;
}

// 自動偵測 X/Y/Z 欄位
function _autoXYZ(headers) {
  const xHints = ['東坐標','东坐标','easting','x坐標','x坐标','x_coord','twd97x','x'];
  const yHints = ['北坐標','北坐标','northing','y坐標','y坐标','y_coord','twd97y','y'];
  const zHints = ['高程','elevation','大地高','height','alt','z'];
  const pick = hints => {
    for (const h of hints) { const f = headers.find(x => x.trim().toLowerCase() === h.toLowerCase()); if (f) return f; }
    for (const h of hints) { const f = headers.find(x => x.trim().toLowerCase().includes(h.toLowerCase())); if (f) return f; }
    return null;
  };
  return { x: pick(xHints), y: pick(yHints), z: pick(zHints) };
}

// 填充欄位下拉（含可選高程 Z）
function _buildCSVSelectors(headers, xDef, yDef, zDef) {
  const sx = document.getElementById('csv-sel-x');
  const sy = document.getElementById('csv-sel-y');
  const sz = document.getElementById('csv-sel-z');
  sx.innerHTML = sy.innerHTML = sz.innerHTML = '';
  const none = document.createElement('option'); none.value = ''; none.textContent = '（不使用）'; sz.appendChild(none);
  headers.forEach(h => {
    [sx, sy, sz].forEach(s => { const o = document.createElement('option'); o.value = h; o.textContent = h; s.appendChild(o); });
  });
  if (xDef) sx.value = xDef;
  if (yDef) sy.value = yDef;
  sz.value = zDef || '';
}

// 統一點位入口：同時接受 GeoJSON + CSV，支援批次
function initUploadListeners() {
  const fiJson = document.getElementById('fi-json');
  if (fiJson) {
    fiJson.onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { pendingJson = JSON.parse(await f.text()); toast('JSON 已讀取', 'success'); }
      catch { alert('JSON 解析失敗'); }
      e.target.value = '';
    };
  }

  const fiPng = document.getElementById('fi-png');
  if (fiPng) {
    fiPng.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (!pendingJson) return alert('請先匯入 JSON');
      const r = new FileReader(); r.onload = ev => {
        const img = new Image(); img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height, max = 1600;
          if (w > max || h > max) { if (w > h) { h = max/w*h; w = max; } else { w = max/h*w; h = max; } }
          canvas.width = w; canvas.height = h; canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          let q = 0.9, res = canvas.toDataURL('image/png');
          while (res.length > 1000000 && q > 0.1) { res = canvas.toDataURL('image/jpeg', q); q -= 0.1; }
          pendingImg = res; pendingManualPeriod = ''; selectModalPeriod('');
          document.getElementById('modal-name').value = pendingJson.name || f.name.split('.')[0];
          document.getElementById('modal-title').innerText = '儲存 PNG 圖層';
          document.getElementById('modal-save').style.display = 'flex';
        }; img.src = ev.target.result;
      }; r.readAsDataURL(f); e.target.value = '';
    };
  }

  const fiPts = document.getElementById('fi-points');
  if (fiPts) {
    fiPts.onchange = async e => {
      const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
      const isCsv = f => /\.csv$/i.test(f.name);
      const isGeo = f => /\.(geojson|json)$/i.test(f.name);
      const csvFiles = files.filter(isCsv), geoFiles = files.filter(isGeo);

      if (!csvFiles.length && geoFiles.length) {
        if (geoFiles.length === 1) {
          try {
            const json = JSON.parse(await geoFiles[0].text());
            pendingPoints = json.features || (Array.isArray(json) ? json : [json]);
            pendingManualPeriod = ''; selectModalPeriod('');
            document.getElementById('modal-name').value = geoFiles[0].name.split('.')[0];
            document.getElementById('modal-title').innerText = '儲存點位';
            document.getElementById('modal-save').style.display = 'flex';
          } catch { alert('GeoJSON 解析失敗'); }
          return;
        }
        await _batchUploadFiles(geoFiles, null, null, null); return;
      }

      _csvPendingFiles = files; _csvParsedData = null;
      try {
        const { text, enc } = await _csvDecode(csvFiles[0]);
        const rows = _parseCSV(text);
        if (rows.length < 2) { toast('CSV 無資料行', 'error'); return; }
        const headers = rows[0].map(h => h.trim());
        const { x, y, z } = _autoXYZ(headers);
        _csvParsedData = { headers, rows, text, enc };
        _buildCSVSelectors(headers, x, y, z);
        const name0 = csvFiles[0].name.replace(/\.csv$/i, '');
        const total = `${csvFiles.length} 個 CSV${geoFiles.length ? ' + '+geoFiles.length+' 個 GeoJSON' : ''}`;
        document.getElementById('csv-modal-name').value = files.length === 1 ? name0 : '';
        document.getElementById('csv-modal-enc').textContent = `共 ${total} · 編碼：${enc} · 座標系：EPSG:3826 → WGS84`;
        pendingManualPeriod = ''; selectModalPeriod('');
        document.getElementById('csv-modal-status').style.display = 'none';
        document.getElementById('modal-csv').style.display = 'flex';
      } catch (err) { toast('CSV 讀取失敗：' + err.message, 'error'); }
    };
  }

  const fiKml = document.getElementById('fi-kml');
  if (fiKml) { fiKml.onchange = e => { const f = e.target.files[0]; if (f) uploadKmlFile(f); e.target.value = ''; }; }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUploadListeners);
} else {
  initUploadListeners();
}

function closeCSVModal() {
  document.getElementById('modal-csv').style.display = 'none';
  _csvPendingFiles = []; _csvParsedData = null;
}

// 單一 CSV → GeoJSON features（支援高程 Z）
function _csvTextToFeatures(text, headers, xField, yField, zField) {
  const rows = _parseCSV(text);
  const xi = headers.indexOf(xField), yi = headers.indexOf(yField);
  const zi = zField ? headers.indexOf(zField) : -1;
  if (xi < 0 || yi < 0) throw new Error(`找不到欄位 "${xField}" 或 "${yField}"`);
  const features = []; let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0].trim() === '') continue;
    const x = parseFloat(row[xi]), y = parseFloat(row[yi]);
    if (isNaN(x) || isNaN(y)) { skipped++; continue; }
    const [lng, lat] = proj4('EPSG:3826', 'WGS84', [x, y]);
    const zv = (zi >= 0 && row[zi]) ? parseFloat(row[zi]) : NaN;
    const coords = !isNaN(zv) ? [lng, lat, zv] : [lng, lat];
    const props = {}; headers.forEach((h, j) => { props[h] = row[j] !== undefined ? row[j].trim() : ''; });
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: props });
  }
  return { features, skipped };
}

// Modal 確認：上傳（單檔 or 批次，支援 GeoJSON+CSV 混合）
async function doCSVUpload() {
  const name   = document.getElementById('csv-modal-name').value.trim();
  const xField = document.getElementById('csv-sel-x').value;
  const yField = document.getElementById('csv-sel-y').value;
  const zField = document.getElementById('csv-sel-z').value;
  const uName  = document.getElementById('user-select').value;
  const st     = document.getElementById('csv-modal-status');
  const btn    = document.getElementById('csv-modal-confirm');
  btn.disabled = true; st.style.display = 'block'; st.textContent = '轉換中…';
  const files = _csvPendingFiles;

  if (files.length > 1 || !name) { closeCSVModal(); await _batchUploadFiles(files, xField, yField, zField); return; }

  const f = files[0], isCsv = /\.csv$/i.test(f.name);
  try {
    if (isCsv) {
      const { text } = await _csvDecode(f);
      const { features, skipped } = _csvTextToFeatures(text, _csvParsedData.headers, xField, yField, zField);
      if (!features.length) throw new Error('無有效座標資料');
      if (skipped) toast(`略過 ${skipped} 筆無效座標`, 'warn');
      st.textContent = '上傳至 Storage…';
      await _uploadGeoJSONfeatures(features, name, uName, pendingManualPeriod || null);
      toast(`CSV 點位已上傳 ✓（${features.length} 點）`, 'success');
    } else {
      const json = JSON.parse(await f.text());
      const features = json.features || (Array.isArray(json) ? json : [json]);
      st.textContent = '上傳至 Storage…';
      await _uploadGeoJSONfeatures(features, name, uName, pendingManualPeriod || null);
      toast(`GeoJSON 點位已上傳 ✓（${features.length} 點）`, 'success');
    }
    closeCSVModal();
  } catch (err) { st.textContent = '❌ ' + err.message; btn.disabled = false; }
}

// 批次上傳（混合 GeoJSON + CSV）
async function _batchUploadFiles(files, xField, yField, zField) {
  const wrap    = document.getElementById('batch-progress-wrap');
  const fillEl  = document.getElementById('batch-fill');
  const labelEl = document.getElementById('batch-label');
  const pctEl   = document.getElementById('batch-pct');
  const detailEl= document.getElementById('batch-detail');
  const toolsWrap = document.getElementById('tools-wrap');
  if (toolsWrap.classList.contains('closed')) { toolsWrap.classList.remove('closed'); const icon = document.getElementById('fold-icon'); if (icon) icon.style.transform = 'rotate(0deg)'; }
  wrap.classList.add('show');
  const uName = document.getElementById('user-select').value;
  let done = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i], n = f.name.replace(/\.(geojson|json|csv)$/i, '');
    labelEl.textContent = `上傳中 (${i+1}/${files.length})：${n}`;
    pctEl.textContent   = Math.round((i / files.length) * 100) + '%';
    fillEl.style.width  = Math.round((i / files.length) * 100) + '%';
    try {
      let features;
      if (/\.csv$/i.test(f.name)) {
        const { text } = await _csvDecode(f);
        const hdrs = _parseCSV(text)[0].map(h => h.trim());
        const res  = _csvTextToFeatures(text, hdrs, xField, yField, zField);
        if (!res.features.length) throw new Error('無有效座標');
        if (res.skipped) toast(`${n}：略過 ${res.skipped} 筆`, 'warn');
        features = res.features;
      } else {
        const json = JSON.parse(await f.text());
        features = json.features || (Array.isArray(json) ? json : [json]);
      }
      await _uploadGeoJSONfeatures(features, n, uName, pendingManualPeriod || null); done++;
    } catch (err) { failed++; detailEl.textContent = `❌ ${n} 失敗：${err.message}`; }
  }
  fillEl.style.width = '100%'; pctEl.textContent = '100%';
  labelEl.textContent = `完成！成功 ${done} 個${failed ? `，失敗 ${failed} 個` : ''}`;
  detailEl.textContent = '';
  toast(`批次上傳完成：${done} 個成功${failed ? `，${failed} 個失敗` : ''}`, failed ? 'warn' : 'success');
  setTimeout(() => wrap.classList.remove('show'), 4000);
}

// 共用：上傳 GeoJSON features 到 Storage + 資料庫
async function _uploadGeoJSONfeatures(features, name, uName, manualP) {
  const geojson = { type: 'FeatureCollection', features };
  const fname   = Date.now() + '_' + name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.geojson';
  const blob    = new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' });
  let pointsUrl = null;
  try {
    const { error: pse } = await sb.storage.from('asset-points').upload(fname, blob, { contentType: 'application/geo+json', upsert: false });
    if (!pse) pointsUrl = sb.storage.from('asset-points').getPublicUrl(fname).data.publicUrl;
  } catch (se) {
    console.warn('Storage 上傳警告，自動轉為資料庫直接儲存:', se);
  }
  const { data: row, error: dbe } = await sb.from('assets').insert({
    display_name: name, type: 'point',
    points_url:  pointsUrl || null,
    points_json: pointsUrl ? null : features,
    manual_period: manualP || null
  }).select().single();
  if (dbe) throw dbe;
  await writeAudit(row?.id, name, 'created', uName, null, name);
}

async function doUpload() {
  const name = document.getElementById('modal-name').value.trim(); if (!name) return;
  const btn = document.getElementById('modal-confirm'), st = document.getElementById('modal-status');
  btn.disabled = true; st.style.display = 'block';
  const uName = document.getElementById('user-select').value;
  try {
    if (editId) {
      const oldName = assets.get(editId)?.display_name || '';
      await sb.from('assets').update({ display_name: name, manual_period: pendingManualPeriod || null }).eq('id', editId);
      await writeAudit(editId, name, 'renamed', uName, oldName, name); toast('已更新', 'success');
    } else if (pendingPoints) {
      const geojson = { type: 'FeatureCollection', features: pendingPoints };
      const fname = Date.now() + '.geojson', blob = new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' });
      let pointsUrl = null;
      st.innerText = '上傳點位至 Storage...';
      const { error: pse } = await sb.storage.from('asset-points').upload(fname, blob, { contentType: 'application/geo+json', upsert: false });
      if (!pse) pointsUrl = sb.storage.from('asset-points').getPublicUrl(fname).data.publicUrl;
      else toast(`Storage 失敗(${pse.message})，改存 DB`, 'warn');
      st.innerText = '寫入資料庫...';
      const { data, error: dbe } = await sb.from('assets').insert({ display_name: name, type: 'point', points_url: pointsUrl || null, points_json: pointsUrl ? null : pendingPoints, manual_period: pendingManualPeriod || null }).select().single();
      if (dbe) throw dbe;
      await writeAudit(data?.id, name, 'created', uName, null, name); toast('點位圖層已上傳 ✓', 'success');
    } else if (pendingImg && pendingJson) {
      const fname = Date.now() + '.jpg', blob = b64Blob(pendingImg);
      const { error: se } = await sb.storage.from('asset-images').upload(fname, blob, { contentType: 'image/jpeg' });
      let imgUrl = null, imgData = null;
      if (!se) imgUrl = sb.storage.from('asset-images').getPublicUrl(fname).data.publicUrl;
      else imgData = pendingImg;
      const { data } = await sb.from('assets').insert({ display_name: name, type: 'img', bounds_json: pendingJson, img_url: imgUrl, img_data: imgData, manual_period: pendingManualPeriod || null }).select().single();
      await writeAudit(data?.id, name, 'created', uName, null, name); toast('PNG 圖層已上傳', 'success');
    }
    closeModal();
  } catch (err) { alert('上傳失敗：' + err.message); } finally { btn.disabled = false; st.style.display = 'none'; }
}

function triggerFile(id) { document.getElementById(id).click(); }
