// ══════════════════════════════════════════════
// ── 備忘錄模組 (memo.js) ──
// ══════════════════════════════════════════════

function syncMemoOpHint() {
  const name = document.getElementById('user-select').value;
  const hint = document.getElementById('memo-op-name'); if (!hint) return;
  hint.textContent = name ? name : '請先在右上角選擇作業員';
  hint.style.color = name ? 'var(--accent)' : 'var(--text-muted)';
}

function toggleMemo() {
  memoOpen = !memoOpen;
  document.getElementById('memo-panel').classList.toggle('open', memoOpen);
  if (memoOpen) { syncMemoOpHint(); loadMemos(); }
}

async function loadMemos() {
  const [mRes, cRes] = await Promise.all([
    sb.from('memos').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('memo_comments').select('*').order('created_at', { ascending: true })
  ]);
  memos = mRes.data || []; memoComments = {};
  (cRes.data || []).forEach(c => { if (!memoComments[c.memo_id]) memoComments[c.memo_id] = []; memoComments[c.memo_id].push(c); });
  renderMemos(); updateMemoCount(); if (activeId) renderPanelMemos(activeId);
  const sel = document.getElementById('memo-asset-sel');
  sel.innerHTML = '<option value="">關聯圖層（選填）</option>';
  [...assets.entries()].sort((a,b) => a[1].name.localeCompare(b[1].name,'zh-TW')).forEach(([id, a]) => {
    const o = document.createElement('option'); o.value = id; o.innerText = a.name; sel.appendChild(o);
  });
}

function renderPanelMemos(assetId) {
  const list = document.getElementById('panel-memo-list');
  const badge = document.getElementById('panel-memo-badge'); if (!list) return;
  const linked = memos.filter(m => m.asset_id === assetId);
  const unresolved = linked.filter(m => !m.resolved);
  if (unresolved.length) { badge.style.display = 'inline'; badge.textContent = unresolved.length; } else badge.style.display = 'none';
  if (!linked.length) { list.innerHTML = '<div id="panel-memo-empty">此圖層尚無備忘 · 點擊「+ 新增」快速記錄</div>'; return; }
  list.innerHTML = '';
  linked.forEach(m => {
    const d = new Date(m.created_at);
    const ts = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const commentCount = (memoComments[m.id] || []).length;
    const dotColor = m.resolved ? 'var(--green)' : 'var(--amber)';
    const row = document.createElement('div'); row.className = 'pm-memo-row' + (m.resolved ? ' resolved' : ''); row.title = '點擊開啟備忘錄面板';
    row.onclick = () => {
      if (!memoOpen) { memoOpen = true; document.getElementById('memo-panel').classList.add('open'); syncMemoOpHint(); }
      if (!memos.length) loadMemos(); else renderMemos();
      setTimeout(() => {
        const cards = document.querySelectorAll('#memo-list .memo-card');
        const idx = memos.findIndex(x => x.id === m.id);
        if (idx >= 0 && cards[idx]) { cards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' }); cards[idx].style.boxShadow = '0 0 0 2px var(--accent)'; setTimeout(() => { if (cards[idx]) cards[idx].style.boxShadow = ''; }, 1400); }
      }, 320);
    };
    row.innerHTML = `<div class="pm-dot" style="background:${dotColor};margin-top:5px;box-shadow:0 0 5px ${dotColor};"></div><div class="pm-content"><div class="pm-text">${escHtml(m.content)}</div><div class="pm-meta">${m.operator_name ? `<span class="pm-op">👤 ${escHtml(m.operator_name)}</span>` : ''}<span class="pm-time">${ts}</span>${m.resolved ? '<span style="font-family:JetBrains Mono,monospace;font-size:9px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;">✓ DONE</span>' : ''}</div></div>${commentCount ? `<span class="pm-comments">💬 ${commentCount}</span>` : ''}`;
    list.appendChild(row);
  });
}

function togglePanelMemoInput() {
  const wrap = document.getElementById('panel-memo-input-wrap');
  const isOpen = wrap.classList.toggle('open');
  if (isOpen) {
    const ta = document.getElementById('panel-memo-ta'); ta.focus();
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitPanelMemo(); } };
  }
}

