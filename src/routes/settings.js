const express = require('express');
const router = express.Router();
const db = require('../models/db');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { getUserInfo } = require('../utils/authHelper');
const AuditLogService = require('../services/AuditLogService');

// 輔助函數：檢查是否為管理員
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: '權限不足',
      message: '只有管理員可以訪問此頁面',
      error: {}
    });
  }
  next();
}

// 輔助函數：獲取系統設定
function getSystemSetting(key, defaultValue = null) {
  try {
    const setting = db.prepare('SELECT setting_value, setting_type FROM system_settings WHERE setting_key = ?').get(key);
    if (!setting) {
      return defaultValue;
    }
    
    // 根據類型轉換值
    switch (setting.setting_type) {
      case 'number':
        return parseInt(setting.setting_value, 10);
      case 'boolean':
        return setting.setting_value === 'true';
      case 'json':
        return JSON.parse(setting.setting_value);
      default:
        return setting.setting_value;
    }
  } catch (err) {
    console.error(`獲取系統設定失敗 (${key}):`, err);
    return defaultValue;
  }
}

// 輔助函數：更新系統設定
function updateSystemSetting(key, value, type = 'string') {
  try {
    const valueStr = type === 'json' ? JSON.stringify(value) : String(value);
    
    const result = db.prepare(`
      UPDATE system_settings 
      SET setting_value = ?, 
          setting_type = ?,
          updated_at = datetime('now', 'localtime')
      WHERE setting_key = ?
    `).run(valueStr, type, key);
    
    if (result.changes === 0) {
      // 如果設定不存在，則創建
      db.prepare(`
        INSERT INTO system_settings (setting_key, setting_value, setting_type, updated_at)
        VALUES (?, ?, ?, datetime('now', 'localtime'))
      `).run(key, valueStr, type);
    }
    
    return true;
  } catch (err) {
    console.error(`更新系統設定失敗 (${key}):`, err);
    return false;
  }
}

// 系統設定頁面（僅管理員）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    // 獲取所有設定
    const settings = db.prepare('SELECT * FROM system_settings ORDER BY setting_key').all();
    
    // 轉換為物件格式方便使用
    const settingsObj = {};
    settings.forEach(s => {
      switch (s.setting_type) {
        case 'number':
          settingsObj[s.setting_key] = parseInt(s.setting_value, 10);
          break;
        case 'boolean':
          settingsObj[s.setting_key] = s.setting_value === 'true';
          break;
        case 'json':
          settingsObj[s.setting_key] = JSON.parse(s.setting_value);
          break;
        default:
          settingsObj[s.setting_key] = s.setting_value;
      }
    });
    
    res.render('settings/index', {
      title: '系統設定',
      settings: settings,
      settingsObj: settingsObj,
      allUsers: User.findActive(),
      success: req.query.success || '',
      error: req.query.error || ''
    });
  } catch (err) {
    console.error('載入系統設定失敗:', err);
    res.render('settings/index', {
      title: '系統設定',
      settings: [],
      settingsObj: {},
      allUsers: [],
      success: '',
      error: '載入系統設定失敗：' + err.message
    });
  }
});

