/* ============================================================
 * batches.js —— 批次档案
 * 负责：批次数据模型、登记/删除、localStorage 持久化。
 * 不处理调度逻辑，也不操作页面。
 * ============================================================ */
const BatchStore = (() => {
  const STORAGE_KEY = 'greenhouse-light-scheduler-v1';
  const LAYER_COUNT = 4;

  const DISEASE_LABELS = ['无', '轻', '中', '重'];

  /** 生成批次编号 */
  function nextId(batches) {
    const max = batches.reduce((m, b) => {
      const n = parseInt(String(b.id).replace(/\D/g, ''), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return 'B' + String(max + 1).padStart(2, '0');
  }

  /** 首次启动的示例六批幼苗（今夜 22:00 模拟，期限按当前时间顺延） */
  function seedBatches() {
    const now = Date.now();
    const hours = h => new Date(now + h * 3600 * 1000).toISOString();
    return [
      { id: 'B01', variety: '番茄 A3',   remainingMin: 120, deadline: hours(4),  diseaseLevel: 0, status: 'waiting' },
      { id: 'B02', variety: '黄瓜 C1',   remainingMin: 90,  deadline: hours(3),  diseaseLevel: 2, status: 'waiting' },
      { id: 'B03', variety: '生菜 L2',   remainingMin: 60,  deadline: hours(5),  diseaseLevel: 0, status: 'waiting' },
      { id: 'B04', variety: '辣椒 P5',   remainingMin: 150, deadline: hours(6),  diseaseLevel: 1, status: 'waiting' },
      { id: 'B05', variety: '茄子 E2',   remainingMin: 80,  deadline: hours(2),  diseaseLevel: 3, status: 'waiting' },
      { id: 'B06', variety: '草莓 S7',   remainingMin: 100, deadline: hours(7),  diseaseLevel: 0, status: 'waiting' },
    ];
  }

  function emptyLayers() {
    return Array.from({ length: LAYER_COUNT }, () => ({
      batchId: null,   // 当前占用层的批次
      lampOn: false,   // 灯是否开着
      startedAt: null, // 本次开灯时间戳（毫秒），用于重开页面后续算
    }));
  }

  function defaultState() {
    return { batches: seedBatches(), layers: emptyLayers(), log: [] };
  }

  /** 读取本地存档；没有则给一份示例数据 */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const state = JSON.parse(raw);
      if (!Array.isArray(state.batches) || !Array.isArray(state.layers)) return defaultState();
      if (state.layers.length !== LAYER_COUNT) state.layers = emptyLayers();
      if (!Array.isArray(state.log)) state.log = [];
      return state;
    } catch (e) {
      return defaultState();
    }
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    return defaultState();
  }

  /** 登记新批次，返回新批次对象 */
  function register(state, { variety, remainingMin, deadline, diseaseLevel }) {
    const batch = {
      id: nextId(state.batches),
      variety: String(variety).trim(),
      remainingMin: Math.max(1, Math.round(Number(remainingMin))),
      deadline: new Date(deadline).toISOString(),
      diseaseLevel: Number(diseaseLevel) || 0,
      status: 'waiting', // waiting | onLayer | done
    };
    state.batches.push(batch);
    return batch;
  }

  function findBatch(state, id) {
    return state.batches.find(b => b.id === id) || null;
  }

  function isDiseased(batch) {
    return batch && batch.diseaseLevel > 0;
  }

  function diseaseLabel(batch) {
    return DISEASE_LABELS[batch.diseaseLevel] || String(batch.diseaseLevel);
  }

  /** 追加一条调度记录（保留最近 100 条） */
  function addLog(state, type, text) {
    state.log.unshift({ time: new Date().toISOString(), type, text });
    if (state.log.length > 100) state.log.length = 100;
  }

  return {
    LAYER_COUNT,
    load, save, reset,
    register, findBatch,
    isDiseased, diseaseLabel,
    addLog,
  };
})();
