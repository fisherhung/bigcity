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

// ── 4. 關鍵演算法：建構拓撲網絡，拆解為多條獨立道路線段 ──
function _reconstructMultiPathsFromScatter(pts) {
  if (pts.length < 2) return [pts.slice()];
  
  const scale = _localMeterScale(pts);
  const ptsM = pts.map(p => [p[0] * scale.mLng, p[1] * scale.mLat]);
  
  // A. 降採樣 (2.0 公尺網格)
  const nodes = _gridDownsampleM(ptsM, 2.0);
  const n = nodes.length;
  if (n < 2) return [pts.slice()];

  // B. 建立距離限制的無向圖 (近鄰圖, 最大跳躍距離 25 公尺, 避免隔街飛線)
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
    // 每個點最多連向最近的 3 個鄰居，避免複雜交叉網格
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

  // C. 依據交叉點（度數 != 2）切割成獨立的連續線段
  const visitedEdges = new Set();
  const rawSegmentsM = [];

  for (let i = 0; i < n; i++) {
    const degree = adj[i].length;
    // 從端點 (degree === 1) 或 交叉口 (degree > 2) 出發走訪
    if (degree !== 2 || degree === 0) {
      adj[i].forEach(next => {
        const edgeKey = i < next ? `${i}_${next}` : `${next}_${i}`;
        if (visitedEdges.has(edgeKey)) return;

        visitedEdges.add(edgeKey);
        const segment = [nodes[i], nodes[next]];
        let prev = i;
        let curr = next;

        // 當中間節點度數為 2（單純道路中間點）時，持續延伸線段
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

  // 處理可能存在的純閉合環路（如繞學校一圈沒有端點的情況）
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

  // D. 簡化與單位換回 WGS84 經緯度
  const finalPaths = [];
  rawSegmentsM.forEach(segM => {
    const simplifiedM = _douglasPeucker(segM, 1.0); // 1.0 米容許誤差簡化
    if (simplifiedM.length >= 2) {
      const segWGS = simplifiedM.map(p => [p[0] / scale.mLng, p[1] / scale.mLat]);
      finalPaths.push(segWGS);
    }
  });

  return finalPaths.length > 0 ? finalPaths : [pts.slice()];
}
