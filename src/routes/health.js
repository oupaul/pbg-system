const express = require('express');
const router = express.Router();
const db = require('../models/db');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { requireAuth } = require('../middleware/auth');
const BackupRestoreService = require('../services/BackupRestoreService');
const AuditLogService = require('../services/AuditLogService');
const loadDeployConfig = require('../config/deploy');

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

// 格式化檔案大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// 格式化時間
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (days > 0) {
    return `${days} 天 ${hours} 小時 ${minutes} 分鐘`;
  } else if (hours > 0) {
    return `${hours} 小時 ${minutes} 分鐘`;
  } else if (minutes > 0) {
    return `${minutes} 分鐘 ${secs} 秒`;
  } else {
    return `${secs} 秒`;
  }
}

// 系統健康狀態頁面（僅管理員）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const healthInfo = {
      database: {},
      system: {},
      statistics: {},
      backup: {},
      recentActivity: []
    };

    // 資料庫資訊
    try {
      const dbPath = path.join(__dirname, '..', '..', 'data', 'invoice_bonus.db');
      const dbStats = fs.statSync(dbPath);
      
      healthInfo.database = {
        path: dbPath,
        size: dbStats.size,
        sizeFormatted: formatFileSize(dbStats.size),
        modifiedTime: dbStats.mtime,
        exists: true
      };

      // 資料表資訊
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all();
      
      healthInfo.database.tableCount = tables.length;
      healthInfo.database.tables = [];

      // 各資料表記錄數
      const tableStats = {
        'projects': { name: '專案', count: 0 },
        'customers': { name: '客戶', count: 0 },
        'invoices': { name: '發票', count: 0 },
        'payments': { name: '收款', count: 0 },
        'users': { name: '使用者', count: 0 },
        'salespeople': { name: '業務', count: 0 },
        'bonus_calculations': { name: '獎金計算', count: 0 },
        'project_types': { name: '專案類型', count: 0 },
        'system_settings': { name: '系統設定', count: 0 },
        'audit_logs': { name: '審計日誌', count: 0 }
      };

      for (const table of tables) {
        try {
          const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get().count;
          if (tableStats[table.name]) {
            tableStats[table.name].count = count;
            healthInfo.database.tables.push({
              name: table.name,
              displayName: tableStats[table.name].name,
              count: count
            });
          } else {
            healthInfo.database.tables.push({
              name: table.name,
              displayName: table.name,
              count: count
            });
          }
        } catch (err) {
          console.warn(`無法統計資料表 ${table.name}:`, err.message);
        }
      }
    } catch (err) {
      healthInfo.database.error = err.message;
      healthInfo.database.exists = false;
    }

    // 系統資訊
    healthInfo.system = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      uptimeFormatted: formatUptime(process.uptime()),
      memory: {
        total: formatFileSize(process.memoryUsage().heapTotal),
        used: formatFileSize(process.memoryUsage().heapUsed),
        external: formatFileSize(process.memoryUsage().external),
        rss: formatFileSize(process.memoryUsage().rss)
      },
      pid: process.pid,
      env: process.env.NODE_ENV || 'development'
    };

    // 統計資訊
    try {
      const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get().count || 0;
      const customerCount = db.prepare('SELECT COUNT(*) as count FROM customers').get().count || 0;
      const invoiceCount = db.prepare('SELECT COUNT(*) as count FROM invoices').get().count || 0;
      const paymentCount = db.prepare('SELECT COUNT(*) as count FROM payments').get().count || 0;
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count || 0;
      const salespersonCount = db.prepare('SELECT COUNT(*) as count FROM salespeople').get().count || 0;
      const bonusCount = db.prepare('SELECT COUNT(*) as count FROM bonus_calculations').get().count || 0;
      
      // 計算總金額統計
      const totalProjectAmount = db.prepare('SELECT COALESCE(SUM(price_with_tax), 0) as total FROM projects').get().total || 0;
      const totalInvoiced = db.prepare("SELECT COALESCE(SUM(amount_with_tax), 0) as total FROM invoices WHERE (status IS NULL OR status = '有效')").get().total || 0;
      // 計算實際收款總額（考慮匯費差異）
      const payments = db.prepare('SELECT bank_deposit_amount, payment_difference, difference_type FROM payments').all();
      const totalReceived = payments.reduce((sum, p) => {
        const bankAmount = p.bank_deposit_amount || 0;
        const difference = p.payment_difference || 0;
        // 如果差異類型是「匯費」，則實際收款 = 銀行匯入金額 + 差異金額
        if (p.difference_type === '匯費') {
          return sum + bankAmount + difference;
        }
        return sum + bankAmount;
      }, 0);

      healthInfo.statistics = {
        projects: projectCount,
        customers: customerCount,
        invoices: invoiceCount,
        payments: paymentCount,
        users: userCount,
        salespeople: salespersonCount,
        bonuses: bonusCount,
        totalProjectAmount: totalProjectAmount,
        totalInvoiced: totalInvoiced,
        totalReceived: totalReceived
      };
    } catch (err) {
      healthInfo.statistics.error = err.message;
    }

    // 備份資訊
    try {
      const backups = BackupRestoreService.listBackups();
      healthInfo.backup = {
        count: backups.length,
        latestBackup: backups.length > 0 ? {
          filename: backups[0].filename,
          size: backups[0].sizeFormatted,
          created: backups[0].created
        } : null,
        scheduleNextRun: null
      };

      // 取得排程備份下次執行時間（僅 Linux 且 systemd 可用時）
      if (process.platform === 'linux') {
        try {
          const deployConfig = typeof loadDeployConfig === 'function' ? loadDeployConfig() : loadDeployConfig;
          const serviceName = deployConfig?.serviceName || 'invoice-bonus-system';
          const timerName = `${serviceName}-backup.timer`;
          const out = execSync(`systemctl list-timers ${timerName} --no-pager 2>/dev/null || true`, { encoding: 'utf8', timeout: 3000 });
          // 解析輸出：找尋包含 timer 名稱的資料行，NEXT 欄位格式如 "Sat 2026-02-07 02:01:18 CST"
          const lines = out.trim().split('\n');
          for (const line of lines) {
            if (line.includes(timerName)) {
              const match = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)/);
              if (match) {
                const nextStr = match[1].trim();
                if (nextStr !== 'NEXT' && nextStr !== '-') {
                  healthInfo.backup.scheduleNextRun = nextStr;
                  break;
                }
              }
            }
          }
        } catch (e) {
          // systemctl 可能不存在或無權限，忽略
        }
      }
    } catch (err) {
      healthInfo.backup.error = err.message;
    }

    // 最近活動（審計日誌）
    try {
      // 檢查表是否存在
      const tableCheck = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='system_logs'
      `).get();
      
      if (tableCheck) {
        const recentLogs = db.prepare(`
          SELECT * FROM system_logs 
          ORDER BY created_at DESC 
          LIMIT 10
        `).all();
        
        healthInfo.recentActivity = recentLogs.map(log => {
          let user = '系統';
          try {
            if (log.user_info) {
              const userInfo = typeof log.user_info === 'string' ? JSON.parse(log.user_info) : log.user_info;
              user = userInfo.name || userInfo.username || '系統';
            }
          } catch (e) {
            // 如果不是 JSON，直接使用原始值
            user = log.user_info || '系統';
          }
          
          let oldValue = null;
          let newValue = null;
          try {
            if (log.old_value) {
              oldValue = typeof log.old_value === 'string' ? JSON.parse(log.old_value) : log.old_value;
            }
            if (log.new_value) {
              newValue = typeof log.new_value === 'string' ? JSON.parse(log.new_value) : log.new_value;
            }
          } catch (e) {
            // JSON 解析失敗，保持為 null
          }
          
          // 合併 old_value 和 new_value 作為 changes
          const changes = {};
          if (oldValue && typeof oldValue === 'object') {
            Object.keys(oldValue).forEach(key => {
              if (!changes[key]) changes[key] = {};
              changes[key].old = oldValue[key];
            });
          }
          if (newValue && typeof newValue === 'object') {
            Object.keys(newValue).forEach(key => {
              if (!changes[key]) changes[key] = {};
              changes[key].new = newValue[key];
            });
          }
          
          return {
            id: log.id,
            action: log.action,
            table_name: log.table_name,
            user: user,
            created_at: log.created_at,
            changes: Object.keys(changes).length > 0 ? changes : null
          };
        });
      } else {
        healthInfo.recentActivity = [];
        healthInfo.recentActivity.error = 'system_logs 表不存在';
      }
    } catch (err) {
      healthInfo.recentActivity = { error: err.message };
    }

    res.render('health/index', {
      title: '系統健康狀態',
      healthInfo: healthInfo
    });
  } catch (err) {
    console.error('載入系統健康狀態失敗:', err);
    res.status(500).render('error', {
      title: '錯誤',
      message: '載入系統健康狀態失敗：' + err.message,
      error: {}
    });
  }
});

module.exports = router;

