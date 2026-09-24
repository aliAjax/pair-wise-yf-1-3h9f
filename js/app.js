/* ============================================================
 * 页面操作（业务文件三）
 * 渲染、表单、开关灯、计时扣减。
 * 计时基于时间戳：页面关闭期间灯若亮着，重开后自动补扣。
 * ============================================================ */
(() => {
  let { batches, layers } = Store.load();
  let messages = []; // 调度冲突与提示

  const $ = sel => document.querySelector(sel);
  const batchOf = layer => batches.find(b => b.id === layer.batchId);

  /* ---------- 工具 ---------- */

  function fmtClock(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function persist() {
    Store.save(batches, layers);
  }

  /* ---------- 照明扣减 ---------- */

  // 按时间戳扣减某层已照明的分钟数；返回该层批次是否刚完成
  function deduct(layer, now) {
    if (!layer.lampOn || layer.lastTick == null) return false;
    const batch = batchOf(layer);
    if (!batch) { layer.lampOn = false; layer.lastTick = null; return false; }

    const elapsedMin = (now - layer.lastTick) / 60000;
    if (elapsedMin <= 0) return false;
    batch.remainingMin = Math.max(0, batch.remainingMin - elapsedMin);
    layer.lastTick = now;

    if (batch.remainingMin <= 0) {
      batch.status = 'done';
      layer.lampOn = false;
      layer.lastTick = null;
      layer.batchId = null;
      messages = [`「${batch.variety}」补光完成，第 ${layer.id + 1} 层已关灯释放。`];
      return true;
    }
    return false;
  }

  /* ---------- 排程 ---------- */

  function reschedule() {
    const now = Date.now();
    layers.forEach(l => deduct(l, now)); // 排程前先结清照明时长

    const result = Scheduler.plan(batches, layers, now);
    layers.forEach(l => {
      const next = result.assignments.get(l.id) || null;
      if (next !== l.batchId && l.lampOn) {
        // 被换下的层先关灯结算
        deduct(l, now);
        l.lampOn = false;
        l.lastTick = null;
      }
      l.batchId = next;
    });
    messages = result.conflicts.concat(result.warnings);
    persist();
    renderAll();
  }

  /* ---------- 开关灯 ---------- */

  function toggleLamp(layerId) {
    const layer = layers.find(l => l.id === layerId);
    const now = Date.now();
    if (layer.lampOn) {
      deduct(layer, now);          // 关灯时从剩余时长扣除照明分钟
      layer.lampOn = false;
      layer.lastTick = null;
    } else {
      const batch = batchOf(layer);
      if (!batch) { alert('本层未安排批次，无法开灯。'); return; }
      layer.lampOn = true;
      layer.lastTick = now;
    }
    persist();
    renderAll();
  }

  /* ---------- 渲染 ---------- */

  function renderLayers() {
    const box = $('#layers');
    box.innerHTML = '';
    layers.forEach(layer => {
      const batch = batchOf(layer);
      const card = document.createElement('div');
      card.className = 'layer' + (layer.lampOn ? ' lamp-on' : '');
      const diseaseTag = batch
        ? `<span class="tag d${batch.disease}">病害·${Store.DISEASE_LABELS[batch.disease]}</span>`
        : '';
      card.innerHTML = `
        <div class="layer-head">
          <strong>第 ${layer.id + 1} 层</strong>
          <span class="bulb ${layer.lampOn ? 'on' : ''}"></span>
        </div>
        ${batch ? `
          <div class="variety">${batch.variety} ${diseaseTag}</div>
          <div class="meta">剩余 <b>${Math.ceil(batch.remainingMin)}</b> 分钟 · 期限 ${Scheduler.fmtHHMM(batch.deadline)}</div>
          <button data-layer="${layer.id}" class="lamp-btn">${layer.lampOn ? '关灯结算' : '开灯'}</button>
        ` : `
          <div class="variety empty">空层</div>
          <div class="meta">等待排程</div>
        `}
      `;
      box.appendChild(card);
    });
    box.querySelectorAll('.lamp-btn').forEach(btn =>
      btn.addEventListener('click', () => toggleLamp(Number(btn.dataset.layer)))
    );
  }

  function renderTable() {
    const tbody = $('#batch-table tbody');
    tbody.innerHTML = '';
    const now = Date.now();
    [...batches].sort(Scheduler.compare).forEach(b => {
      const tr = document.createElement('tr');
      if (b.status === 'done') tr.className = 'done';
      else if (!Scheduler.canMeetDeadline(b, now)) tr.className = 'overdue';
      const onLayer = layers.find(l => l.batchId === b.id);
      tr.innerHTML = `
        <td>${b.variety}</td>
        <td>${Math.ceil(b.remainingMin)}</td>
        <td>${Scheduler.fmtHHMM(b.deadline)}</td>
        <td><span class="tag d${b.disease}">${Store.DISEASE_LABELS[b.disease]}</span></td>
        <td>${b.status === 'done' ? '已完成' : onLayer ? `第 ${onLayer.id + 1} 层${onLayer.lampOn ? '·照明中' : ''}` : '待上架'}</td>
        <td><button class="del" data-id="${b.id}">删除</button></td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.del').forEach(btn =>
      btn.addEventListener('click', () => removeBatch(btn.dataset.id))
    );
  }

  function renderMessages() {
    const box = $('#conflicts');
    box.innerHTML = messages.length
      ? messages.map(m => `<div class="msg">⚠ ${m}</div>`).join('')
      : '<div class="msg ok">当前排程无冲突。</div>';
  }

  function renderAll() {
    renderLayers();
    renderTable();
    renderMessages();
  }

  /* ---------- 批次增删 ---------- */

  function addBatch(e) {
    e.preventDefault();
    const variety = $('#f-variety').value.trim();
    const remainingMin = Number($('#f-remaining').value);
    const deadline = new Date($('#f-deadline').value).getTime();
    const disease = Number($('#f-disease').value);
    if (!variety || !remainingMin || !deadline) return;
    batches.push({
      id: Store.makeId(),
      variety, remainingMin, initialMin: remainingMin,
      deadline, disease, status: 'active', createdAt: Date.now(),
    });
    e.target.reset();
    setDefaultDeadline();
    reschedule();
  }

  function removeBatch(id) {
    const layer = layers.find(l => l.batchId === id);
    if (layer) {
      deduct(layer, Date.now());
      layer.batchId = null;
      layer.lampOn = false;
      layer.lastTick = null;
    }
    batches = batches.filter(b => b.id !== id);
    reschedule();
  }

  /* ---------- 计时循环 ---------- */

  function tick() {
    const now = Date.now();
    $('#now').textContent = fmtClock(now);
    let finished = false;
    layers.forEach(l => { if (l.lampOn) finished = deduct(l, now) || finished; });
    if (finished) { reschedule(); return; } // 有批次完成，释放层后重排
    persist();
    renderLayers();
    renderTable();
  }

  /* ---------- 启动 ---------- */

  function setDefaultDeadline() {
    const d = new Date(Date.now() + 3 * 3600000);
    const p = n => String(n).padStart(2, '0');
    $('#f-deadline').value =
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  $('#batch-form').addEventListener('submit', addBatch);
  $('#btn-reschedule').addEventListener('click', reschedule);
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('确定清空全部批次与苗架数据？')) return;
    ({ batches, layers } = Store.reset());
    messages = [];
    reschedule();
  });
  window.addEventListener('beforeunload', persist);

  setDefaultDeadline();
  reschedule();          // 打开页面即恢复排程；亮着的灯会在首个 tick 补扣关闭期间的时长
  setInterval(tick, 1000);
})();
