// ══════════════════════════════════════════════
// ── 即時診斷 & RT 訂閱 (realtime.js) ──
// ══════════════════════════════════════════════

function toggleRtDiag() {
  const el = document.getElementById('rt-diag');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function rtLog(msg, color) {
  color = color || 'var(--accent)';
  const log = document.getElementById('rt-log'); if (!log) return;
  const d = new Date();
  const ts = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
  const row = document.createElement('div');
  row.style.cssText = `color:${color};line-height:1.4;border-bottom:1px solid rgba(255,255,255,0.04);padding-bottom:2px;`;
  row.textContent = ts + ' ' + msg;
  log.appendChild(row);
  while (log.children.length > 30) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function rtSetState(state) {
  const badge = document.getElementById('rt-state-badge');
  const dot   = document.getElementById('db-dot');
  const lbl   = document.getElementById('db-label');
  if (!badge) return;
  const map_ = {
    'SUBSCRIBED':   { bg: 'rgba(78,222,163,0.2)',  color: '#4edea3', dot: '#4edea3', label: 'LIVE' },
    'POLLING':      { bg: 'rgba(255,185,95,0.2)',   color: '#ffb95f', dot: '#ffb95f', label: 'POLL' },
    'CHANNEL_ERROR':{ bg: 'rgba(255,107,122,0.2)',  color: '#ff6b7a', dot: '#ff6b7a', label: 'ERR'  },
    'TIMED_OUT':    { bg: 'rgba(255,185,95,0.2)',   color: '#ffb95f', dot: '#ffb95f', label: 'T/O'  },
    'CLOSED':       { bg: 'rgba(100,116,139,0.2)',  color: '#94a3b8', dot: '#475569', label: 'OFF'  }
  };
  const s = map_[state] || { bg: 'rgba(100,116,139,0.2)', color: '#94a3b8', dot: '#475569', label: state };
  badge.style.background = s.bg; badge.style.color = s.color; badge.textContent = state;
  if (dot) dot.style.background = s.dot;
  if (lbl) { lbl.style.color = s.dot; lbl.textContent = s.label; }
  if (state === 'SUBSCRIBED') dot && dot.classList.add('live');
  else dot && dot.classList.remove('live');
}

async function rtDiagTest() {
  rtLog('▶ 手動測試：查詢 asset_status…', '#ffb95f');
  try {
    const { data, error } = await sb.from('asset_status').select('count').single();
    if (error) rtLog('✗ 查詢失敗: ' + error.message, '#ff6b7a');
    else rtLog('✓ DB 正常，asset_status 可讀', '#4edea3');
  } catch (e) { rtLog('✗ 例外: ' + e.message, '#ff6b7a'); }
  rtLog('▶ WebSocket 協議: ' + location.protocol, '#ffb95f');
  if (location.protocol === 'file:') {
    rtLog('⚠ file:// 環境！RT WebSocket 無法使用', '#ffb95f');
    rtLog('→ 請改用本地伺服器（npx serve / python -m http.server）', '#ffb95f');
  }
}

let _pollTimer = null, _lastPollSnapshot = {}, _rtConnected = false;

async function pollFallback() {
  try {
    const [sRes, aRes] = await Promise.all([
      sb.from('asset_status').select('*'),
      sb.from('assets').select('id,display_name,manual_period')
    ]);
    (sRes.data || []).forEach(s => {
      const key = s.asset_id, prev = _lastPollSnapshot[key];
      if (!prev || prev.status !== s.status || prev.operator_name !== s.operator_name) {
        _lastPollSnapshot[key] = s;
        if (assets.has(key)) { assets.get(key).statusData = s; rtLog('🔄 poll 偵測變更 ' + key + ' → ' + s.status, '#c0c1ff'); }
      }
    });
    (aRes.data || []).forEach(row => {
      if (!assets.has(row.id)) {
        sb.from('assets').select('*').eq('id', row.id).maybeSingle().then(async res => {
          if (res.data) {
            const sRow = await sb.from('asset_status').select('*').eq('asset_id', row.id).maybeSingle();
            addAsset(res.data, sRow.data || null);
            rtLog('🔄 poll 新圖層: ' + row.display_name, '#4edea3');
          }
        });
      }
    });
    refreshAll();
  } catch (e) { rtLog('poll 錯誤: ' + (e.message || e), '#ffb95f'); }
}

function startPolling(interval) {
  if (_pollTimer) clearInterval(_pollTimer);
  interval = interval || 4000;
  rtLog('⚠ 切換輪詢模式（' + interval / 1000 + 's）', '#ffb95f');
  rtSetState('POLLING');
  assets.forEach((a, id) => { if (a.statusData) _lastPollSnapshot[id] = a.statusData; });
  _pollTimer = setInterval(pollFallback, interval);
}

function subscribeRT() {
  const rtTimeout = setTimeout(() => {
    if (!_rtConnected) { rtLog('⏱ RT 10秒未連線，啟動輪詢模式', '#ffb95f'); startPolling(4000); }
  }, 10000);

  sb.channel('rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assets' }, async e => {
      const { data: s } = await sb.from('asset_status').select('*').eq('asset_id', e.new.id).maybeSingle();
      addAsset(e.new, s || null); refreshAll(); toast(`新圖層：${e.new.display_name}`, 'info');
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assets' }, e => {
      const a = assets.get(e.new.id); if (!a) return;
      a.name = e.new.display_name; a.display_name = e.new.display_name; a.manual_period = e.new.manual_period || '';
      if (a.type === 'img') a.rect.setTooltipContent(e.new.display_name);
      refreshAll();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'assets' }, e => {
      removeLayer(e.old.id); refreshAll(); toast('圖層已刪除', 'warn');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'asset_status' }, e => {
      const id = e.new?.asset_id || e.old?.asset_id;
      rtLog('📡 RT asset_status ' + e.eventType + ' → ' + (e.new?.status || 'del'), '#c0c1ff');
      if (assets.has(id)) assets.get(id).statusData = e.eventType === 'DELETE' ? null : e.new;
      refreshAll();
      if (e.new?.status === 'claimed') toast(`${e.new.operator_name} 認領了路段`, 'info');
      if (e.new?.status === 'done')    toast(`${e.new.operator_name} 完成了路段 ✓`, 'success');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'operators' }, async () => {
      const { data } = await sb.from('operators').select('*').order('name');
      operators = data || []; renderOpUI(); renderOpFilterUI();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memos' }, async () => {
      const { data } = await sb.from('memos').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false });
      memos = data || []; updateMemoCount();
      if (memoOpen) {
        const { data: cData } = await sb.from('memo_comments').select('*').order('created_at', { ascending: true });
        memoComments = {};
        (cData || []).forEach(c => { if (!memoComments[c.memo_id]) memoComments[c.memo_id] = []; memoComments[c.memo_id].push(c); });
        renderMemos();
      }
      if (activeId) renderPanelMemos(activeId);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memo_comments' }, async () => {
      const { data: cData } = await sb.from('memo_comments').select('*').order('created_at', { ascending: true });
      memoComments = {};
      (cData || []).forEach(c => { if (!memoComments[c.memo_id]) memoComments[c.memo_id] = []; memoComments[c.memo_id].push(c); });
      if (memoOpen) renderMemos();
      if (activeId) renderPanelMemos(activeId);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, async e => {
      if (e.new?.key === 'period_config' && e.new?.value) { periodCfg = e.new.value; renderList(); toast('分界設定已更新', 'info'); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kml_layers' }, async () => {
      try { await loadKmlLayers(); } catch (err) { console.warn('kml RT reload err:', err); }
    })
    .subscribe((status, err) => {
      rtSetState(status);
      rtLog('RT 狀態 → ' + status, status === 'SUBSCRIBED' ? '#4edea3' : status === 'CHANNEL_ERROR' ? '#ff6b7a' : '#ffb95f');
      if (err) rtLog('RT 錯誤: ' + JSON.stringify(err), '#ff6b7a');
      if (status === 'SUBSCRIBED') {
        _rtConnected = true; clearTimeout(rtTimeout);
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; rtLog('✓ RT 已連線，停止輪詢', '#4edea3'); }
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        _rtConnected = false;
        if (!_pollTimer) { rtLog('RT 中斷，啟動輪詢 fallback', '#ffb95f'); startPolling(4000); }
      }
    });
}
