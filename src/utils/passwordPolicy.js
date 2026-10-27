// 密碼規則（改密碼、管理員新增／編輯使用者共用）。
//   - 最短長度固定 6 個字元（上限 128，避免超長字串拖慢雜湊）
//   - 複雜度要求由管理員在「系統設定」開關（password_complexity_enabled，預設關閉）：
//     開啟時，密碼必須包含大寫字母、小寫字母、數字、符號（其他字元）中的至少 3 種，且不能包含使用者名稱
// 規則只在「設定密碼的當下」檢查，不影響既有密碼，也不會要求既有使用者重設。
const MIN_LENGTH = 6;
const MAX_LENGTH = 128;
const REQUIRED_CLASSES = 3;

const CLASSES = [
  { name: '大寫字母', test: /[A-Z]/ },
  { name: '小寫字母', test: /[a-z]/ },
  { name: '數字', test: /[0-9]/ },
  { name: '符號', test: /[^A-Za-z0-9]/ }
];

/** 目前是否要求密碼複雜度（讀系統設定，不經快取；讀不到視為關閉） */
function isComplexityEnabled() {
  try {
    const row = require('../models/db').prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'password_complexity_enabled'").get();
    return !!row && String(row.setting_value).toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/** 給畫面顯示的規則說明 */
function describe(complexity = isComplexityEnabled()) {
  const base = `至少 ${MIN_LENGTH} 個字元`;
  return complexity ? `${base}，且需包含大寫字母、小寫字母、數字、符號中的至少 ${REQUIRED_CLASSES} 種，不可包含使用者名稱` : base;
}

/**
 * @param {string} password
 * @param {Object} [opts]
 * @param {string} [opts.username]    用來檢查「不可包含使用者名稱」（複雜度開啟時）
 * @param {boolean} [opts.complexity] 是否要求複雜度；不傳就讀系統設定
 * @returns {{ok: boolean, message?: string}}
 */
function validate(password, { username = '', complexity = isComplexityEnabled() } = {}) {
  const pw = typeof password === 'string' ? password : '';
  if (pw.length < MIN_LENGTH) return { ok: false, message: `密碼長度至少需要 ${MIN_LENGTH} 個字元` };
  if (pw.length > MAX_LENGTH) return { ok: false, message: `密碼長度不可超過 ${MAX_LENGTH} 個字元` };
  if (!complexity) return { ok: true };

  const kinds = CLASSES.filter(c => c.test.test(pw)).length;
  if (kinds < REQUIRED_CLASSES) {
    return { ok: false, message: `密碼需包含大寫字母、小寫字母、數字、符號中的至少 ${REQUIRED_CLASSES} 種（目前系統已啟用密碼複雜度要求）` };
  }
  const name = String(username || '').trim().toLowerCase();
  if (name.length >= 3 && pw.toLowerCase().includes(name)) {
    return { ok: false, message: '密碼不可包含使用者名稱（目前系統已啟用密碼複雜度要求）' };
  }
  return { ok: true };
}

module.exports = { MIN_LENGTH, MAX_LENGTH, REQUIRED_CLASSES, isComplexityEnabled, describe, validate };
