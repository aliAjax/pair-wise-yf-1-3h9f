/* ============================================================
 * scheduler.js —— 调度判断
 * 负责：开灯/关灯扣时、病害苗换下普通苗的可行性判断、
 *       到点自动完成。所有函数只改 state，不碰页面。
 * ============================================================ */
const Scheduler = (() => {

  /** 批次当前实际剩余分钟（灯亮着时按开灯时刻实时扣减） */
  function effectiveRemaining(state, batch, now = Date.now()) {
    if (!batch) return 0;
    let used = 0;
    for (const layer of state.layers) {
      if (layer.batchId === batch.id && layer.lampOn && layer.startedAt) {
        used += (now - layer.startedAt) / 60000;
      }
    }
    return Math.max(0, batch.remainingMin - used);
  }

  /** 从 now 开始连续照，能否赶在期限前完成 */
  function canMeetDeadline(batch, remainingMin, now = Date.now()) {
    const availMin = (new Date(batch.deadline).getTime() - now) / 60000;
    return remainingMin <= availMin;
  }

  function emptyLayerIndex(state) {
    return state.layers.findIndex(l => l.batchId === null);
  }

  function layerOfBatch(state, batchId) {
    return state.layers.findIndex(l => l.batchId === batchId);
  }

  /** 把等待中的批次放上空层并开灯 */
  function assign(state, batchId, layerIdx, now = Date.now()) {
    const batch = BatchStore.findBatch(state, batchId);
    const layer = state.layers[layerIdx];
    if (!batch) return { ok: false, reason: '批次不存在' };
    if (batch.status !== 'waiting') return { ok: false, reason: `${batch.id} 不在等待队列` };
    if (!layer || layer.batchId !== null) return { ok: false, reason: '该层已被占用' };
    if (!canMeetDeadline(batch, batch.remainingMin, now)) {
      return { ok: false, reason: `${batch.id} 剩余 ${batch.remainingMin} 分钟，已赶不上期限 ${fmt(batch.deadline)}，未开灯` };
    }
    layer.batchId = batchId;
    layer.lampOn = true;
    layer.startedAt = now;
    batch.status = 'onLayer';
    BatchStore.addLog(state, 'ok', `${batch.id}（${batch.variety}）上第 ${layerIdx + 1} 层，开灯。`);
    return { ok: true };
  }

  /** 关灯：把本次照明分钟从批次剩余时长中扣除 */
  function lampOff(state, layerIdx, now = Date.now()) {
    const layer = state.layers[layerIdx];
    if (!layer || !layer.lampOn) return { ok: false, reason: '该层灯未开' };
    const batch = BatchStore.findBatch(state, layer.batchId);
    const usedMin = Math.max(0, Math.round((now - layer.startedAt) / 60000));
    if (batch) batch.remainingMin = Math.max(0, batch.remainingMin - usedMin);
    layer.lampOn = false;
    layer.startedAt = null;
    if (batch) {
      BatchStore.addLog(state, 'info', `${batch.id}（${batch.variety}）第 ${layerIdx + 1} 层关灯，本次照明 ${usedMin} 分钟，剩余 ${batch.remainingMin} 分钟。`);
    }
    return { ok: true, usedMin };
  }

  /** 让批次下架空出层（不扣时，调用前需先关灯） */
  function unload(state, layerIdx) {
    const layer = state.layers[layerIdx];
    if (!layer || layer.batchId === null) return;
    const batch = BatchStore.findBatch(state, layer.batchId);
    if (batch && batch.status === 'onLayer') batch.status = 'waiting';
    layer.batchId = null;
    layer.lampOn = false;
    layer.startedAt = null;
  }

  /**
   * 病害苗换下普通苗：
   * 1. 换入者必须是病害苗，被换者必须是普通苗；
   * 2. 必须存在空层接收被换下的批次；
   * 3. 被换下批次转到空层后仍要赶得上期限，否则保留原排程并说明冲突。
   */
  function preempt(state, layerIdx, diseasedBatchId, now = Date.now()) {
    const layer = state.layers[layerIdx];
    const occupant = layer && layer.batchId ? BatchStore.findBatch(state, layer.batchId) : null;
    const challenger = BatchStore.findBatch(state, diseasedBatchId);

    if (!occupant) return { ok: false, reason: '该层没有占用批次' };
    if (!challenger) return { ok: false, reason: '换入批次不存在' };
    if (!BatchStore.isDiseased(challenger)) {
      return { ok: false, reason: `${challenger.id} 不是病害苗，不能执行换下` };
    }
    if (BatchStore.isDiseased(occupant)) {
      return { ok: false, reason: `第 ${layerIdx + 1} 层已是病害苗 ${occupant.id}，无需换下` };
    }

    const emptyIdx = emptyLayerIndex(state);
    if (emptyIdx === -1) {
      const msg = `冲突：没有空层接收被换下的 ${occupant.id}，保留原排程。`;
      BatchStore.addLog(state, 'conflict', msg);
      return { ok: false, reason: msg };
    }

    // 被换下批次转到空层后的可行性：剩余分钟 <= 距期限分钟
    const occRemaining = effectiveRemaining(state, occupant, now);
    if (!canMeetDeadline(occupant, occRemaining, now)) {
      const availMin = Math.max(0, Math.floor((new Date(occupant.deadline).getTime() - now) / 60000));
      const msg = `冲突：${occupant.id}（${occupant.variety}）换到第 ${emptyIdx + 1} 层后还需 ${Math.ceil(occRemaining)} 分钟，但距期限 ${fmt(occupant.deadline)} 只剩 ${availMin} 分钟，赶不上期限，保留原排程。`;
      BatchStore.addLog(state, 'conflict', msg);
      return { ok: false, reason: msg };
    }

    // 执行换下：原层关灯结算 → 病害苗上原层 → 普通苗转空层开灯
    lampOff(state, layerIdx, now);
    unload(state, layerIdx);

    const target = state.layers[layerIdx];
    target.batchId = challenger.id;
    target.lampOn = true;
    target.startedAt = now;
    challenger.status = 'onLayer';

    const spare = state.layers[emptyIdx];
    spare.batchId = occupant.id;
    spare.lampOn = true;
    spare.startedAt = now;
    occupant.status = 'onLayer';

    BatchStore.addLog(state, 'ok',
      `病害苗 ${challenger.id}（${challenger.variety}，病害${BatchStore.diseaseLabel(challenger)}）换下第 ${layerIdx + 1} 层的 ${occupant.id}，${occupant.id} 已转第 ${emptyIdx + 1} 层继续补光，可赶上限期。`);
    return { ok: true, movedTo: emptyIdx };
  }

  /** 每 tick 检查：剩余归零的批次自动完成、关灯、空出层 */
  function tick(state, now = Date.now()) {
    state.layers.forEach((layer, idx) => {
      if (!layer.batchId || !layer.lampOn) return;
      const batch = BatchStore.findBatch(state, layer.batchId);
      if (!batch) return;
      if (effectiveRemaining(state, batch, now) <= 0) {
        lampOff(state, idx, now);
        batch.remainingMin = 0;
        batch.status = 'done';
        layer.batchId = null;
        BatchStore.addLog(state, 'ok', `${batch.id}（${batch.variety}）补光完成，第 ${idx + 1} 层已空出。`);
      }
    });
  }

  function fmt(iso) {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  return { effectiveRemaining, canMeetDeadline, emptyLayerIndex, layerOfBatch, assign, lampOff, unload, preempt, tick, fmt };
})();