// 更新系統設定（僅管理員）
router.post('/update', requireAuth, requireAdmin, (req, res) => {
  const { setting_key, setting_value, setting_type } = req.body;
  
  if (!setting_key) {
    return res.redirect('/settings?error=' + encodeURIComponent('設定鍵值不能為空'));
  }
  
  try {
    // 驗證設定值
    let validatedValue = setting_value;
    if (setting_type === 'number') {
      const num = parseInt(setting_value, 10);
      if (isNaN(num)) {
        return res.redirect('/settings?error=' + encodeURIComponent('數值格式不正確'));
      }
      validatedValue = num;
      
      // 特別驗證通知天數：必須在 0-30 之間
      if (setting_key === 'invoice_notification_days_before_month_end') {
        if (num < 0 || num > 30) {
          return res.redirect('/settings?error=' + encodeURIComponent('通知提前天數必須在 0-30 天之間'));
        }
      }
      
      // 特別驗證閒置時間：必須在 0-480 分鐘之間（0-8 小時）
      if (setting_key === 'idle_timeout_minutes') {
        if (num < 0 || num > 480) {
          return res.redirect('/settings?error=' + encodeURIComponent('閒置時間必須在 0-480 分鐘之間'));
        }
      }
      
      // 特別驗證警告時間：必須在 1-10 分鐘之間
      if (setting_key === 'idle_warning_minutes') {
        if (num < 1 || num > 10) {
          return res.redirect('/settings?error=' + encodeURIComponent('警告提前時間必須在 1-10 分鐘之間'));
        }
      }
    } else if (setting_type === 'boolean') {
      validatedValue = setting_value === 'true' || setting_value === '1' || setting_value === 'on';
    }
    
    // 獲取舊值用於審計日誌
    const oldSetting = db.prepare('SELECT * FROM system_settings WHERE setting_key = ?').get(setting_key);
    const oldValue = oldSetting ? oldSetting.setting_value : null;
    
    // 更新設定
    const success = updateSystemSetting(setting_key, validatedValue, setting_type);
    
    if (success) {
      // 記錄審計日誌
      AuditLogService.logUpdate('system_settings', setting_key, 
        { setting_value: oldValue }, 
        { setting_value: String(validatedValue) }, 
        getUserInfo(req));
      
      res.redirect('/settings?success=' + encodeURIComponent('設定已成功更新'));
    } else {
      res.redirect('/settings?error=' + encodeURIComponent('更新設定失敗'));
    }
  } catch (err) {
    console.error('更新系統設定失敗:', err);
    res.redirect('/settings?error=' + encodeURIComponent('更新設定失敗：' + err.message));
  }
});

// 這些設定為密碼／存取權杖類機敏資料，表單為避免外洩不會回填實際值，
// 因此留空必須視為「不變更」，絕不能覆蓋成空字串（否則每次儲存其他欄位都會把已設定的密碼洗掉）
const PRESERVE_IF_EMPTY_KEYS = new Set(['smtp_password', 'line_channel_access_token', 'line_channel_secret']);

// 批量更新設定（僅管理員）
router.post('/bulk-update', requireAuth, requireAdmin, (req, res) => {
  try {
    const updates = req.body;
    let updateCount = 0;
    const errors = [];

    for (const [key, value] of Object.entries(updates)) {
      // 跳過非設定欄位
      if (key === '_method' || key === 'submit') continue;
      // 機敏欄位留空表示不變更，略過（保留資料庫既有值）
      if (PRESERVE_IF_EMPTY_KEYS.has(key) && (!value || String(value).trim() === '')) continue;

      try {
        // 獲取設定的類型
        const setting = db.prepare('SELECT setting_type FROM system_settings WHERE setting_key = ?').get(key);
        if (!setting) {
          errors.push(`設定 ${key} 不存在`);
          continue;
        }
        
        // 驗證並更新
        let validatedValue = value;
        if (setting.setting_type === 'number') {
          const num = parseInt(value, 10);
          if (isNaN(num)) {
            errors.push(`設定 ${key} 的數值格式不正確`);
            continue;
          }
          validatedValue = num;
          
          // 特別驗證通知天數
          if (key === 'invoice_notification_days_before_month_end') {
            if (num < 0 || num > 30) {
              errors.push('通知提前天數必須在 0-30 天之間');
              continue;
            }
          }
          
          // 特別驗證閒置時間
          if (key === 'idle_timeout_minutes') {
            if (num < 0 || num > 480) {
              errors.push('閒置時間必須在 0-480 分鐘之間');
              continue;
            }
          }
          
          // 特別驗證警告時間
          if (key === 'idle_warning_minutes') {
            if (num < 1 || num > 10) {
              errors.push('警告提前時間必須在 1-10 分鐘之間');
              continue;
            }
          }
        } else if (setting.setting_type === 'boolean') {
          validatedValue = value === 'true' || value === '1' || value === 'on';
        }
        
        updateSystemSetting(key, validatedValue, setting.setting_type);
        updateCount++;
      } catch (err) {
        errors.push(`更新 ${key} 失敗：${err.message}`);
      }
    }
    
    if (errors.length > 0) {
      res.redirect('/settings?error=' + encodeURIComponent(errors.join('；')));
    } else {
      res.redirect('/settings?success=' + encodeURIComponent(`成功更新 ${updateCount} 項設定`));
    }
  } catch (err) {
    console.error('批量更新設定失敗:', err);
    res.redirect('/settings?error=' + encodeURIComponent('批量更新失敗：' + err.message));
  }
});

// 匯出輔助函數供其他模組使用
router.getSystemSetting = getSystemSetting;
router.updateSystemSetting = updateSystemSetting;

module.exports = router;

