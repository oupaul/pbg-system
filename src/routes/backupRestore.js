const express = require('express');
const router = express.Router();
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');

// 嘗試載入 BackupRestoreService，如果失敗則記錄錯誤
let BackupRestoreService;
try {
  BackupRestoreService = require('../services/BackupRestoreService');
  console.log('[備份還原路由] BackupRestoreService 載入成功');
} catch (error) {
  console.error('[備份還原路由] BackupRestoreService 載入失敗:', error);
  console.error('[備份還原路由] 錯誤堆疊:', error.stack);
  // 創建一個假的服務以避免應用崩潰
  BackupRestoreService = {
    listBackups: () => {
      console.error('[備份還原路由] BackupRestoreService 未正確載入');
      return [];
    },
    createBackup: async () => ({ success: false, error: '服務未正確載入' }),
    restoreBackup: async () => ({ success: false, error: '服務未正確載入' }),
    deleteBackup: async () => ({ success: false, error: '服務未正確載入' })
  };
}

// 所有路由都需要登入
router.use(requireAuth);

// 檢查是否為管理員
const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: '權限不足',
      user: req.session.user,
      message: '此功能僅限管理員使用'
    });
  }
  next();
};

// 所有備份還原功能都需要管理員權限
router.use(requireAdmin);

// 備份還原管理頁面
router.get('/', (req, res, next) => {
  try {
    console.log('[備份還原] 載入備份還原頁面');
    console.log('[備份還原] 用戶:', req.session.user ? req.session.user.username : '未登入');
    
    let backups = [];
    try {
      backups = BackupRestoreService.listBackups();
      console.log('[備份還原] 找到備份檔案數量:', backups ? backups.length : 0);
    } catch (listError) {
      console.error('[備份還原] 列出備份失敗:', listError);
      // 即使列出備份失敗，也繼續渲染頁面，只是顯示錯誤訊息
    }
    
    // 獲取備份目錄路徑
    let backupDir = '/opt/invoice-bonus-backups'; // 預設值
    try {
      backupDir = BackupRestoreService.getBackupDir() || backupDir;
    } catch (err) {
      console.warn('[備份還原] 無法獲取備份目錄路徑:', err.message);
    }
    
    res.render('backup-restore/index', {
      title: '備份與還原',
      user: req.session.user,
      backups: backups || [],
      backupDir: backupDir,
      success: req.query.success ? decodeURIComponent(req.query.success) : null,
      error: req.query.error ? decodeURIComponent(req.query.error) : null
    });
  } catch (error) {
    console.error('[備份還原] 載入備份還原頁面錯誤:', error);
    console.error('[備份還原] 錯誤堆疊:', error.stack);
    // 使用 next 將錯誤傳遞給錯誤處理中間件
    next(error);
  }
});

// 執行備份
router.post('/backup', async (req, res) => {
  try {
    // 異步執行備份，立即返回操作 ID
    const operationId = BackupRestoreService.generateOperationId ? 
      BackupRestoreService.generateOperationId() : 
      'op_' + Date.now();
    
    // 異步執行備份
    BackupRestoreService.createBackup(operationId).catch(err => {
      console.error('備份執行錯誤:', err);
    });
    
    // 返回操作 ID，讓前端可以輪詢進度
    res.json({
      success: true,
      operationId: operationId,
      message: '備份已開始執行'
    });
  } catch (error) {
    console.error('備份錯誤:', error);
    res.status(500).json({
      success: false,
      error: error.message || '備份失敗'
    });
  }
});

// 執行還原
router.post('/restore', async (req, res) => {
  try {
    const { backupFile } = req.body;
    if (!backupFile) {
      return res.status(400).json({
        success: false,
        error: '請選擇要還原的備份檔案'
      });
    }

    // 異步執行還原，立即返回操作 ID
    const operationId = BackupRestoreService.generateOperationId ? 
      BackupRestoreService.generateOperationId() : 
      'op_' + Date.now();
    
    console.log('[還原路由] 開始還原操作，備份檔案:', backupFile, '操作ID:', operationId);
    
    // 異步執行還原
    BackupRestoreService.restoreBackup(backupFile, operationId).catch(err => {
      console.error('[還原路由] 還原執行錯誤:', err);
      console.error('[還原路由] 錯誤堆疊:', err.stack);
      
      // 更新進度為錯誤狀態（如果進度服務可用）
      try {
        const progressService = require('../services/BackupProgressService');
        const progress = progressService.getProgress(operationId);
        if (progress) {
          progressService.setProgress(operationId, {
            status: 'error',
            operation: 'restore',
            progress: 0,
            message: err.message || '還原失敗'
          });
        }
      } catch (progressError) {
        console.error('[還原路由] 更新進度失敗:', progressError);
      }
    });
    
    // 返回操作 ID，讓前端可以輪詢進度
    res.json({
      success: true,
      operationId: operationId,
      message: '還原已開始執行'
    });
  } catch (error) {
    console.error('還原錯誤:', error);
    res.status(500).json({
      success: false,
      error: error.message || '還原失敗'
    });
  }
});