async function submitPanelMemo() {
  const ta = document.getElementById('panel-memo-ta');
  const content = ta.value.trim(); if (!content) { toast('請輸入備忘內容', 'warn'); return; }
  const opName = document.getElementById('user-select').value; if (!opName) { toast('請先在右上角選擇作業員', 'error'); return; }
  if (!activeId) { toast('無關聯圖層', 'error'); return; }
  await sb.from('memos').insert({ content, asset_id: activeId, operator_name: opName, pinned: false, resolved: false });
  ta.value = ''; document.getElementById('panel-memo-input-wrap').classList.remove('open');
  toast('備忘已新增', 'success'); await loadMemos();
}

function mkMemoBtn(emoji, title, active, activeBorder, activeBg, onClick) {
  const b = document.createElement('button'); b.title = title; b.textContent = emoji;
  b.style.cssText = `width:26px;height:26px;border-radius:4px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;line-height:1;border:${active ? activeBorder : '1px solid transparent'};background:${active ? activeBg : 'transparent'};opacity:${active ? '1' : '0.4'};transition:all .15s;`;
  b.onmouseenter = () => { b.style.opacity = '1'; if (!active) b.style.background = 'var(--card-hover)'; };
  b.onmouseleave = () => { b.style.opacity = active ? '1' : '0.4'; if (!active) b.style.background = 'transparent'; };
  b.onclick = onClick; return b;
}

