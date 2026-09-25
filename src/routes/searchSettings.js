const express = require('express');
const router = express.Router();
const SearchService = require('../services/SearchService');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const tables = SearchService.describe();
  const newCount = tables.reduce((sum, t) => sum + t.columns.filter(c => c.isNew).length, 0);
  res.render('searchSettings/index', {
    title: '搜尋範圍設定',
    tables,
    newCount,
    success: req.query.success || '',
    error: req.query.error || ''
  });
});

// 儲存：表單送出每個可設定項目（all）與被勾選的項目（on），格式為「資料表|欄位」，整表為「資料表|*」
router.post('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const toArray = v => (Array.isArray(v) ? v : (v ? [v] : []));
    const all = toArray(req.body.all);
    const on = new Set(toArray(req.body.on));

    // 只接受目前實際存在、且不在系統底線內的項目，避免被竄改表單寫入任意值
    const valid = new Set();
    SearchService.describe().forEach(t => {
      if (t.floorExcluded) return;
      valid.add(t.name + '|*');
      t.columns.filter(c => !c.floorExcluded).forEach(c => valid.add(t.name + '|' + c.name));
    });

    const entries = all.filter(k => valid.has(k)).map(k => {
      const idx = k.indexOf('|');
      return { table: k.slice(0, idx), column: k.slice(idx + 1), searchable: on.has(k) };
    });
    SearchService.saveSettings(entries);
    res.redirect('/search-settings?success=' + encodeURIComponent('搜尋範圍已更新'));
  } catch (err) {
    console.error('儲存搜尋範圍失敗:', err);
    res.redirect('/search-settings?error=' + encodeURIComponent('儲存失敗：' + err.message));
  }
});

module.exports = router;
