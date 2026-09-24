/* ============================================================
 * ui.js —— 页面操作
 * 负责：渲染苗架层/等待队列/调度记录、绑定表单与按钮、
 *       每秒刷新倒计时并落盘。不做调度判断，只调 Scheduler。
 * ============================================================ */
(() => {
  let state = BatchStore.load();

  const $ = sel => document.querySelector(sel);
  const layersEl = $('#layers');
  const waitingEl = $('#waiting-list');
  const doneEl = $('#done-list');
  const messagesEl = $('#messages');
  const clockEl = $('#clock');

  /* ---------- 渲染 ---------- */

  function renderClock(now) {
    const d = new Date(now);
    clockEl.textContent = d.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function diseaseTag(batch) {
    return BatchStore.isDiseased(batch)
      ? `<span class="tag-disease">病害 ${BatchStore.diseaseLabel(batch)}</span>`
      : `<span class="tag-normal">普通</span>`;
  }

  function deadlineText(batch, now) {
    const overdue = new Date(batch.deadline).getTime() < now;
    return `<span class="${overdue ? 'overdue' : ''}">期限 ${Scheduler.fmt(batch.deadline)}${overdue ? '（已超期）' : ''}</span>`;
  }

  function renderLayers(now) {
    layersEl.innerHTML = '';
    state.layers.forEach((layer, idx) => {
      const card = document.createElement('div');
      card.className = 'layer' + (layer.lampOn ? ' lamp-on' : '');
      const batch = layer.batchId ? BatchStore.findBatch(state, layer.batchId) : null;

      let body = '';
      if (batch) {
        const remain = Scheduler.effectiveRemaining(state, batch, now);
        body = `
          <div class="meta">
            <div><b>${batch.id}</b> ${batch.variety} ${diseaseTag(batch)}</div>
            <div>剩余 <span class="countdown">${Math.ceil(remain)}</span> 分钟</div>
            <div>${deadlineText(batch, now)}</div>
          </div>
          <div class="actions">
            ${layer.lampOn
              ? `<button class="small" data-act="off" data-layer="${idx}">关灯（扣减本次照明）</button>`
              : `<button class="small" data-act="on" data-layer="${idx}">重新开灯</button>
                 <button class="small" data-act="unload" data-layer="${idx}">下架回等待队列</button>`}
            ${renderPreemptControl(batch, idx)}
          </div>`;
      } else {
        const waiting = state.batches.filter(b => b.status === 'waiting');
        body = waiting.length
          ? `<div class="meta empty-hint">空层，可安排批次开灯</div>
             <div class="actions">
               <select data-role="pick" data-layer="${idx}">
                 ${waiting.map(b => `<option value="${b.id}">${b.id} ${b.variety}（剩 ${b.remainingMin} 分钟${BatchStore.isDiseased(b) ? '，病害' + BatchStore.diseaseLabel(b) : ''}）</option>`).join('')}
               </select>
               <button class="small" data-act="assign" data-layer="${idx}">开灯上架</button>
             </div>`
          : `<div class="meta empty-hint">空层（无等待批次）</div>`;
      }

      card.innerHTML = `
        <h3>第 ${idx + 1} 层 <span class="lamp">${layer.lampOn ? '● 灯亮' : '○ 灯灭'}</span></h3>
        ${body}`;
      layersEl.appendChild(card);
    });
  }

  /** 普通苗在架且有病害苗等待时，给出“换下”操作 */
  function renderPreemptControl(occupant, layerIdx) {
    if (BatchStore.isDiseased(occupant)) return '';
    const diseasedWaiting = state.batches.filter(b => b.status === 'waiting' && BatchStore.isDiseased(b));
    if (!diseasedWaiting.length) return '';
    return `
      <select data-role="preempt-pick" data-layer="${layerIdx}">
        ${diseasedWaiting.map(b => `<option value="${b.id}">${b.id} ${b.variety}（病害${BatchStore.diseaseLabel(b)}）</option>`).join('')}
      </select>
      <button class="small" data-act="preempt" data-layer="${layerIdx}">病害苗换下本层</button>`;
  }

  function renderLists(now) {
    const waiting = state.batches.filter(b => b.status === 'waiting');
    waitingEl.innerHTML = waiting.length
      ? waiting.map(b => {
          const overdueCls = new Date(b.deadline).getTime() < now ? ' class="overdue"' : '';
          return `<li${overdueCls}><b>${b.id}</b> ${b.variety} ｜ 剩 ${b.remainingMin} 分钟 ｜ ${diseaseTag(b)} ｜ ${deadlineText(b, now)}</li>`;
        }).join('')
      : '<li class="empty-hint">暂无等待批次</li>';

    const done = state.batches.filter(b => b.status === 'done');
    doneEl.innerHTML = done.length
      ? done.map(b => `<li><b>${b.id}</b> ${b.variety} ｜ 已完成 ｜ ${diseaseTag(b)}</li>`).join('')
      : '<li class="empty-hint">暂无完成批次</li>';
  }

  function renderMessages() {
    messagesEl.innerHTML = state.log.length
      ? state.log.map(e => `<li class="${e.type}">[${Scheduler.fmt(e.time)}] ${e.text}</li>`).join('')
      : '<li class="info">暂无调度记录</li>';
  }

  function render() {
    const now = Date.now();
    renderClock(now);
    renderLayers(now);
    renderLists(now);
    renderMessages();
  }

  /* ---------- 事件 ---------- */

  function showResult(result) {
    if (!result.ok && result.reason) {
      // 冲突/失败原因已在 preempt 中写日志；这里兜底写一条
      if (!state.log.length || state.log[0].text !== result.reason) {
        BatchStore.addLog(state, 'conflict', result.reason);
      }
    }
    BatchStore.save(state);
    render();
  }

  layersEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const idx = Number(btn.dataset.layer);
    const act = btn.dataset.act;

    if (act === 'assign') {
      const pick = layersEl.querySelector(`select[data-role="pick"][data-layer="${idx}"]`);
      if (pick && pick.value) showResult(Scheduler.assign(state, pick.value, idx));
    } else if (act === 'off') {
      showResult(Scheduler.lampOff(state, idx));
    } else if (act === 'on') {
      showResult(relight(state, idx));
    } else if (act === 'unload') {
      showResult(unloadLayer(state, idx));
    } else if (act === 'preempt') {
      const pick = layersEl.querySelector(`select[data-role="preempt-pick"][data-layer="${idx}"]`);
      if (pick && pick.value) showResult(Scheduler.preempt(state, idx, pick.value));
    }
  });

  /** 关灯后的批次重新开灯（批次仍在该层） */
  function relight(state, idx) {
    const layer = state.layers[idx];
    const batch = BatchStore.findBatch(state, layer.batchId);
    if (!batch) return { ok: false, reason: '该层无批次' };
    if (!Scheduler.canMeetDeadline(batch, batch.remainingMin)) {
      return { ok: false, reason: `${batch.id} 剩余 ${batch.remainingMin} 分钟已赶不上期限，未开灯` };
    }
    layer.lampOn = true;
    layer.startedAt = Date.now();
    BatchStore.addLog(state, 'info', `${batch.id}（${batch.variety}）第 ${idx + 1} 层重新开灯。`);
    return { ok: true };
  }

  /** 下架：关灯扣时后批次回等待队列 */
  function unloadLayer(state, idx) {
    const layer = state.layers[idx];
    if (layer.lampOn) Scheduler.lampOff(state, idx);
    const batch = BatchStore.findBatch(state, layer.batchId);
    Scheduler.unload(state, idx);
    if (batch) BatchStore.addLog(state, 'info', `${batch.id}（${batch.variety}）下架回等待队列。`);
    return { ok: true };
  }

  $('#register-form').addEventListener('submit', e => {
    e.preventDefault();
    const variety = $('#f-variety').value;
    const remainingMin = $('#f-remaining').value;
    const deadline = $('#f-deadline').value;
    const diseaseLevel = $('#f-disease').value;
    if (!variety.trim() || !deadline) return;
    const batch = BatchStore.register(state, { variety, remainingMin, deadline, diseaseLevel });
    BatchStore.addLog(state, 'info', `登记批次 ${batch.id}（${batch.variety}），剩余 ${batch.remainingMin} 分钟，期限 ${Scheduler.fmt(batch.deadline)}，病害${BatchStore.diseaseLabel(batch)}。`);
    BatchStore.save(state);
    e.target.reset();
    render();
  });

  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('确定清空全部数据并恢复示例六批？')) return;
    state = BatchStore.reset();
    BatchStore.save(state);
    render();
  });

  window.addEventListener('beforeunload', () => BatchStore.save(state));

  /* ---------- 主循环：每秒刷新倒计时，自动完成到期批次 ---------- */
  setInterval(() => {
    Scheduler.tick(state);
    BatchStore.save(state); // 持续落盘，重开页面可继续
    render();
  }, 1000);

  render();
})();
