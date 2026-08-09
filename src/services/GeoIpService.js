const path = require('path');
const fs = require('fs');

// GeoLite2-Country.mmdb 不隨 repo 提供（授權與檔案大小考量，見 CLAUDE.md
// 「登入紀錄地區判斷」一節的下載方式），需自行放到這個路徑。
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'GeoLite2-Country.mmdb');

let reader = null;
let attemptedLoad = false;

async function getReader() {
  if (reader) return reader;
  if (attemptedLoad) return null; // 已經失敗過，不要每次登入都重新嘗試/噴警告
  attemptedLoad = true;

  if (!fs.existsSync(DB_PATH)) {
    console.warn(`[GeoIpService] 找不到 ${DB_PATH}，登入紀錄將不含地區資訊`);
    return null;
  }

  try {
    const maxmind = require('maxmind');
    reader = await maxmind.open(DB_PATH);
    console.log('[GeoIpService] ✓ GeoLite2 資料庫載入完成');
    return reader;
  } catch (err) {
    console.warn('[GeoIpService] GeoLite2 資料庫載入失敗:', err.message);
    return null;
  }
}

// 查詢 IP 對應的 ISO 3166-1 alpha-2 國碼。只回傳代碼（例如 'TW'、'US'），
// 不使用資料庫內建的地名字串——避免地緣政治相關的命名爭議，畫面顯示時
// 由前端自行把代碼轉成國旗 emoji。
// 找不到資料庫、內網/私有 IP、查無資料，一律回傳 null，不影響登入流程。
async function lookupCountryCode(ip) {
  if (!ip || ip === 'unknown') return null;

  const r = await getReader();
  if (!r) return null;

  try {
    const result = r.get(ip);
    const code = result && result.country && result.country.iso_code;
    return /^[A-Z]{2}$/.test(code) ? code : null;
  } catch (err) {
    return null;
  }
}

module.exports = { lookupCountryCode };
