const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const execAsync = promisify(exec);
const progressService = require('./BackupProgressService');

const PROJECT_DIR = process.cwd();

// 動態偵測安裝目錄
function detectInstallDir() {
  // 如果當前目錄在 /opt 下，就使用當前目錄
  if (PROJECT_DIR.startsWith('/opt/')) {
    return PROJECT_DIR;
  }
  
  // 否則嘗試在 /opt 下尋找可能的安裝目錄
  const possibleDirs = [
    '/opt/project-system',
    '/opt/invoice-bonus-system',
    '/opt/fund-weekly-report'
  ];
  
  for (const dir of possibleDirs) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
  }
  
  return null;
}

// 動態偵測備份目錄
function detectBackupDir(installDir) {
  if (!installDir) {
    // 如果沒有安裝目錄，使用專案目錄下的 backups
    return path.join(PROJECT_DIR, 'backups');
  }
  
  // 根據安裝目錄名稱生成備份目錄名稱
  const installDirName = path.basename(installDir);
  const backupDir = `/opt/${installDirName}-backups`;
  
  // 如果備份目錄存在，就使用它
  if (fs.existsSync(backupDir)) {
    return backupDir;
  }
  
  // 否則檢查其他可能的備份目錄
  const possibleBackupDirs = [
    `/opt/${installDirName}-backups`,
    '/opt/project-system-backups',
    '/opt/invoice-bonus-backups',
    '/opt/fund-weekly-backups'
  ];
  
  for (const dir of possibleBackupDirs) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  
  // 如果都不存在，返回預設的備份目錄路徑（可能需要創建）
  return backupDir;
}

const INSTALL_DIR = detectInstallDir();
const BACKUP_DIR = detectBackupDir(INSTALL_DIR);

// 判斷是否在安裝目錄中運行（函數形式，避免模組載入時的問題）
function isInstalled() {
  return INSTALL_DIR && fs.existsSync(INSTALL_DIR) && fs.existsSync(path.join(INSTALL_DIR, 'package.json'));
}

