// ══════════════════════════════════════════════
// ── 主程式入口 (app.js) ──
// ══════════════════════════════════════════════

let sb, map, tileLayer;
let assets = new Map(), operators = [];
let activeId = null, curFilter = 'all', curTab = 'point', curOp = 'all';
let pendingJson = null, pendingImg = null, pendingPoints = null, editId = null;
let sortOrder = 'asc';
let locateMarker = null, _ctxCoord = null;
let collapsedGroups = new Map();
let activePeriod = 'all';
let pendingManualPeriod = '';
let memoOpen = false, memos = [], editingMemoId = null;
let memoComments = {}, expandedComments = new Set();
let periodCfg = { earlyEnd: '0305', midEnd: '0320' };
let statsPeriod = 'all';
let _openPopoverId = null;
const canvasRenderer = L.canvas({ padding: 0.5 });

async function init() {
  try {
    // 初始化 Leaflet 地圖
    initMap();

    document.getElementById('btn-toggle').onclick = () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
      setTimeout(() => map.invalidateSize(), 400);
    };
    document.getElementById('locate-input').addEventListener('keydown', e => { if (e.key === 'Enter') locateCoord(); });
    document.getElementById('user-select').addEventListener('change', () => syncMemoOpHint());

    // 建立 Supabase 連線（停用 iframe auth 同步，相容 file:// 協議）
    sb = supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: {
        persistSession: false,
        detectSessionInUrl: false,
        autoRefreshToken: false
      }
    });
    setOnline(true);

    // 立即隱藏 Loading 畫面，解鎖畫面點擊
    const ld = document.getElementById('loading');
    if (ld) ld.style.display = 'none';
    lucide.createIcons();
    toast('系統連線成功', 'success');

    await loadPeriodCfg();
    await loadAll();
    try { await loadKmlLayers(); } catch (e) { console.warn('kml_layers 表格尚未建立:', e); }
    subscribeRT();

    const { data: mData } = await sb.from('memos').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false });
    memos = mData || [];
    updateMemoCount();
  } catch (err) {
    console.error('系統初始化例外:', err);
  } finally {
    const ld = document.getElementById('loading');
    if (ld) ld.style.display = 'none';
    lucide.createIcons();
  }
}

async function loadAll() {
  const [aRes, sRes, oRes] = await Promise.all([
    sb.from('assets').select('id,display_name,type,bounds_json,img_url,points_url,manual_period,created_at'),
    sb.from('asset_status').select('*'),
    sb.from('operators').select('*').order('name')
  ]);
  const sMap = {};
  (sRes.data || []).forEach(s => sMap[s.asset_id] = s);
  operators = oRes.data || [];

  const rows = aRes.data || [];
  let i = 0;
  function batchAdd() {
    const end = Math.min(i + 8, rows.length);
    for (; i < end; i++) {
      const row = { ...rows[i] };
      addAsset(row, sMap[row.id] || null);
    }
    if (i < rows.length) requestAnimationFrame(batchAdd);
    else {
      renderOpUI();
      renderOpFilterUI();
      refreshAll();
    }
  }
  requestAnimationFrame(batchAdd);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  window.addEventListener('load', init);
}
