/**
 * 全域搜尋：搜尋整個系統的資料（自動掃描所有資料表的文字欄位，命中後歸屬到專案或客戶）。
 * 可搜尋範圍由 SearchService 的系統底線與管理者「搜尋範圍設定」決定。
 */
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const SearchService = require('../services/SearchService');

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < SearchService.MIN_LENGTH) {
    return res.render('search/index', {
      title: '搜尋',
      q: '',
      results: null,
      message: q.length === 1 ? '請至少輸入 2 個字元' : '請輸入搜尋關鍵字'
    });
  }

  const results = SearchService.search(q, req.user);

  let typeColorMap = {};
  try {
    db.prepare('SELECT type_name, badge_color FROM project_types').all()
      .forEach(t => { typeColorMap[t.type_name] = t.badge_color || 'info'; });
  } catch (e) { /* 表不存在時不預載 */ }

  res.render('search/index', {
    title: '搜尋結果',
    q,
    results,
    typeColorMap,
    message: null
  });
});

module.exports = router;
