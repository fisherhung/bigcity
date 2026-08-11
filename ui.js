// ══════════════════════════════════════════════
// ── UI 模組 (ui.js) ──
// ══════════════════════════════════════════════

// ── 期別設定 ──
async function loadPeriodCfg() {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'period_config').maybeSingle();
    if (data?.value) periodCfg = data.value;
  } catch (e) {}
}

async function savePeriodCfg() {
  await sb.from('app_settings').upsert({ key: 'period_config', value: periodCfg, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

function openPeriodConfig() {
  document.getElementById('cfg-early-end').value = periodCfg?.earlyEnd || '0305';
  document.getElementById('cfg-mid-end').value   = periodCfg?.midEnd   || '0320';
  updateCfgPreview();
  document.getElementById('modal-period-config').style.display = 'flex';
  ['cfg-early-end', 'cfg-mid-end'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = updateCfgPreview;
  });
}

function closePeriodConfig() {
  document.getElementById('modal-period-config').style.display = 'none';
}

function updateCfgPreview() {
  const e = (document.getElementById('cfg-early-end').value || '').trim().padStart(4, '0');
  const m = (document.getElementById('cfg-mid-end').value || '').trim().padStart(4, '0');
  const fmt = v => `${parseInt(v.slice(0, 2))}月${parseInt(v.slice(2))}日`;
  const ep = document.getElementById('cfg-early-preview');
  const mp = document.getElementById('cfg-mid-preview');
  const lp = document.getElementById('cfg-late-preview');
  if (ep) ep.innerText = `→ 月初 ～ ${fmt(e)}`;
  if (mp) mp.innerText = `→ ${fmt(e)} 之後 ～ ${fmt(m)}`;
  if (lp) lp.innerText = `→ ${fmt(m)} 之後 至月底`;
}

function applyPeriodConfig() {
  const e = document.getElementById('cfg-early-end').value.trim();
  const m = document.getElementById('cfg-mid-end').value.trim();
  if (!/^\d{4}$/.test(e) || !/^\d{4}$/.test(m)) { toast('請輸入4位數字 MMDD', 'error'); return; }
  if (e >= m) { toast('初的結尾必須早於中的結尾', 'error'); return; }
  periodCfg = { earlyEnd: e, midEnd: m };
  savePeriodCfg().then(() => toast('分界已儲存', 'success'));
  closePeriodConfig();
  refreshAll();
}

function selectModalPeriod(p) {
  pendingManualPeriod = p;
  document.querySelectorAll('.period-select-btn').forEach(btn => {
    const a = btn.dataset.p === p;
    btn.style.background   = a ? 'var(--accent-dim)' : 'var(--input-bg)';
    btn.style.borderColor  = a ? 'var(--accent-border)' : 'var(--border)';
    btn.style.color        = a ? 'var(--accent)' : 'var(--text-muted)';
  });
}

// ── Period popover ──
function closeAllPopovers() { document.querySelectorAll('.period-popover').forEach(p => p.remove()); _openPopoverId = null; }

function togglePeriodPopover(e, assetId) {
  e.stopPropagation();
  if (_openPopoverId === assetId) { closeAllPopovers(); return; }
  closeAllPopovers(); _openPopoverId = assetId;
  const btn = e.currentTarget; const asset = assets.get(assetId); const cur = asset?.manual_period || '';
  const popover = document.createElement('div'); popover.className = 'period-popover';
  const opts = [{ label: 'AUTO', val: '' }, { label: '初', val: '初' }, { label: '中', val: '中' }, { label: '末', val: '末' }];
  opts.forEach(opt => {
    const b = document.createElement('button'); b.textContent = opt.label;
    if (cur === opt.val) b.classList.add('active');
    b.onclick = async (ev) => { ev.stopPropagation(); await setAssetPeriod(assetId, opt.val); closeAllPopovers(); };
    popover.appendChild(b);
  });
  btn.appendChild(popover);
  setTimeout(() => document.addEventListener('click', closeAllPopovers, { once: true }), 0);
}

async function setAssetPeriod(assetId, period) {
  const asset = assets.get(assetId); if (!asset) return;
  const uName = document.getElementById('user-select').value;
  await sb.from('assets').update({ manual_period: period || null }).eq('id', assetId);
  await writeAudit(assetId, asset.display_name, 'renamed', uName, asset.manual_period || 'auto', period || 'auto');
  asset.manual_period = period || '';
  toast(period ? `已設為「${getPeriodLabel(period)}」` : '已恢復自動分類', 'success');
  refreshAll();
}

// ── 列表渲染 ──
function selectPeriod(p) {
  activePeriod = p;
  document.querySelectorAll('.period-chip').forEach(c => c.classList.toggle('active', c.dataset.period === p));
  for (const k of [...collapsedGroups.keys()]) { if (k.startsWith('d:')) collapsedGroups.delete(k); }
  refreshAll();
}

function renderList() {
  if (curTab === 'kml') { renderKmlSidebarList(); return; }
  const list = document.getElementById('asset-list');
  const kw = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
  let gDone = 0, gTotal = 0;
  assets.forEach(a => { gTotal++; if (a.statusData?.status === 'done') gDone++; });
  const gp = gTotal ? Math.round(gDone/gTotal*100) : 0;
  document.getElementById('stat-percent').innerText = gp + '%';
  document.getElementById('progress-bar').style.width = gp + '%';

  const sorted = [...assets.entries()].sort((a,b) => { const cmp = a[1].name.localeCompare(b[1].name,'zh-TW'); return sortOrder === 'asc' ? cmp : -cmp; });
  const frag = document.createDocumentFragment();
  const dayDefaultCollapsed = isDayDefaultCollapsed();

  if (curTab === 'img') {
    sorted.forEach(([id, asset]) => {
      if (asset.type !== 'img') return;
      const st = asset.statusData?.status || 'none', op = asset.statusData?.operator_name || null;
      if (curFilter !== 'all' && st !== curFilter) return;
      if (curOp !== 'all' && op !== curOp) return;
      if (kw && !asset.name.toLowerCase().includes(kw)) return;
      frag.appendChild(makeCard(id, asset, kw));
    });
  } else {
    const PERIOD_ORDER = ['初','中','末','其他'];
    const tree = new Map(); PERIOD_ORDER.forEach(p => tree.set(p, new Map()));
    sorted.forEach(([id, asset]) => {
      if (asset.type !== 'point') return;
      const st = asset.statusData?.status || 'none', op = asset.statusData?.operator_name || null;
      if (curFilter !== 'all' && st !== curFilter) return;
      if (curOp !== 'all' && op !== curOp) return;
      if (kw && !asset.name.toLowerCase().includes(kw)) return;
      const period = effectivePeriod(asset);
      if (activePeriod !== 'all' && period !== activePeriod) return;
      const mm = getMonth(asset.name) || '??', mmdd = getMMDD(asset.name) || '????';
      const pMap = tree.get(period) || tree.get('其他');
      if (!pMap.has(mm)) pMap.set(mm, new Map());
      if (!pMap.get(mm).has(mmdd)) pMap.get(mm).set(mmdd, []);
      pMap.get(mm).get(mmdd).push([id, asset]);
    });

    tree.forEach((mMap, period) => {
      if (!mMap.size) return;
      const pKey = 'p:' + period;
      let pDone = 0, pTotal = 0;
      mMap.forEach(dMap => dMap.forEach(items => items.forEach(([,a]) => { pTotal++; if (a.statusData?.status === 'done') pDone++; })));
      const pPct = pTotal ? Math.round(pDone/pTotal*100) : 0;
      const pDoneDefault = pTotal > 0 && pDone === pTotal;
      const pCollapsed = isCollapsed(pKey, pDoneDefault);
      const pLabel = getPeriodLabel(period);

      const pHdr = document.createElement('div'); pHdr.className = 'group-hdr level-period';
      pHdr.innerHTML = `<div style="display:flex;align-items:center;gap:7px;"><span style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;">${pLabel}</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:#909aac;letter-spacing:.06em;">${pTotal}</span></div><div style="display:flex;align-items:center;gap:6px;"><div style="width:48px;height:3px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden;"><div style="width:${pPct}%;height:100%;background:linear-gradient(90deg,var(--accent),var(--green));border-radius:99px;"></div></div><span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--accent);">${pPct}%</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#909aac;">${pCollapsed ? '▶' : '▼'}</span></div>`;
      pHdr.addEventListener('click', () => toggleCollapse(pKey, pDoneDefault)); frag.appendChild(pHdr);
      if (pCollapsed) return;

      const pBody = document.createElement('div'); pBody.style.cssText = 'display:flex;flex-direction:column;gap:1px;margin-top:2px;';
      [...mMap.entries()].sort((a,b) => a[0].localeCompare(b[0])).forEach(([mm, dMap]) => {
        const mKey = 'm:' + period + ':' + mm, mCollapsed = isCollapsed(mKey, false);
        let mDone = 0, mTotal = 0;
        dMap.forEach(items => items.forEach(([,a]) => { mTotal++; if (a.statusData?.status === 'done') mDone++; }));
        const mPct = mTotal ? Math.round(mDone/mTotal*100) : 0;
        const mHdr = document.createElement('div'); mHdr.className = 'group-hdr level-month';
        mHdr.innerHTML = `<div style="display:flex;align-items:center;gap:5px;"><span style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#c8d0e0;">${mm === '??' ? '??月' : monthLabel(mm)}</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:#909aac;letter-spacing:.06em;">${mTotal}</span></div><div style="display:flex;align-items:center;gap:4px;"><span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:#c8d0e0;">${mPct}%</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#909aac;">${mCollapsed ? '▶' : '▼'}</span></div>`;
        mHdr.addEventListener('click', () => toggleCollapse(mKey, false)); pBody.appendChild(mHdr);
        if (mCollapsed) return;

        const mBody = document.createElement('div'); mBody.style.cssText = 'display:flex;flex-direction:column;gap:1px;margin-top:1px;';
        [...dMap.entries()].sort((a,b) => a[0].localeCompare(b[0])).forEach(([mmdd, items]) => {
          const dKey = 'd:' + period + ':' + mmdd, dCollapsed = isCollapsed(dKey, dayDefaultCollapsed);
          const dDone = items.filter(([,a]) => a.statusData?.status === 'done').length;
          const dHdr = document.createElement('div'); dHdr.className = 'group-hdr level-day';
          dHdr.innerHTML = `<div style="display:flex;align-items:center;gap:4px;"><span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:#b0bac8;letter-spacing:.06em;text-transform:uppercase;">${mmdd === '????' ? '??/??' : dayLabel(mmdd)}</span></div><div style="display:flex;align-items:center;gap:3px;"><span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:${dDone === items.length && items.length > 0 ? 'var(--green)' : '#909aac'};">${dDone}/${items.length}</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#707888;">${dCollapsed ? '▶' : '▼'}</span></div>`;
          dHdr.addEventListener('click', () => toggleCollapse(dKey, dayDefaultCollapsed)); mBody.appendChild(dHdr);
          if (dCollapsed) return;
          const dBody = document.createElement('div'); dBody.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:2px;padding-left:20px;';
          items.forEach(([id, asset]) => dBody.appendChild(makeCard(id, asset, kw))); mBody.appendChild(dBody);
        });
        pBody.appendChild(mBody);
      });
      frag.appendChild(pBody);
    });
  }
  list.innerHTML = ''; list.appendChild(frag); lucide.createIcons();
}

function makeCard(id, asset, kw = '') {
  const st = asset.statusData?.status || 'none', op = asset.statusData?.operator_name || null;
  let dotC = sColor(st), sub = '等待認領', subStyle = 'color:var(--danger);font-weight:600;';
  if (st === 'claimed') { sub = `👷 ${op || '作業中'}`; subStyle = 'color:var(--amber);font-weight:700;'; }
  if (st === 'done')    { sub = `✅ ${op || '已完工'}`; subStyle = 'color:var(--green);font-weight:700;'; }
  const nameHtml = highlight(asset.name, kw);
  const manPeriod = asset.manual_period || '', autoPer = autoPeriod(asset.name) || '';
  const rawP = manPeriod || autoPer;
  const shownPeriod = getPeriodLabel(rawP);
  const isManual = !!manPeriod;
  const assetMemos = memos.filter(m => m.asset_id === id);
  const unresolvedMemos = assetMemos.filter(m => !m.resolved).length;
  const memoTag = unresolvedMemos ? `<span style="display:inline-flex;align-items:center;gap:2px;padding:1px 5px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:800;background:var(--danger-dim);border:1px solid var(--danger-border);color:var(--danger);">📝${unresolvedMemos}</span>` : '';

  const card = document.createElement('div'); card.className = 'asset-card' + (activeId === id ? ' active' : ''); card.id = 'card-' + id;
  const periodBtn = document.createElement('div'); periodBtn.className = 'period-inline-btn' + (isManual ? '' : ' auto'); periodBtn.style.position = 'relative'; periodBtn.title = isManual ? `手動設定：${shownPeriod}` : '點擊設定期別';
  periodBtn.innerHTML = shownPeriod ? `${shownPeriod}${isManual ? '<span style="font-size:9px;margin-left:1px;opacity:.7;">▲</span>' : '<span style="font-size:9px;margin-left:1px;opacity:.5;">▼</span>'}` : `?<span style="font-size:9px;margin-left:1px;opacity:.5;">▼</span>`;
  periodBtn.addEventListener('click', e => togglePeriodPopover(e, id));

  const focusDiv = document.createElement('div'); focusDiv.className = 'card-focus'; focusDiv.style.cssText = 'flex:1;min-width:0;cursor:pointer;';
  focusDiv.innerHTML = `<div style="display:flex;align-items:flex-start;gap:4px;"><span style="font-weight:600;font-size:13.5px;line-height:1.35;color:var(--text);flex:1;word-break:break-word;">${nameHtml}</span>${memoTag}</div><div style="font-size:11px;margin-top:3px;font-family:'JetBrains Mono',monospace;${subStyle}">${sub}</div>`;
  focusDiv.addEventListener('click', () => focusOn(id));

  const btnWrap = document.createElement('div'); btnWrap.style.cssText = 'display:flex;gap:2px;flex-shrink:0;';
  if (asset.type === 'point') {
    const csvBtn = document.createElement('button');
    csvBtn.style.cssText = 'width:22px;height:22px;border-radius:3px;border:1px solid var(--green-border);background:var(--green-dim);cursor:pointer;color:var(--green);display:flex;align-items:center;justify-content:center;font-size:10px;transition:all .15s;';
    csvBtn.title = '匯出 CSV'; csvBtn.textContent = '↓';
    csvBtn.addEventListener('click', () => downloadCSV(id)); btnWrap.appendChild(csvBtn);
  }
  const editBtn = document.createElement('button');
  editBtn.style.cssText = 'width:22px;height:22px;border-radius:3px;border:none;background:none;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;justify-content:center;font-size:12px;opacity:0.5;transition:opacity .15s;';
  editBtn.title = '改名'; editBtn.textContent = '✏️'; editBtn.addEventListener('click', () => editAssetName(id));
  const delBtn = document.createElement('button');
  delBtn.style.cssText = 'width:22px;height:22px;border-radius:3px;border:none;background:none;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;justify-content:center;font-size:12px;opacity:0.5;transition:opacity .15s;';
  delBtn.title = '刪除'; delBtn.textContent = '🗑️'; delBtn.addEventListener('click', () => deleteAsset(id));
  btnWrap.append(editBtn, delBtn);
  const dot = document.createElement('div'); dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${dotC};flex-shrink:0;box-shadow:0 0 6px ${dotC}99;`;
  card.append(dot, focusDiv, periodBtn, btnWrap); return card;
}

function refreshAll() { applyMapStyles(); renderList(); }
function toggleSort() { sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'; document.getElementById('sort-btn').innerText = sortOrder === 'asc' ? '↑' : '↓'; renderList(); }
function setFilter(f) { curFilter = f; document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.toggle('active', c.dataset.filter === f)); for (const k of [...collapsedGroups.keys()]) { if (k.startsWith('d:')) collapsedGroups.delete(k); } refreshAll(); }
function setTypeTab(t) { curTab = t; document.querySelectorAll('.tab').forEach(c => c.classList.toggle('active', c.dataset.type === t)); refreshAll(); }
function setOpFilter(n) { curOp = n; document.querySelectorAll('.op-chip').forEach(c => c.classList.toggle('active', c.dataset.op === n)); for (const k of [...collapsedGroups.keys()]) { if (k.startsWith('d:')) collapsedGroups.delete(k); } refreshAll(); }
function renderOpFilterUI() { const el = document.getElementById('op-filter-list'); el.innerHTML = `<div class="op-chip ${curOp === 'all' ? 'active' : ''}" data-op="all" onclick="setOpFilter('all')">ALL</div>`; operators.forEach(op => { const d = document.createElement('div'); d.className = 'op-chip' + (curOp === op.name ? ' active' : ''); d.dataset.op = op.name; d.innerText = op.name; d.onclick = () => setOpFilter(op.name); el.appendChild(d); }); }
function toggleTools() { const el = document.getElementById('tools-wrap'), icon = document.getElementById('fold-icon'); const closed = el.classList.toggle('closed'); icon.style.transform = closed ? 'rotate(180deg)' : 'rotate(0deg)'; }

function scrollToCard(id) {
  const asset = assets.get(id); if (!asset) return;
  const period = effectivePeriod(asset), mm = getMonth(asset.name) || '??', mmdd = getMMDD(asset.name) || '????';
  collapsedGroups.set('p:'+period, false); collapsedGroups.set('m:'+period+':'+mm, false); collapsedGroups.set('d:'+period+':'+mmdd, false);
  if (activePeriod !== 'all' && activePeriod !== period) { activePeriod = 'all'; document.querySelectorAll('.period-chip').forEach(c => c.classList.toggle('active', c.dataset.period === 'all')); }
  renderList(); requestAnimationFrame(() => { const card = document.getElementById('card-'+id); if (card) { card.scrollIntoView({ behavior:'smooth', block:'center' }); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1800); } });
}

async function focusOn(id) {
  const a = assets.get(id); if (!a) return;
  // Ensure points loaded before fitBounds
  if (a._ensureLoaded) await a._ensureLoaded();
  // Fly to bounds regardless of current zoom level
  if (a.mkBounds) {
    const bd = a.mkBounds();
    if (bd.isValid()) map.fitBounds(bd, { padding: [80, 80], maxZoom: 17, animate: true });
  }
  openPanel(id);
  // Trigger map pulse beacon after fitBounds completes
  setTimeout(() => {
    if (a.type === 'img') pulseBeaconImg(a);
    else pulseBeaconPts(a);
  }, 400);
  scrollToCard(id);
}

function openPanel(id) {
  activeId = id; const a = assets.get(id), s = a.statusData, st = s?.status || 'none';
  document.getElementById('ui-name').innerText = a.name;
  const badge = document.getElementById('ui-badge');
  const claimBtn = document.getElementById('btn-claim'), doneBtn = document.getElementById('btn-done'), releaseBtn = document.getElementById('btn-release');
  const lockNotice = document.getElementById('lock-notice'), lockMsg = document.getElementById('lock-msg');
  if (st === 'done') badge.innerHTML = `<span style="display:inline-block;padding:3px 10px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;background:var(--green-dim);color:var(--green);border:1px solid var(--green-border);text-transform:uppercase;letter-spacing:.06em;">✅ 已完工：${s.operator_name}</span>`;
  else if (st === 'claimed') badge.innerHTML = `<span style="display:inline-block;padding:3px 10px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;background:var(--amber-dim);color:var(--amber);border:1px solid var(--amber-border);text-transform:uppercase;letter-spacing:.06em;">👷 作業中：${s.operator_name}</span>`;
  else badge.innerHTML = `<span style="display:inline-block;padding:3px 10px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;background:var(--input-bg);color:var(--text-muted);border:1px solid var(--border);text-transform:uppercase;letter-spacing:.06em;">OPEN</span>`;
  const curUser = document.getElementById('user-select').value, isOwner = s?.operator_name === curUser;
  if (st === 'claimed' && !isOwner) { claimBtn.className='btn-accent btn-locked'; claimBtn.onclick=null; doneBtn.className='btn-green btn-locked'; doneBtn.onclick=null; releaseBtn.onclick=null; lockNotice.style.display='flex'; lockMsg.innerText=`此區塊由 ${s.operator_name} 認領中。`; }
  else if (st === 'done') { claimBtn.className='btn-accent btn-locked'; claimBtn.onclick=null; doneBtn.className='btn-green btn-locked'; doneBtn.onclick=null; releaseBtn.onclick=() => updateStatus('none'); lockNotice.style.display='flex'; lockMsg.innerText='此區塊已完工，如需修改請先釋出。'; }
  else { claimBtn.className='btn-accent'; claimBtn.onclick=()=>updateStatus('claimed'); doneBtn.className='btn-green'; doneBtn.onclick=()=>updateStatus('done'); releaseBtn.onclick=()=>updateStatus('none'); lockNotice.style.display='none'; }
  document.getElementById('action-panel').style.display = 'block';
  document.getElementById('panel-memo-input-wrap').classList.remove('open');
  if (document.getElementById('panel-memo-ta')) document.getElementById('panel-memo-ta').value = '';
  renderPanelMemos(id); lucide.createIcons(); refreshAll();
  // Always switch tab if needed + scroll sidebar card (map→sidebar bidirectional)
  if (a.type === 'img' && curTab !== 'img') {
    curTab = 'img';
    document.querySelectorAll('.tab').forEach(c => c.classList.toggle('active', c.dataset.type === 'img'));
    renderList();
  }
  scrollToCard(id);
}
function closePanel() { document.getElementById('action-panel').style.display = 'none'; activeId = null; refreshAll(); }

async function updateStatus(status) {
  if (!activeId) return;
  const uName = document.getElementById('user-select').value;
  if (!uName && status !== 'none') return alert('請先選擇作業員');
  const a = assets.get(activeId), oldStatus = a?.statusData?.status || 'none';
  const action = status === 'claimed' ? 'claimed' : status === 'done' ? 'done' : 'released';
  await sb.from('asset_status').upsert({ asset_id: activeId, status, operator_name: status==='none' ? null : uName, updated_at: new Date().toISOString() }, { onConflict: 'asset_id' });
  await writeAudit(activeId, a?.display_name || '', action, uName, oldStatus, status);
  closePanel();
}

// ── 審計 ──
async function writeAudit(assetId, assetName, action, opName, oldVal, newVal) {
  try { await sb.from('audit_log').insert({ asset_id: assetId || null, asset_name: assetName, action, operator_name: opName || null, old_value: oldVal || null, new_value: newVal || null }); } catch (e) {}
}
let auditData = [], auditFilter = 'all';
const ACTION_LABEL = { claimed:{text:'認領',color:'var(--amber)',icon:'👷'}, done:{text:'完工',color:'var(--green)',icon:'✅'}, released:{text:'釋出',color:'#64748b',icon:'🔓'}, renamed:{text:'改名',color:'var(--accent)',icon:'✏️'}, created:{text:'新增',color:'#8b5cf6',icon:'📁'}, deleted:{text:'刪除',color:'var(--danger)',icon:'🗑️'} };
async function openAudit() {
  document.getElementById('modal-audit').style.display = 'flex';
  document.getElementById('audit-list').innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">載入中...</div>';
  const { data, error } = await sb.from('audit_log').select('*').order('created_at', { ascending:false });
  if (error) { document.getElementById('audit-list').innerHTML = '<div style="color:var(--danger);padding:12px;">載入失敗</div>'; return; }
  auditData = data || []; renderAudit();
}
function closeAudit() { document.getElementById('modal-audit').style.display = 'none'; }
function setAuditFilter(f) { auditFilter = f; document.querySelectorAll('.chip[data-afilter]').forEach(c => c.classList.toggle('active', c.dataset.afilter === f)); renderAudit(); }
function renderAudit() {
  const list = document.getElementById('audit-list');
  const filtered = auditFilter === 'all' ? auditData : auditData.filter(r => r.action === auditFilter);
  if (!filtered.length) { list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);">暫無紀錄</div>'; return; }
  const groups = {};
  filtered.forEach(r => { const d = new Date(r.created_at); const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if (!groups[key]) groups[key] = { label:`${d.getFullYear()} 年 ${d.getMonth()+1} 月`, rows:[] }; groups[key].rows.push(r); });
  const frag = document.createDocumentFragment();
  Object.keys(groups).sort((a,b) => b.localeCompare(a)).forEach(key => {
    const g = groups[key]; const hdr = document.createElement('div'); hdr.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--text-muted);letter-spacing:.15em;text-transform:uppercase;padding:10px 4px 6px;border-bottom:1px solid var(--border);margin-bottom:2px;'; hdr.innerText = g.label; frag.appendChild(hdr);
    g.rows.forEach(r => { const al = ACTION_LABEL[r.action] || { text:r.action, color:'#64748b', icon:'•' }; const d = new Date(r.created_at); const ts = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; let sub = r.action === 'renamed' ? `${r.old_value} → ${r.new_value}` : r.operator_name || ''; const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border);'; row.innerHTML = `<div style="font-size:14px;flex-shrink:0;width:18px;text-align:center;">${al.icon}</div><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;"><span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:${al.color};text-transform:uppercase;letter-spacing:.06em;">${al.text}</span><span style="font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;">${r.asset_name}</span></div>${sub ? `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);margin-top:1px;">${sub}</div>` : ''}</div><div style="font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;color:var(--text-muted);flex-shrink:0;white-space:nowrap;">${ts}</div>`; frag.appendChild(row); });
  });
  list.innerHTML = ''; list.appendChild(frag);
}

// ── 統計 ──
function calcStatsByPeriod(period) {
  let done = 0, claimed = 0, none = 0;
  assets.forEach((a, id) => { const p = effectivePeriod(a); if (period !== 'all' && p !== period) return; const st = a.statusData?.status || 'none'; if (st === 'done') done++; else if (st === 'claimed') claimed++; else none++; });
  return { done, claimed, none, total: done+claimed+none };
}
function setStatsPeriod(p) {
  statsPeriod = p;
  document.querySelectorAll('.stats-period-tab').forEach(t => { const a = t.dataset.sp === p; t.style.color = a ? 'var(--accent)' : 'var(--text-muted)'; t.style.borderBottomColor = a ? 'var(--accent)' : 'transparent'; });
  refreshStatsPanel();
}
function refreshStatsPanel() {
  const { done, claimed, none, total } = calcStatsByPeriod(statsPeriod);
  const p = total ? Math.round(done/total*100) : 0;
  document.getElementById('donut-pct').innerText = p + '%';
  document.getElementById('s-done').innerText    = done;
  document.getElementById('s-claimed').innerText = claimed;
  document.getElementById('s-none').innerText    = none;
  document.getElementById('stats-total-label').innerText = `${total} 個圖層`;
  document.getElementById('stats-bar-done').style.width    = (total ? done/total*100 : 0) + '%';
  document.getElementById('stats-bar-claimed').style.width = (total ? claimed/total*100 : 0) + '%';
  drawDonut(done, claimed, none); renderStatsOpList();
}
function drawDonut(done, claimed, none) {
  const canvas = document.getElementById('donut-canvas'), ctx = canvas.getContext('2d');
  const cx=55,cy=55,r=45,lw=11,total=done+claimed+none||1;
  ctx.clearRect(0,0,110,110); let start = -Math.PI/2;
  [{val:done,color:'#4edea3'},{val:claimed,color:'#ffb95f'},{val:none,color:'#ff6b7a'}].forEach(s => { if (!s.val) return; const sw = 2*Math.PI*(s.val/total); ctx.beginPath(); ctx.arc(cx,cy,r,start,start+sw); ctx.lineWidth=lw; ctx.strokeStyle=s.color; ctx.lineCap='round'; ctx.stroke(); start+=sw; });
  if (!done && !claimed && !none) { ctx.beginPath(); ctx.arc(cx,cy,r,-Math.PI/2,Math.PI*1.5); ctx.lineWidth=lw; ctx.strokeStyle='rgba(100,100,100,.1)'; ctx.stroke(); }
}
function renderStatsOpList() {
  const el = document.getElementById('stats-op-list'); el.innerHTML = '';
  const opD={},opC={},opN={};
  assets.forEach(a => { const period=effectivePeriod(a); if (statsPeriod!=='all'&&period!==statsPeriod) return; const st=a.statusData?.status||'none',op=a.statusData?.operator_name; if (op) { if (st==='done') opD[op]=(opD[op]||0)+1; else if (st==='claimed') opC[op]=(opC[op]||0)+1; else opN[op]=(opN[op]||0)+1; } });
  const allOps = [...new Set([...operators.map(o=>o.name),...Object.keys(opD),...Object.keys(opC)])];
  allOps.sort((a,b)=>{ const ta=(opD[a]||0)+(opC[a]||0)+(opN[a]||0),tb=(opD[b]||0)+(opC[b]||0)+(opN[b]||0); return tb-ta; }).forEach(name => {
    const d=opD[name]||0,c=opC[name]||0,n=opN[name]||0,t=d+c+n; if (!t) return;
    const pct = Math.round(d/t*100);
    const card = document.createElement('div'); card.style.cssText = 'padding:13px 15px;background:var(--card-bg);border:1px solid var(--border);border-radius:12px;transition:border-color .15s;';
    card.onmouseenter=()=>card.style.borderColor='var(--border-mid)'; card.onmouseleave=()=>card.style.borderColor='var(--border)';
    card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;"><div style="display:flex;align-items:center;gap:8px;"><div style="width:30px;height:30px;border-radius:50%;background:var(--accent-dim);border:1px solid var(--accent-border);display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:800;color:var(--accent);">${name.slice(0,1)}</div><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;color:var(--text);">${name}</span></div><div style="text-align:right;"><div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:800;color:${pct>=100?'var(--green)':'var(--accent)'};">${pct}%</div><div class="mono-label">${t} 個圖層</div></div></div><div style="height:5px;border-radius:99px;background:rgba(255,255,255,0.05);overflow:hidden;display:flex;margin-bottom:8px;"><div style="width:${Math.round(d/t*100)}%;background:var(--green);transition:width .6s;"></div><div style="width:${Math.round(c/t*100)}%;background:var(--amber);transition:width .6s;"></div></div><div style="display:flex;gap:12px;"><span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--green);">✅ ${d}</span><span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--amber);">⏳ ${c}</span><span class="mono-label">🔴 ${n}</span></div>`;
    el.appendChild(card);
  });
  if (!el.children.length) el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);">此期別暫無作業紀錄</div>';
}
function openStats() { statsPeriod='all'; document.getElementById('modal-stats').style.display='flex'; document.querySelectorAll('.stats-period-tab').forEach(t=>{ const a=t.dataset.sp==='all'; t.style.color=a?'var(--accent)':'var(--text-muted)'; t.style.borderBottomColor=a?'var(--accent)':'transparent'; }); refreshStatsPanel(); }
function closeStats() { document.getElementById('modal-stats').style.display = 'none'; }