class BackupRestoreService {
  /**
   * 執行備份
   */
  static async createBackup(operationId = null) {
    const opId = operationId || progressService.generateOperationId();
    
    try {
      // 設置初始進度
      progressService.setProgress(opId, {
        status: 'running',
        operation: 'backup',
        progress: 0,
        message: '準備備份...'
      });

      // 確定備份腳本路徑
      let scriptPath;
      if (isInstalled() && fs.existsSync(path.join(INSTALL_DIR, 'backup.sh'))) {
        scriptPath = path.join(INSTALL_DIR, 'backup.sh');
      } else {
        scriptPath = path.join(PROJECT_DIR, 'backup.sh');
      }
      
      if (!fs.existsSync(scriptPath)) {
        progressService.setProgress(opId, {
          status: 'error',
          operation: 'backup',
          progress: 0,
          message: '找不到備份腳本: ' + scriptPath
        });
        throw new Error('找不到備份腳本: ' + scriptPath);
      }

      progressService.setProgress(opId, {
        status: 'running',
        operation: 'backup',
        progress: 20,
        message: '正在執行備份腳本...'
      });

      // 執行備份腳本（在安裝環境需要 sudo）
      // 使用 spawn 來實時獲取輸出
      const { spawn } = require('child_process');
      
      // 構建環境變數
      const env = { 
        ...process.env, 
        PATH: process.env.PATH,
        NON_INTERACTIVE: '1' // 設置非交互式模式
      };
      
      // 在安裝環境使用 sudo -E 保留環境變數，否則直接執行 bash
      let child;
      if (isInstalled()) {
        // 使用 sudo -E 保留環境變數（包括 NON_INTERACTIVE）
        child = spawn('sudo', ['-E', 'bash', scriptPath], {
          cwd: path.dirname(scriptPath),
          env: env,
          stdio: ['ignore', 'pipe', 'pipe'] // 忽略 stdin，捕獲 stdout 和 stderr
        });
      } else {
        child = spawn('bash', [scriptPath], {
          cwd: path.dirname(scriptPath),
          env: env,
          stdio: ['ignore', 'pipe', 'pipe'] // 忽略 stdin，捕獲 stdout 和 stderr
        });
      }

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log('[備份] 輸出:', output.trim());
        
        // 更新進度（根據輸出判斷，支持多種格式）
        if (output.includes('備份資料庫') || output.includes('資料庫備份')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'backup',
            progress: 40,
            message: '正在備份資料庫...'
          });
        } else if (output.includes('備份上傳檔案') || output.includes('上傳檔案')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'backup',
            progress: 60,
            message: '正在備份上傳檔案...'
          });
        } else if (output.includes('壓縮備份') || output.includes('壓縮')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'backup',
            progress: 80,
            message: '正在壓縮備份檔案...'
          });
        } else if (output.includes('備份完成') || output.includes('完成')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'backup',
            progress: 95,
            message: '備份即將完成...'
          });
        }
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.log('[備份] 錯誤輸出:', output.trim());
      });

      // 設置超時（5分鐘）
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        progressService.setProgress(opId, {
          status: 'error',
          operation: 'backup',
          progress: 0,
          message: '備份操作超時（超過5分鐘）'
        });
      }, 300000);

      // 等待命令完成
      await new Promise((resolve, reject) => {
        child.on('close', (code, signal) => {
          clearTimeout(timeout);
          console.log('[備份] 進程結束，退出碼:', code, '信號:', signal);
          if (code !== 0) {
            const errorMsg = stderr || `備份腳本執行失敗，退出碼: ${code}`;
            console.error('[備份] 錯誤:', errorMsg);
            reject(new Error(errorMsg));
          } else {
            resolve();
          }
        });
        
        child.on('error', (err) => {
          clearTimeout(timeout);
          console.error('[備份] 進程錯誤:', err);
          reject(err);
        });
      });

      progressService.setProgress(opId, {
        status: 'running',
        operation: 'backup',
        progress: 90,
        message: '正在驗證備份檔案...'
      });

      // 從輸出中提取備份檔案名稱
      const backupMatch = stdout.match(/backup_\d{8}_\d{6}\.tar\.gz/) || 
                          stdout.match(/uninstall_backup_\d{8}_\d{6}\.tar\.gz/);
      
      let backupFileName;
      let backupPath;
      
      if (!backupMatch) {
        // 如果無法從輸出提取，列出最新的備份檔案
        const backups = this.listBackups();
        if (backups.length > 0) {
          backupFileName = backups[0].filename;
          backupPath = backups[0].path;
        } else {
          // 等待一下，然後再試一次
          await new Promise(resolve => setTimeout(resolve, 2000));
          const backups2 = this.listBackups();
          if (backups2.length > 0) {
            backupFileName = backups2[0].filename;
            backupPath = backups2[0].path;
          } else {
            throw new Error('無法從備份輸出中提取備份檔案名稱，且找不到新備份檔案');
          }
        }
      } else {
        backupFileName = backupMatch[0];
        backupPath = isInstalled() ? path.join(BACKUP_DIR, backupFileName) : 
                     path.join(PROJECT_DIR, 'backups', backupFileName);
      }

      // 嘗試同步到 NAS（如果已配置）
      let nasSyncResult = null;
      try {
        const NasConfigService = require('./NasConfigService');
        const nasConfig = NasConfigService.getConfig();
        if (nasConfig && nasConfig.enabled && fs.existsSync(backupPath)) {
          console.log('[備份] 開始同步到 NAS...');
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'backup',
            progress: 95,
            message: '正在同步到 NAS...'
          });
          
          // 異步執行 NAS 同步，不阻塞主流程
          NasConfigService.syncToNas(backupPath, opId + '_nas').then(result => {
            console.log('[備份] NAS 同步完成:', result);
          }).catch(err => {
            console.error('[備份] NAS 同步失敗:', err);
            // NAS 同步失敗不影響備份成功
          });
        }
      } catch (nasError) {
        console.warn('[備份] NAS 同步錯誤（不影響備份）:', nasError);
      }

      // 完成
      progressService.setProgress(opId, {
        status: 'completed',
        operation: 'backup',
        progress: 100,
        message: '備份完成',
        result: {
          backupFile: backupFileName,
          backupPath: backupPath
        }
      });

      // 5秒後清除進度
      setTimeout(() => {
        progressService.clearProgress(opId);
      }, 5000);

      return {
        success: true,
        operationId: opId,
        backupFile: backupFileName,
        backupPath: backupPath,
        message: '備份完成'
      };
    } catch (error) {
      console.error('備份失敗:', error);
      progressService.setProgress(opId, {
        status: 'error',
        operation: 'backup',
        progress: 0,
        message: error.message || '備份失敗'
      });
      // 5秒後清除進度
      setTimeout(() => {
        progressService.clearProgress(opId);
      }, 5000);
      return {
        success: false,
        operationId: opId,
        error: error.message || '備份失敗'
      };
    }
  }

  /**
   * 列出所有備份檔案
   */
  static listBackups() {
    try {
      console.log('[BackupRestoreService] 開始列出備份檔案');
      console.log('[BackupRestoreService] INSTALL_DIR:', INSTALL_DIR);
      console.log('[BackupRestoreService] BACKUP_DIR:', BACKUP_DIR);
      console.log('[BackupRestoreService] PROJECT_DIR:', PROJECT_DIR);
      console.log('[BackupRestoreService] isInstalled():', isInstalled());
      
      const backups = [];
      
      // 檢查備份目錄（優先使用 /opt 下的備份目錄）
      const backupDirs = [];
      
      // 如果是在安裝環境，優先使用 /opt 下的備份目錄
      if (isInstalled()) {
        console.log('[BackupRestoreService] 系統已安裝，檢查備份目錄:', BACKUP_DIR);
        if (fs.existsSync(BACKUP_DIR)) {
          backupDirs.push(BACKUP_DIR);
          console.log('[BackupRestoreService] 找到備份目錄:', BACKUP_DIR);
        } else {
          console.log('[BackupRestoreService] 備份目錄不存在，嘗試創建');
          try {
            // 注意：這需要 root 權限，可能失敗
            fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o755 });
            backupDirs.push(BACKUP_DIR);
            console.log('[BackupRestoreService] 成功創建備份目錄');
          } catch (err) {
            console.warn('[BackupRestoreService] 無法創建備份目錄:', err.message);
          }
        }
      }
      
      // 也檢查專案目錄下的備份目錄（開發環境或舊備份）
      const projectBackupDir = path.join(PROJECT_DIR, 'backups');
      console.log('[BackupRestoreService] 檢查專案備份目錄:', projectBackupDir);
      if (fs.existsSync(projectBackupDir)) {
        backupDirs.push(projectBackupDir);
        console.log('[BackupRestoreService] 找到專案備份目錄');
      }

      for (const backupDir of backupDirs) {
        try {
          if (!fs.existsSync(backupDir)) {
            continue;
          }

          const files = fs.readdirSync(backupDir);
          for (const file of files) {
            if (file.match(/^(backup_|uninstall_backup_).*\.tar\.gz$/)) {
              const filePath = path.join(backupDir, file);
              try {
                const stats = fs.statSync(filePath);
                backups.push({
                  filename: file,
                  path: filePath,
                  size: stats.size,
                  sizeFormatted: this.formatFileSize(stats.size),
                  created: stats.birthtime || stats.mtime,
                  modified: stats.mtime
                });
              } catch (statErr) {
                console.warn('無法讀取備份檔案資訊:', filePath, statErr.message);
              }
            }
          }
        } catch (readErr) {
          console.warn('讀取備份目錄失敗:', backupDir, readErr.message);
        }
      }

      // 按建立時間排序（最新的在前）
      backups.sort((a, b) => b.created - a.created);

      console.log('[BackupRestoreService] 找到', backups.length, '個備份檔案');
      return backups;
    } catch (error) {
      console.error('[BackupRestoreService] 列出備份失敗:', error);
      console.error('[BackupRestoreService] 錯誤堆疊:', error.stack);
      return [];
    }
  }

  /**
   * 執行還原
   */
  static async restoreBackup(backupFileName, operationId = null) {
    const opId = operationId || progressService.generateOperationId();
    
    try {
      // 設置初始進度
      progressService.setProgress(opId, {
        status: 'running',
        operation: 'restore',
        progress: 0,
        message: '準備還原...'
      });

      // 確定還原腳本路徑
      let scriptPath;
      if (isInstalled() && fs.existsSync(path.join(INSTALL_DIR, 'restore.sh'))) {
        scriptPath = path.join(INSTALL_DIR, 'restore.sh');
      } else {
        scriptPath = path.join(PROJECT_DIR, 'restore.sh');
      }
      
      if (!fs.existsSync(scriptPath)) {
        progressService.setProgress(opId, {
          status: 'error',
          operation: 'restore',
          progress: 0,
          message: '找不到還原腳本: ' + scriptPath
        });
        throw new Error('找不到還原腳本: ' + scriptPath);
      }

      // 檢查備份檔案是否存在（檢查多個可能的位置）
      let backupPath = null;
      
      // 優先檢查 /opt/invoice-bonus-backups
      if (isInstalled() && fs.existsSync(BACKUP_DIR)) {
        const testPath = path.join(BACKUP_DIR, backupFileName);
        if (fs.existsSync(testPath)) {
          backupPath = testPath;
        }
      }
      
      // 如果沒找到，檢查專案目錄下的備份目錄
      if (!backupPath) {
        const testPath = path.join(PROJECT_DIR, 'backups', backupFileName);
        if (fs.existsSync(testPath)) {
          backupPath = testPath;
        }
      }
      
      // 如果還是沒找到，報錯
      if (!backupPath) {
        const errorMsg = `找不到備份檔案: ${backupFileName}。已檢查以下位置：\n- ${BACKUP_DIR}\n- ${path.join(PROJECT_DIR, 'backups')}`;
        progressService.setProgress(opId, {
          status: 'error',
          operation: 'restore',
          progress: 0,
          message: errorMsg
        });
        throw new Error(errorMsg);
      }
      
      console.log('[還原] 找到備份檔案，完整路徑:', backupPath);

      progressService.setProgress(opId, {
        status: 'running',
        operation: 'restore',
        progress: 20,
        message: '正在解壓備份檔案...'
      });

      // 使用 spawn 來實時獲取輸出
      const { spawn } = require('child_process');
      
      // 確定執行命令和參數
      // 傳遞完整的備份檔案路徑給 restore.sh，而不是只傳遞檔名
      // 這樣可以避免路徑不一致的問題
      let command, args, cwd;
      if (isInstalled()) {
        // 在安裝環境中，使用 sudo -E 執行腳本（-E 保留環境變數）
        // 傳遞完整的絕對路徑
        command = 'sudo';
        args = ['-E', scriptPath, backupPath];
        cwd = path.dirname(scriptPath);
      } else {
        // 在開發環境中，直接使用 bash 執行
        command = 'bash';
        args = [scriptPath, backupPath];
        cwd = path.dirname(scriptPath);
      }
      
      console.log('[還原] ========== 還原操作開始 ==========');
      console.log('[還原] 執行命令:', command, args.join(' '));
      console.log('[還原] 工作目錄:', cwd);
      console.log('[還原] 備份檔案名稱:', backupFileName);
      console.log('[還原] 腳本路徑:', scriptPath);
      console.log('[還原] 備份檔案完整路徑:', backupPath);
      console.log('[還原] 是否已安裝:', isInstalled());
      console.log('[還原] 操作ID:', opId);
      
      // 暫停自動保存，避免在還原過程中覆蓋資料庫檔案
      const db = require('../models/db');
      if (db && typeof db.pauseAutoSave === 'function') {
        console.log('[還原] 暫停資料庫自動保存...');
        db.pauseAutoSave();
      }
      
      const child = spawn(command, args, {
        cwd: cwd,
        env: { 
          ...process.env, 
          PATH: process.env.PATH,
          NON_INTERACTIVE: '1', // 設置非交互式模式，跳過確認提示
          // 確保 sudo 不會要求密碼（需要配置 sudoers）
          SUDO_ASKPASS: '/bin/false',
          // 傳遞備份檔案路徑（如果腳本需要）
          BACKUP_FILE: backupPath || backupFileName
        },
        stdio: ['ignore', 'pipe', 'pipe'] // 忽略 stdin，捕獲 stdout 和 stderr
      });

      let stdout = '';
      let stderr = '';

      // 設置超時（5分鐘）
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        progressService.setProgress(opId, {
          status: 'error',
          operation: 'restore',
          progress: 0,
          message: '還原操作超時（超過5分鐘）'
        });
      }, 300000);

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log('[還原] 輸出:', output.trim());
        
        // 更新進度（根據輸出判斷）
        if (output.includes('解壓備份檔案') || output.includes('解壓備份檔案...')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'restore',
            progress: 30,
            message: '正在解壓備份檔案...'
          });
        } else if (output.includes('還原資料庫') || output.includes('還原資料庫...')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'restore',
            progress: 50,
            message: '正在還原資料庫...'
          });
        } else if (output.includes('資料庫還原完成')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'restore',
            progress: 60,
            message: '資料庫還原完成，正在還原上傳檔案...'
          });
        } else if (output.includes('還原上傳檔案') || output.includes('還原上傳檔案...')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'restore',
            progress: 70,
            message: '正在還原上傳檔案...'
          });
        } else if (output.includes('進行最終驗證') || output.includes('最終驗證')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'restore',
            progress: 90,
            message: '正在驗證還原結果...'
          });
        } else if (output.includes('還原完成') || output.includes('還原完成！')) {
          progressService.setProgress(opId, {
            status: 'running',
            operation: 'restore',
            progress: 95,
            message: '還原完成，正在清理...'
          });
        }
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.log('[還原] 錯誤輸出:', output.trim());
        
        // 如果看到 sudo 相關錯誤，記錄詳細資訊
        if (output.includes('sudo') || output.includes('password') || output.includes('permission denied')) {
          console.error('[還原] 權限錯誤，可能需要配置 sudoers');
          console.error('[還原] 建議執行: sudo visudo');
          console.error('[還原] 添加: <service_user> ALL=(ALL) NOPASSWD: /opt/invoice-bonus-system/restore.sh');
        }
      });

      // 等待命令完成
      await new Promise((resolve, reject) => {
        child.on('close', (code, signal) => {
          clearTimeout(timeout);
          console.log('[還原] 進程結束，退出碼:', code, '信號:', signal);
          console.log('[還原] 標準輸出:', stdout.substring(0, 1000)); // 只顯示前1000字符
          console.log('[還原] 錯誤輸出:', stderr.substring(0, 1000)); // 只顯示前1000字符
          
          if (code !== 0) {
            // 構建詳細的錯誤訊息
            let errorMsg = `還原腳本執行失敗，退出碼: ${code}`;
            if (stderr) {
              errorMsg += `\n錯誤輸出: ${stderr}`;
            }
            if (stdout) {
              // 從輸出中提取關鍵錯誤訊息
              const errorLines = stdout.split('\n').filter(line => 
                line.includes('錯誤') || 
                line.includes('錯誤') || 
                line.includes('失敗') || 
                line.includes('error') || 
                line.includes('Error') ||
                line.includes('permission denied') ||
                line.includes('sudo')
              );
              if (errorLines.length > 0) {
                errorMsg += `\n關鍵錯誤: ${errorLines.join('\n')}`;
              }
            }
            console.error('[還原] 完整錯誤訊息:', errorMsg);
            reject(new Error(errorMsg));
          } else {
            console.log('[還原] 腳本執行成功');
            resolve();
          }
        });
        
        child.on('error', (err) => {
          clearTimeout(timeout);
          console.error('[還原] 進程錯誤:', err);
          console.error('[還原] 錯誤堆疊:', err.stack);
          reject(err);
        });
      });

      // 驗證還原是否成功
      console.log('[還原] 驗證還原結果...');
      const dbPath = isInstalled() ? path.join(INSTALL_DIR, 'data', 'invoice_bonus.db') : 
                     path.join(PROJECT_DIR, 'data', 'invoice_bonus.db');
      
      console.log('[還原] 資料庫路徑:', dbPath);
      console.log('[還原] 資料庫檔案是否存在:', fs.existsSync(dbPath));
      
      // 等待一下，確保檔案已完全寫入
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      if (fs.existsSync(dbPath)) {
        const dbStats = fs.statSync(dbPath);
        console.log('[還原] 資料庫檔案存在，大小:', dbStats.size, 'bytes');
        console.log('[還原] 資料庫檔案修改時間:', dbStats.mtime);
        
        if (dbStats.size === 0) {
          const errorMsg = '資料庫檔案大小為 0，還原可能失敗。請檢查還原腳本輸出和系統日誌。';
          console.error('[還原]', errorMsg);
          throw new Error(errorMsg);
        }
        
        // 嘗試使用 sqlite3 驗證資料庫（如果可用）
        try {
          const { execSync } = require('child_process');
          if (isInstalled()) {
            const tableCount = execSync(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"`, { encoding: 'utf8' }).trim();
            const projectCount = execSync(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM projects;"`, { encoding: 'utf8' }).trim();
            console.log('[還原] 資料庫驗證: 資料表數量:', tableCount, '專案數量:', projectCount);
            
            if (tableCount === '0') {
              throw new Error('資料庫檔案存在但沒有資料表，可能損壞或備份檔案有問題');
            }
          }
        } catch (sqliteError) {
          // sqlite3 可能不可用，只記錄警告
          console.warn('[還原] 無法使用 sqlite3 驗證資料庫:', sqliteError.message);
        }
        
        // 重新載入資料庫（不重啟服務，保持網頁介面可用）
        try {
          console.log('[還原] 重新載入資料庫連接...');
          if (db && typeof db.reload === 'function') {
            await db.reload();
            console.log('[還原] 資料庫已重新載入');
          } else {
            console.warn('[還原] 資料庫模組不支援重新載入，請手動重新載入頁面');
          }
          
          // 恢復自動保存
          if (db && typeof db.resumeAutoSave === 'function') {
            console.log('[還原] 恢復資料庫自動保存...');
            db.resumeAutoSave();
          }
        } catch (reloadError) {
          console.warn('[還原] 重新載入資料庫時發生錯誤:', reloadError.message);
          console.warn('[還原] 請手動重新載入頁面以載入新的資料庫');
          
          // 即使出錯也要恢復自動保存
          if (db && typeof db.resumeAutoSave === 'function') {
            console.log('[還原] 恢復資料庫自動保存...');
            db.resumeAutoSave();
          }
        }
      } else {
        const errorMsg = `資料庫檔案不存在: ${dbPath}。還原可能失敗，請檢查還原腳本輸出和系統日誌。`;
        console.error('[還原]', errorMsg);
        throw new Error(errorMsg);
      }

      // 完成
      progressService.setProgress(opId, {
        status: 'completed',
        operation: 'restore',
        progress: 100,
        message: '還原完成，資料已驗證',
        result: {
          backupFile: backupFileName
        }
      });

      // 5秒後清除進度
      setTimeout(() => {
        progressService.clearProgress(opId);
      }, 5000);

      return {
        success: true,
        operationId: opId,
        message: '還原完成',
        output: stdout
      };
    } catch (error) {
      console.error('[還原] 還原失敗:', error);
      console.error('[還原] 錯誤堆疊:', error.stack);
      
      // 確保恢復自動保存（即使出錯）
      try {
        const db = require('../models/db');
        if (db && typeof db.resumeAutoSave === 'function') {
          console.log('[還原] 恢復資料庫自動保存（錯誤恢復）...');
          db.resumeAutoSave();
        }
      } catch (resumeError) {
        console.warn('[還原] 恢復自動保存時發生錯誤:', resumeError.message);
      }
      
      // 構建詳細的錯誤訊息
      let errorMessage = error.message || '還原失敗';
      
      // 如果是權限相關錯誤，提供更詳細的建議
      if (error.message && (
        error.message.includes('sudo') || 
        error.message.includes('permission') || 
        error.message.includes('權限')
      )) {
        errorMessage += '\n\n建議：\n1. 檢查服務運行的用戶是否有 sudo 權限\n2. 配置 sudoers 允許無密碼執行 restore.sh\n3. 執行: sudo visudo\n4. 添加: <service_user> ALL=(ALL) NOPASSWD: /opt/invoice-bonus-system/restore.sh';
      }
      
      progressService.setProgress(opId, {
        status: 'error',
        operation: 'restore',
        progress: 0,
        message: errorMessage
      });
      
      // 10秒後清除進度（給用戶更多時間看到錯誤訊息）
      setTimeout(() => {
        progressService.clearProgress(opId);
      }, 10000);
      
      // 重新拋出錯誤，讓調用者可以處理
      throw error;
    }
  }

  /**
   * 刪除備份檔案
   */
  static async deleteBackup(backupFileName) {
    try {
      // 查找備份檔案
      let backupPath = null;
      if (isInstalled() && fs.existsSync(BACKUP_DIR)) {
        backupPath = path.join(BACKUP_DIR, backupFileName);
      }
      
      if (!backupPath || !fs.existsSync(backupPath)) {
        // 嘗試在專案目錄下的備份目錄查找
        backupPath = path.join(PROJECT_DIR, 'backups', backupFileName);
        if (!fs.existsSync(backupPath)) {
          throw new Error('找不到備份檔案: ' + backupFileName);
        }
        // 開發環境直接刪除
        fs.unlinkSync(backupPath);
        return { success: true };
      }

      // 安裝環境需要 root 權限刪除
      if (isInstalled()) {
        await execAsync(`sudo rm -f "${backupPath}"`);
      } else {
        fs.unlinkSync(backupPath);
      }

      return { success: true };
    } catch (error) {
      console.error('刪除備份失敗:', error);
      return {
        success: false,
        error: error.message || '刪除備份失敗'
      };
    }
  }

  /**
   * 格式化檔案大小
   */
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * 生成操作 ID（靜態方法，供路由使用）
   */
  static generateOperationId() {
    return progressService.generateOperationId();
  }

  /**
   * 獲取備份目錄路徑（靜態方法，供路由使用）
   */
  static getBackupDir() {
    return BACKUP_DIR;
  }

  /**
   * 獲取安裝目錄路徑（靜態方法，供路由使用）
   */
  static getInstallDir() {
    return INSTALL_DIR;
  }
}

module.exports = BackupRestoreService;


