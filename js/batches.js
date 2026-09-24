/* ============================================================
 * 批次档案（业务文件一）
 * 批次与苗架的数据模型、localStorage 持久化、首批示例数据。
 * 页面刷新或重开后，从这里恢复现场继续计时。
 * ============================================================ */
const Store = (() => {
  const BATCH_KEY = 'gh-night-batches-v1';
  const LAYER_KEY = 'gh-night-layers-v1';
  const LAYER_COUNT = 4; // 四层苗架

  const DISEASE_LABELS = ['无', '轻', '重'];

  /* ---------- 读取 / 写入 ---------- */

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function save(batches, layers) {
    localStorage.setItem(BATCH_KEY, JSON.stringify(batches));
    localStorage.setItem(LAYER_KEY, JSON.stringify(layers));
  }

  /* ---------- 初始数据 ---------- */

  function makeId() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // 首次使用放入六批示例幼苗，期限按“今夜”相对当前时刻生成
  function seedBatches() {
    const now = Date.now();
    const H = 3600000;
    const seed = [
      { variety: '番茄·合作903',   remainingMin: 90,  deadline: now + 3 * H,     disease: 0 },
      { variety: '黄瓜·津春4号',   remainingMin: 120, deadline: now + 4 * H,     disease: 0 },
      { variety: '辣椒·湘研15号',  remainingMin: 60,  deadline: now + 2.5 * H,   disease: 1 },
      { variety: '生菜·意大利',    remainingMin: 45,  deadline: now + 2 * H,     disease: 0 },
      { variety: '茄子·黑又亮',    remainingMin: 150, deadline: now + 5 * H,     disease: 2 },
      { variety: '西瓜·早春红玉',  remainingMin: 75,  deadline: now + 3.5 * H,   disease: 0 },
    ];
    return seed.map(s => ({
      id: makeId(),
      variety: s.variety,
      remainingMin: s.remainingMin,   // 剩余补光分钟（随照明实时扣减）
      initialMin: s.remainingMin,
      deadline: s.deadline,           // 完成期限（时间戳）
      disease: s.disease,             // 病害等级 0 无 / 1 轻 / 2 重
      status: 'active',               // active | done
      createdAt: now,
    }));
  }

  function emptyLayers() {
    // 每层：当前批次、灯是否开着、上次扣减时刻（关灯/刷新后据此补扣）
    return Array.from({ length: LAYER_COUNT }, (_, i) => ({
      id: i,
      batchId: null,
      lampOn: false,
      lastTick: null,
    }));
  }

  /* ---------- 对外接口 ---------- */

  function load() {
    let batches = readJSON(BATCH_KEY);
    let layers = readJSON(LAYER_KEY);
    if (!batches) batches = seedBatches();
    if (!layers || layers.length !== LAYER_COUNT) layers = emptyLayers();
    save(batches, layers);
    return { batches, layers };
  }

  function reset() {
    localStorage.removeItem(BATCH_KEY);
    localStorage.removeItem(LAYER_KEY);
    return load();
  }

  return { load, save, reset, makeId, DISEASE_LABELS, LAYER_COUNT };
})();