function renderMemos() {
  const list = document.getElementById('memo-list');
  if (!memos.length) { list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px;">尚無備忘錄</div>'; return; }
  list.innerHTML = '';
  memos.forEach(m => {
    const comments = memoComments[m.id] || [];
    const d = new Date(m.created_at);
    const ts = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const linked = m.asset_id ? assets.get(m.asset_id) : null;
    const isExpanded = expandedComments.has(m.id);
    const card = document.createElement('div'); card.className = 'memo-card' + (m.pinned ? ' pinned' : '');
    if (m.resolved) card.style.opacity = '0.55';
    if (editingMemoId === m.id) {
      const ta = document.createElement('textarea'); ta.rows = 3; ta.value = m.content; ta.style.cssText = 'width:100%;padding:7px 9px;font-size:12px;resize:none;border-radius:6px;margin-bottom:7px;';
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:5px;';
      const saveBtn = document.createElement('button'); saveBtn.className = 'btn-accent'; saveBtn.style.cssText = 'flex:1;padding:6px;font-size:11px;font-weight:700;border:1px solid var(--accent-border);border-radius:5px;'; saveBtn.textContent = '儲存'; saveBtn.onclick = () => saveEditMemo(m.id, ta.value);
      const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn-ghost'; cancelBtn.style.cssText = 'flex:1;padding:6px;font-size:11px;border-radius:5px;'; cancelBtn.textContent = '取消'; cancelBtn.onclick = () => { editingMemoId = null; renderMemos(); };
      row.append(saveBtn, cancelBtn); card.append(ta, row);
    } else {
      const topRow = document.createElement('div'); topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:7px;margin-bottom:5px;';
      const contentDiv = document.createElement('div'); contentDiv.style.cssText = `font-size:12px;font-weight:500;color:var(--text);line-height:1.5;flex:1;white-space:pre-wrap;word-break:break-all;${m.resolved ? 'text-decoration:line-through;color:var(--text-muted);' : ''}`; contentDiv.textContent = m.content;
      const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;align-items:center;gap:2px;flex-shrink:0;';
      btnRow.append(
        mkMemoBtn(m.resolved ? '✅' : '☑️', m.resolved ? '取消解決' : '標記已解決', m.resolved, '1px solid var(--green-border)', 'var(--green-dim)', () => toggleResolve(m.id, !m.resolved)),
        mkMemoBtn('📌', m.pinned ? '取消置頂' : '置頂', m.pinned, '1px solid var(--amber-border)', 'var(--amber-dim)', () => togglePin(m.id, !m.pinned)),
        mkMemoBtn('✏️', '編輯', false, '', '', () => { editingMemoId = m.id; renderMemos(); }),
        mkMemoBtn('🗑️', '刪除', false, '', '', () => deleteMemo(m.id))
      );
      topRow.append(contentDiv, btnRow); card.appendChild(topRow);
      const metaRow = document.createElement('div'); metaRow.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:7px;';
      if (m.operator_name) { const opBadge = document.createElement('span'); opBadge.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent-border);border-radius:3px;padding:1px 7px;text-transform:uppercase;letter-spacing:.06em;'; opBadge.textContent = '👤 ' + m.operator_name; metaRow.appendChild(opBadge); }
      const timeSpan = document.createElement('span'); timeSpan.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:9px;color:var(--text-muted);font-weight:500;'; timeSpan.textContent = ts; metaRow.appendChild(timeSpan);
      if (linked) { const linkBadge = document.createElement('span'); linkBadge.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:var(--accent-dim);border:1px solid var(--accent-border);color:var(--accent);cursor:pointer;text-transform:uppercase;letter-spacing:.05em;'; linkBadge.textContent = '🔗 ' + linked.name; linkBadge.onclick = () => focusOn(m.asset_id); metaRow.appendChild(linkBadge); }
      if (m.resolved) { const rt = document.createElement('span'); rt.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--green);background:var(--green-dim);border:1px solid var(--green-border);border-radius:3px;padding:1px 7px;text-transform:uppercase;letter-spacing:.06em;'; rt.textContent = '✓ DONE'; metaRow.appendChild(rt); }
      card.appendChild(metaRow);
      const commentSection = document.createElement('div'); commentSection.style.cssText = 'border-top:1px solid var(--border);padding-top:7px;';
      const toggleBtn = document.createElement('button'); toggleBtn.style.cssText = 'display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;color:var(--text-muted);font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:600;padding:0;width:100%;text-transform:uppercase;letter-spacing:.06em;';
      toggleBtn.innerHTML = `<span style="font-size:12px;">💬</span><span>留言</span>${comments.length ? `<span style="background:var(--accent-dim);border:1px solid var(--accent-border);color:var(--accent);border-radius:3px;padding:0 5px;font-size:9px;font-weight:800;">${comments.length}</span>` : ''}<span style="margin-left:auto;">${isExpanded ? '▲' : '▼'}</span>`;
      toggleBtn.onclick = () => { if (expandedComments.has(m.id)) expandedComments.delete(m.id); else expandedComments.add(m.id); renderMemos(); };
      commentSection.appendChild(toggleBtn);
      if (isExpanded) {
        const commentBody = document.createElement('div'); commentBody.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-top:7px;';
        comments.forEach(c => {
          const cd = new Date(c.created_at); const cts = `${cd.getMonth()+1}/${cd.getDate()} ${String(cd.getHours()).padStart(2,'0')}:${String(cd.getMinutes()).padStart(2,'0')}`;
          const cDiv = document.createElement('div'); cDiv.style.cssText = 'padding:6px 9px;background:var(--card-bg);border-radius:6px;border:1px solid var(--border);';
          const cHeader = document.createElement('div'); cHeader.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:3px;';
          const opSpan = document.createElement('span'); opSpan.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;'; opSpan.textContent = c.operator_name || '匿名';
          const tsSpan = document.createElement('span'); tsSpan.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:9px;color:var(--text-muted);'; tsSpan.textContent = cts;
          const delCBtn = document.createElement('button'); delCBtn.style.cssText = 'margin-left:auto;width:18px;height:18px;border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:11px;opacity:0.5;'; delCBtn.textContent = '✕'; delCBtn.onclick = () => deleteComment(c.id);
          cHeader.append(opSpan, tsSpan, delCBtn);
          const cContent = document.createElement('div'); cContent.style.cssText = 'font-size:11px;color:var(--text);line-height:1.5;word-break:break-all;'; cContent.textContent = c.content;
          cDiv.append(cHeader, cContent); commentBody.appendChild(cDiv);
        });
        const inputRow = document.createElement('div'); inputRow.style.cssText = 'display:flex;gap:5px;align-items:flex-end;margin-top:2px;';
        const cTa = document.createElement('textarea'); cTa.rows = 2; cTa.placeholder = '輸入留言（Enter 送出）...'; cTa.style.cssText = 'flex:1;padding:6px 9px;font-size:11px;resize:none;border-radius:6px;';
        const cBtn = document.createElement('button'); cBtn.className = 'btn-accent'; cBtn.style.cssText = 'padding:6px 10px;font-size:11px;font-weight:700;border:1px solid var(--accent-border);border-radius:5px;flex-shrink:0;'; cBtn.textContent = '送出';
        cBtn.onclick = () => submitComment(m.id, cTa.value, cTa);
        cTa.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(m.id, cTa.value, cTa); } });
        inputRow.append(cTa, cBtn); commentBody.appendChild(inputRow); commentSection.appendChild(commentBody);
      }
      card.appendChild(commentSection);
    }
    list.appendChild(card);
  });
}

