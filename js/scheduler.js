/* ============================================================
 * 调度判断（业务文件二）
 * 纯函数：不碰页面、不碰存储。
 * 规则：
 *  1. 优先级 = 病害等级高者优先，同级按完成期限早者优先；
 *  2. 一层一灯，优先保留已在架批次，空层按优先级补齐；
 *  3. 病害苗可换下普通苗；被换下批次要转到空层——有现成空层
 *     则立即转，否则等最早空出的一层——且自转层时刻起剩余分钟
 *     仍赶得上期限，否则保留原排程并说明冲突。
 * ============================================================ */
const Scheduler = (() => {

  function fmtHHMM(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 优先级比较：病害重 → 期限早 → 剩余多
  function compare(a, b) {
    if (b.disease !== a.disease) return b.disease - a.disease;
    if (a.deadline !== b.deadline) return a.deadline - b.deadline;
    return b.remainingMin - a.remainingMin;
  }

  // 若从 from 时刻开始持续照明，能否在期限前补完
  function canMeetDeadline(batch, from) {
    return batch.remainingMin <= (batch.deadline - from) / 60000;
  }

  /**
   * 生成排程方案。
   * @returns {{ assignments: Map<layerId, batchId>, conflicts: string[], warnings: string[] }}
   */
  function plan(batches, layers, now) {
    const conflicts = [];
    const warnings = [];
    const active = batches
      .filter(b => b.status === 'active' && b.remainingMin > 0)
      .sort(compare);
    const byId = new Map(batches.map(b => [b.id, b]));

    const assignments = new Map();
    const assigned = new Set();

    // 1) 已在架且未完成的批次保留原位，避免频繁搬动
    for (const layer of layers) {
      if (layer.batchId && active.some(b => b.id === layer.batchId)) {
        assignments.set(layer.id, layer.batchId);
        assigned.add(layer.batchId);
      }
    }

    // 2) 空层按优先级补齐
    const emptyIds = layers.filter(l => !assignments.has(l.id)).map(l => l.id);
    for (const b of active) {
      if (emptyIds.length === 0) break;
      if (assigned.has(b.id)) continue;
      assignments.set(emptyIds.shift(), b.id);
      assigned.add(b.id);
    }

    // 3) 未上架的病害苗，尝试换下架上优先级最低的普通苗
    const waitingDiseased = active.filter(b => !assigned.has(b.id) && b.disease > 0);
    for (const d of waitingDiseased) {
      const normalLayers = layers.filter(l => {
        const occ = byId.get(assignments.get(l.id));
        return occ && occ.disease === 0;
      });
      if (normalLayers.length === 0) {
        conflicts.push(`病害批次「${d.variety}」待上架，但架上没有可换的普通苗，保留原排程。`);
        continue;
      }
      // 换下优先级最低（排最末）的普通苗
      normalLayers.sort((la, lb) => compare(byId.get(assignments.get(lb.id)), byId.get(assignments.get(la.id))));
      const targetLayer = normalLayers[0];
      const displaced = byId.get(assignments.get(targetLayer.id));

      // 被换下批次要转到空层：有现成空层立即转，否则等最早空出的一层
      // （按各层在架批次剩余分钟估算空出时刻）
      const spare = layers.find(l => !assignments.has(l.id));
      let freeAt;
      if (spare) {
        freeAt = now;
      } else {
        const waits = layers
          .filter(l => l.id !== targetLayer.id && assignments.has(l.id))
          .map(l => byId.get(assignments.get(l.id)).remainingMin);
        freeAt = waits.length ? now + Math.min(...waits) * 60000 : now;
      }

      // 转层后仍要赶得上期限，否则保留原排程
      if (!canMeetDeadline(displaced, freeAt)) {
        conflicts.push(
          `病害批次「${d.variety}」拟换下「${displaced.variety}」，但其转至空层（约 ${fmtHHMM(freeAt)} 空出）后，` +
          `剩余 ${Math.ceil(displaced.remainingMin)} 分钟赶不上期限 ${fmtHHMM(displaced.deadline)}，保留原排程。`
        );
        continue;
      }

      // 执行换下：病害苗上架；被换下批次转空层，或暂为待上架等空层
      assignments.set(targetLayer.id, d.id);
      assigned.delete(displaced.id);
      assigned.add(d.id);
      if (spare) {
        assignments.set(spare.id, displaced.id);
        assigned.add(displaced.id);
      } else {
        warnings.push(
          `「${displaced.variety}」被病害批次「${d.variety}」换下，暂为待上架，预计 ${fmtHHMM(freeAt)} 前后有空层可转。`
        );
      }
    }

    // 4) 提示：即使立即开灯也赶不上期限的批次
    for (const b of active) {
      if (!canMeetDeadline(b, now)) {
        warnings.push(
          `「${b.variety}」剩余 ${Math.ceil(b.remainingMin)} 分钟，即使立即开灯也赶不上期限 ${fmtHHMM(b.deadline)}，请人工处置。`
        );
      }
    }

    return { assignments, conflicts, warnings };
  }

  return { compare, canMeetDeadline, plan, fmtHHMM };
})();