function exportXlsx() {
  const rows = [['圖層名稱','類型','期別','狀態','作業員','最後更新']];
  const stL={'done':'已完工','claimed':'進行中','none':'待處理'},tL={'img':'PNG底圖','point':'點位圖層'};
  [...assets.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-TW')).forEach(a => { const s=a.statusData; rows.push([a.display_name,tL[a.type]||a.type,effectivePeriod(a),stL[s?.status||'none'],s?.operator_name||'',s?.updated_at?new Date(s.updated_at).toLocaleString('zh-TW'):'']); });
  const ws=XLSX.utils.aoa_to_sheet(rows); ws['!cols']=[{wch:40},{wch:10},{wch:5},{wch:10},{wch:12},{wch:20}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'進度總覽');
  XLSX.writeFile(wb,`花蓮人行道進度_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel 已匯出','success');
}

function downloadCSV(assetId) {
  const a = assets.get(assetId); if (!a || a.type !== 'point') { toast('找不到圖層','error'); return; }
  const raw = a._rawFeatures; if (!raw?.length) { toast('無點位資料','warn'); return; }
  const esc = v => { const s=String(v??''); return s.includes(',')||s.includes('\n')?`"${s.replace(/"/g,'""')}"`  :s; };
  const rows = ['點名,東坐標,北坐標,高程'];
  raw.forEach(f => { const p=getStdProps(f.properties||{}); rows.push([esc(p.POINT_NAME),esc(p.EAST),esc(p.NORTH),esc(p.ELEV)].join(',')); });
  const blob=new Blob(['\uFEFF'+rows.join('\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),link=document.createElement('a'); link.href=url; link.download=`${a.display_name}.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  toast(`已匯出 ${rows.length-1} 筆`,'success');
}

// ── 操作員管理 ──
function renderOpUI() {
  const sel=document.getElementById('user-select'),cur=sel.value;
  sel.innerHTML='<option value="">選擇作業員...</option>';
  operators.forEach(op=>{ const o=document.createElement('option'); o.value=op.name; o.innerText=op.name; sel.appendChild(o); }); sel.value=cur;
  const list=document.getElementById('op-list'); list.innerHTML='';
  operators.forEach(op=>{ const item=document.createElement('div'); item.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius-md);'; item.innerHTML=`<div style="display:flex;align-items:center;gap:8px;"><div style="width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 5px var(--accent);"></div><span style="font-weight:600;font-size:13px;color:var(--text);">${op.name}</span></div><div style="display:flex;gap:2px;"><button class="ren-btn" style="width:26px;height:26px;border-radius:3px;border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:13px;opacity:0.6;">✏️</button><button class="dop-btn" style="width:26px;height:26px;border-radius:3px;border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:13px;opacity:0.6;">🗑️</button></div>`; item.querySelector('.ren-btn').addEventListener('click',()=>renameOperator(op.id,op.name)); item.querySelector('.dop-btn').addEventListener('click',()=>deleteOperator(op.id)); list.appendChild(item); });
}
async function addOperator() {
  const name = document.getElementById('new-op-name').value.trim();
  if (name) {
    await sb.from('operators').insert({ name });
    document.getElementById('new-op-name').value = '';
    toast(name + ' 已新增', 'success');
    const { data } = await sb.from('operators').select('*').order('name');
    operators = data || [];
    renderOpUI();
    renderOpFilterUI();
  }
}

async function deleteOperator(id) {
  if (confirm('移除此作業員？')) {
    await sb.from('operators').delete().eq('id', id);
    toast('作業員已移除', 'info');
    const { data } = await sb.from('operators').select('*').order('name');
    operators = data || [];
    renderOpUI();
    renderOpFilterUI();
  }
}

async function renameOperator(id, old) {
  const n = prompt('修改姓名：', old);
  if (!n || n === old) return;
  const nn = n.trim();
  await sb.from('operators').update({ name: nn }).eq('id', id);
  await sb.from('asset_status').update({ operator_name: nn }).eq('operator_name', old);
  toast('名稱已更新', 'success');
  const { data } = await sb.from('operators').select('*').order('name');
  operators = data || [];
  renderOpUI();
  renderOpFilterUI();
}
function openOpManager() { document.getElementById('modal-op').style.display='flex'; lucide.createIcons(); }
function closeOpManager() { document.getElementById('modal-op').style.display='none'; }

// ── 說明 ──
function openHelp()  { document.getElementById('modal-help').style.display='flex'; lucide.createIcons(); }
function closeHelp() { document.getElementById('modal-help').style.display='none'; }

// ── 儲存 Modal ──
function closeModal() {
  document.getElementById('modal-save').style.display='none';
  editId=null; pendingJson=null; pendingImg=null; pendingPoints=null; pendingManualPeriod='';
}
function editAssetName(id) {
  editId=id; pendingManualPeriod=assets.get(id)?.manual_period||''; selectModalPeriod(pendingManualPeriod);
  document.getElementById('modal-title').innerText='修改名稱'; document.getElementById('modal-name').value=assets.get(id).name;
  document.getElementById('modal-save').style.display='flex';
}
async function deleteAsset(id) {
  if (confirm('確定刪除此圖層？')) {
    const a=assets.get(id); const uName=document.getElementById('user-select').value;
    await writeAudit(id,a?.display_name||'','deleted',uName,null,null);
    await sb.from('assets').delete().eq('id',id);
  }
}