async function addMemo() {
  const content = document.getElementById('memo-input').value.trim(); if (!content) { toast('請輸入備忘內容', 'warn'); return; }
  const opName = document.getElementById('user-select').value; if (!opName) { toast('請先在右上角選擇作業員', 'error'); return; }
  const assetId = document.getElementById('memo-asset-sel').value || null;
  await sb.from('memos').insert({ content, asset_id: assetId, operator_name: opName, pinned: false, resolved: false });
  document.getElementById('memo-input').value = ''; toast('備忘已新增', 'success'); await loadMemos();
}

async function submitComment(memoId, content, taEl) {
  content = (content || '').trim(); if (!content) { toast('留言不能為空', 'warn'); return; }
  const opName = document.getElementById('user-select').value; if (!opName) { toast('請先在右上角選擇作業員', 'error'); return; }
  await sb.from('memo_comments').insert({ memo_id: memoId, content, operator_name: opName });
  if (taEl) taEl.value = ''; expandedComments.add(memoId); toast('留言已送出', 'success'); await loadMemos();
}

async function deleteComment(id) { if (!confirm('確定刪除此留言？')) return; await sb.from('memo_comments').delete().eq('id', id); await loadMemos(); }
async function toggleResolve(id, resolved) { await sb.from('memos').update({ resolved }).eq('id', id); toast(resolved ? '已標記解決 ✓' : '已取消解決', resolved ? 'success' : 'info'); await loadMemos(); }
async function saveEditMemo(id, content) { content = content.trim(); if (!content) { toast('內容不能為空', 'error'); return; } await sb.from('memos').update({ content }).eq('id', id); editingMemoId = null; toast('備忘已更新', 'success'); await loadMemos(); }
async function togglePin(id, pinned) { await sb.from('memos').update({ pinned }).eq('id', id); await loadMemos(); }
async function deleteMemo(id) { if (!confirm('確定刪除？')) return; await sb.from('memos').delete().eq('id', id); await loadMemos(); toast('已刪除', 'info'); }

function updateMemoCount() {
  const cnt = document.getElementById('memo-count');
  const unresolved = memos.filter(m => !m.resolved).length;
  if (unresolved > 0) { cnt.style.display = 'inline'; cnt.textContent = unresolved; } else cnt.style.display = 'none';
}
