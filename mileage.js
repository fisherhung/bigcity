// ══════════════════════════════════════════════
// ── 里程試算（純前端模擬）──
// 說明：這個檔案只在瀏覽器端運算，不會寫入 Supabase 資料庫、
//       不會新增任何欄位，重新整理頁面後就會消失，純粹是輔助檢視用的懸浮小工具。
// ══════════════════════════════════════════════

// 已知「不是人名」的圖層標籤（例如量測方式/來源），這裡列出的字串
// 出現在圖層名稱結尾時會被跳過，往前找下一個當作人名。
// 之後遇到新的非人名標籤，直接把字串加進這個陣列即可。
const MILEAGE_NON_NAME_TAGS = ['國土', '基站', '期初', '期末', '複測', '補測'];

// 從圖層名稱萃取「人名」。規則：用底線切開後，從最後一段往前找，
// 跳過出現在 MILEAGE_NON_NAME_TAGS 裡的標籤與純數字/日期(例如 0814)，
// 取第一個看起來像人名的片段；找不到就歸類為「未分類」。
function _mileageExtractPerson(name) {
  if (!name) return '未分類';
  const parts = String(name).split('_').map(s => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (MILEAGE_NON_NAME_TAGS.includes(p)) continue;
    if (/^\d+$/.test(p)) continue; // 純數字（日期流水號等）
    if (/^\d{2,4}[-/]?\d{0,2}[-/]?\d{0,2}$/.test(p)) continue; // 類日期格式
    return p;
  }
  return '未分類';
}

// 讀取某個 point 類型圖層目前畫面上實際呈現的化簡路徑（mainLine），
// 直接沿用已經算好的線，不重新運算，確保跟畫面看到的公里數一致。
function _mileageAssetLengthKm(assetId) {
  const a = assets.get(assetId);
  if (!a || a.type !== 'point' || !a.visual) return 0;
  let mainLine = null;
  a.visual.eachLayer(l => {
    if (l instanceof L.Polyline && l.options && l.options.isBorder === false) mainLine = l;
  });
  if (!mainLine) return 0;
  const latlngs = mainLine.getLatLngs();
  let totalM = 0;
  for (let i = 1; i < latlngs.length; i++) totalM += latlngs[i - 1].distanceTo(latlngs[i]);
  return totalM / 1000;
}

// 統計所有 CSV 點位圖層的里程，並依人員彙總。
async function computeMileageStats() {
  const pointAssets = [];
  assets.forEach((a, id) => { if (a.type === 'point') pointAssets.push({ id, a }); });

  // 確保每個圖層的原始點位都已載入（ensureLoaded 內部有 loaded 旗標，重複呼叫不會重抓）
  await Promise.all(pointAssets.map(({ a }) => (a._ensureLoaded ? a._ensureLoaded() : Promise.resolve())));

  const rows = pointAssets.map(({ id, a }) => {
    const km = _mileageAssetLengthKm(id);
    const person = _mileageExtractPerson(a.display_name || a.name || '');
    const mmdd = getMMDD(a.display_name || a.name || ''); // 例如 "0814"，抓不到就是 null
    return { id, name: a.display_name || a.name || '(未命名)', km, person, mmdd };
  }).sort((x, y) => y.km - x.km);

  const byPerson = new Map(); // person -> { km, days:Set }
  rows.forEach(r => {
    if (!byPerson.has(r.person)) byPerson.set(r.person, { km: 0, days: new Set() });
    const rec = byPerson.get(r.person);
    rec.km += r.km;
    if (r.mmdd) rec.days.add(r.mmdd);
  });
  const personRows = Array.from(byPerson.entries())
    .map(([person, rec]) => ({ person, km: rec.km, days: rec.days.size }))
    .sort((x, y) => y.km - x.km);

  const totalKm = rows.reduce((s, r) => s + r.km, 0);
  return { rows, personRows, totalKm };
}

// ── 懸浮按鈕 + 面板 UI（純 DOM 動態建立，不動 index.html）──
function _mileageEnsureUI() {
  if (document.getElementById('mileage-fab')) return;

  const fab = document.createElement('button');
  fab.id = 'mileage-fab';
  fab.title = '里程試算（前端模擬，不寫入資料庫）';
  fab.innerHTML = '<i data-lucide="ruler"></i>';
  fab.onclick = _mileageTogglePanel;
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'mileage-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="mileage-head">
      <div>
        <div class="mileage-title">里程試算</div>
        <div class="mileage-sub">前端模擬・不寫入資料庫・重整頁面即消失</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button id="mileage-refresh" class="mileage-icon-btn" title="重新計算"><i data-lucide="refresh-cw"></i></button>
        <button id="mileage-close" class="mileage-icon-btn" title="關閉"><i data-lucide="x"></i></button>
      </div>
    </div>
    <div id="mileage-body" class="mileage-body">
      <div class="mileage-loading">計算中…</div>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById('mileage-close').onclick = () => { panel.style.display = 'none'; };
  document.getElementById('mileage-refresh').onclick = _mileageRender;
  lucide.createIcons();
}

function _mileageTogglePanel() {
  _mileageEnsureUI();
  const panel = document.getElementById('mileage-panel');
  const showing = panel.style.display !== 'none';
  if (showing) { panel.style.display = 'none'; return; }
  panel.style.display = 'flex';
  _mileageRender();
}

async function _mileageRender() {
  const body = document.getElementById('mileage-body');
  if (!body) return;
  body.innerHTML = '<div class="mileage-loading">計算中…</div>';
  const { rows, personRows, totalKm } = await computeMileageStats();

  if (rows.length === 0) {
    body.innerHTML = '<div class="mileage-empty">目前沒有 CSV 點位圖層</div>';
    return;
  }

  const personHtml = personRows.map(p => {
    const avg = p.days > 0 ? (p.km / p.days).toFixed(2) : '-';
    return `
    <div class="mileage-row mileage-row-person">
      <div class="mileage-row-main">
        <span class="mileage-row-name">${escHtml(p.person)}</span>
        <span class="mileage-row-meta">${p.days} 天・平均 ${avg} km/天</span>
      </div>
      <span class="mileage-row-km">${p.km.toFixed(2)} km</span>
    </div>
  `;
  }).join('');

  const assetHtml = rows.map(r => `
    <div class="mileage-row mileage-row-sm">
      <span class="mileage-row-name" title="${escHtml(r.name)}">${escHtml(r.name)}</span>
      <span class="mileage-row-km">${r.km.toFixed(2)} km</span>
    </div>
  `).join('');

  body.innerHTML = `
    <div class="mileage-total">
      <span>總里程</span>
      <span class="mileage-total-km">${totalKm.toFixed(2)} km</span>
    </div>
    <div class="mileage-section-title">依人員彙總</div>
    <div class="mileage-list">${personHtml}</div>
    <div class="mileage-section-title">各圖層明細（${rows.length}）</div>
    <div class="mileage-list mileage-list-scroll">${assetHtml}</div>
    <div class="mileage-note">※ 里程為畫面上化簡路徑的估算值，僅供參考，非精確測量結果。</div>
  `;
}

document.addEventListener('DOMContentLoaded', _mileageEnsureUI);