// 刪除備份
router.post('/delete', async (req, res) => {
  try {
    const { backupFile } = req.body;
    if (!backupFile) {
      return res.redirect('/backup-restore?error=' + encodeURIComponent('請選擇要刪除的備份檔案'));
    }

    const result = await BackupRestoreService.deleteBackup(backupFile);
    if (result.success) {
      res.redirect('/backup-restore?success=' + encodeURIComponent('備份檔案已刪除'));
    } else {
      res.redirect('/backup-restore?error=' + encodeURIComponent(result.error || '刪除失敗'));
    }
  } catch (error) {
    console.error('刪除備份錯誤:', error);
    res.redirect('/backup-restore?error=' + encodeURIComponent(error.message || '刪除失敗'));
  }
});

// 批次刪除備份
router.post('/delete-batch', async (req, res) => {
  try {
    const { backupFiles } = req.body;
    if (!backupFiles || !Array.isArray(backupFiles) || backupFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: '請選擇要刪除的備份檔案'
      });
    }

    let deletedCount = 0;
    const errors = [];

    for (const backupFile of backupFiles) {
      try {
        const result = await BackupRestoreService.deleteBackup(backupFile);
        if (result.success) {
          deletedCount++;
        } else {
          errors.push(`${backupFile}: ${result.error || '刪除失敗'}`);
        }
      } catch (error) {
        errors.push(`${backupFile}: ${error.message || '刪除失敗'}`);
      }
    }

    if (errors.length > 0) {
      return res.json({
        success: deletedCount > 0,
        deletedCount: deletedCount,
        error: `部分刪除失敗: ${errors.join('; ')}`,
        errors: errors
      });
    }

    res.json({
      success: true,
      deletedCount: deletedCount,
      message: `已成功刪除 ${deletedCount} 個備份檔案`
    });
  } catch (error) {
    console.error('批次刪除備份錯誤:', error);
    res.status(500).json({
      success: false,
      error: error.message || '批次刪除失敗'
    });
  }
});

// 下載備份檔案
router.get('/download/:filename', async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    if (!filename || !filename.match(/^(backup_|uninstall_backup_).*\.tar\.gz$/)) {
      return res.status(400).send('無效的檔案名稱');
    }

    // 查找備份檔案 - 使用 BackupRestoreService 的邏輯
    const backups = BackupRestoreService.listBackups();
    const backup = backups.find(b => b.filename === filename);
    
    if (!backup || !backup.path) {
      return res.status(404).send('找不到備份檔案');
    }
    
    const backupPath = backup.path;

    // 設置下載標頭
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'application/gzip');
    
    // 發送檔案
    const fileStream = fs.createReadStream(backupPath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('下載備份檔案錯誤:', error);
      if (!res.headersSent) {
        res.status(500).send('下載檔案失敗');
      }
    });
  } catch (error) {
    console.error('下載備份檔案錯誤:', error);
    res.status(500).send('下載檔案失敗: ' + error.message);
  }
});

// 獲取進度狀態
router.get('/progress/:operationId', (req, res) => {
  try {
    const progressService = require('../services/BackupProgressService');
    const progress = progressService.getProgress(req.params.operationId);
    
    if (!progress) {
      return res.json({
        status: 'not_found',
        message: '找不到進度資訊'
      });
    }
    
    res.json(progress);
  } catch (error) {
    console.error('獲取進度錯誤:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || '獲取進度失敗'
    });
  }
});

// NAS 設定相關路由
const NasConfigService = require('../services/NasConfigService');

// 獲取 NAS 設定
router.get('/nas/config', (req, res) => {
  try {
    const config = NasConfigService.getConfig();
    res.json({
      success: true,
      config: config
    });
  } catch (error) {
    console.error('獲取 NAS 設定錯誤:', error);
    res.status(500).json({
      success: false,
      error: error.message || '獲取設定失敗'
    });
  }
});

// 保存 NAS 設定
router.post('/nas/config', (req, res) => {
  try {
    const result = NasConfigService.saveConfig(req.body);
    if (result.success) {
      res.json({
        success: true,
        message: '設定已儲存'
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || '儲存失敗'
      });
    }
  } catch (error) {
    console.error('保存 NAS 設定錯誤:', error);
    res.status(500).json({
      success: false,
      error: error.message || '儲存失敗'
    });
  }
});

// 測試 NAS 連接
router.post('/nas/test', async (req, res) => {
  try {
    const result = await NasConfigService.testConnection(req.body);
    res.json(result);
  } catch (error) {
    console.error('測試 NAS 連接錯誤:', error);
    res.status(500).json({
      success: false,
      message: error.message || '測試失敗'
    });
  }
});

module.exports = router;


