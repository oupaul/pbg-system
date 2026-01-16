const fs = require('fs');
const path = require('path');

const INSTALL_DIR = '/opt/invoice-bonus-system';
const PROJECT_DIR = process.cwd();

// 判斷是否在安裝目錄中運行
function isInstalled() {
  return fs.existsSync(INSTALL_DIR) && fs.existsSync(path.join(INSTALL_DIR, 'package.json'));
}

// 設定檔案路徑
function getConfigPath() {
  const configDir = isInstalled() ? INSTALL_DIR : PROJECT_DIR;
  return path.join(configDir, 'nas_config.json');
}

class NasConfigService {
  /**
   * 獲取 NAS 設定
   */
  static getConfig() {
    try {
      const configPath = getConfigPath();
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
      }
      return null;
    } catch (error) {
      console.error('[NasConfigService] 讀取設定失敗:', error);
      return null;
    }
  }

  /**
   * 保存 NAS 設定
   */
  static saveConfig(config) {
    try {
      const configPath = getConfigPath();
      const configDir = path.dirname(configPath);
      
      // 確保目錄存在
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // 驗證設定
      if (!config.host || !config.path) {
        throw new Error('NAS 主機和路徑為必填項');
      }
      
      // 保存設定（不保存密碼到檔案，使用環境變數或加密）
      const configToSave = {
        enabled: config.enabled || false,
        host: config.host,
        port: config.port || 22,
        username: config.username,
        path: config.path,
        protocol: config.protocol || 'rsync', // rsync 或 scp
        // 注意：密碼不保存在檔案中，需要通過環境變數或 SSH key 認證
      };
      
      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf8');
      console.log('[NasConfigService] 設定已保存:', configPath);
      
      return { success: true };
    } catch (error) {
      console.error('[NasConfigService] 保存設定失敗:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 測試 NAS 連接
   */
  static async testConnection(config) {
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      try {
        if (config.protocol === 'rsync') {
          // 測試 rsync 連接
          const testCommand = ['rsync', '--version'];
          const child = spawn('rsync', testCommand, {
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          child.on('close', (code) => {
            if (code === 0) {
              resolve({ success: true, message: 'rsync 可用' });
            } else {
              resolve({ success: false, message: 'rsync 不可用，請安裝 rsync' });
            }
          });
          
          child.on('error', (err) => {
            resolve({ success: false, message: 'rsync 未安裝: ' + err.message });
          });
        } else {
          // 測試 SSH/SCP 連接
          const testCommand = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 
                              `${config.username}@${config.host}`, 'echo', 'test'];
          const child = spawn('ssh', testCommand, {
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          let stdout = '';
          let stderr = '';
          
          child.stdout.on('data', (data) => {
            stdout += data.toString();
          });
          
          child.stderr.on('data', (data) => {
            stderr += data.toString();
          });
          
          child.on('close', (code) => {
            if (code === 0) {
              resolve({ success: true, message: 'SSH 連接成功' });
            } else {
              resolve({ 
                success: false, 
                message: 'SSH 連接失敗，請確認：\n1. SSH key 已配置\n2. 主機地址和用戶名正確\n3. 網路連接正常' 
              });
            }
          });
          
          child.on('error', (err) => {
            resolve({ success: false, message: 'SSH 未安裝或配置錯誤: ' + err.message });
          });
        }
      } catch (error) {
        resolve({ success: false, message: '測試失敗: ' + error.message });
      }
    });
  }

  /**
   * 同步備份到 NAS
   */
  static async syncToNas(backupFilePath, operationId = null) {
    const progressService = require('./BackupProgressService');
    const opId = operationId || 'nas_sync_' + Date.now();
    
    try {
      const config = this.getConfig();
      if (!config || !config.enabled) {
        console.log('[NasConfigService] NAS 備份未啟用，跳過');
        return { success: true, skipped: true };
      }

      if (!fs.existsSync(backupFilePath)) {
        throw new Error('備份檔案不存在: ' + backupFilePath);
      }

      const backupFileName = path.basename(backupFilePath);
      
      if (progressService) {
        progressService.setProgress(opId, {
          status: 'running',
          operation: 'nas_sync',
          progress: 0,
          message: '開始同步到 NAS...'
        });
      }

      const { spawn } = require('child_process');
      
      return new Promise((resolve, reject) => {
        let command, args;
        
        if (config.protocol === 'rsync') {
          // 使用 rsync
          command = 'rsync';
          args = [
            '-avz',
            '--progress',
            backupFilePath,
            `${config.username}@${config.host}:${config.path}/`
          ];
        } else {
          // 使用 scp
          command = 'scp';
          args = [
            '-P', config.port.toString(),
            backupFilePath,
            `${config.username}@${config.host}:${config.path}/${backupFileName}`
          ];
        }

        console.log('[NasConfigService] 執行命令:', command, args.join(' '));
        
        const child = spawn(command, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log('[NasConfigService] 輸出:', data.toString().trim());
          
          // 更新進度（rsync 有進度輸出）
          if (data.toString().includes('%')) {
            const match = data.toString().match(/(\d+)%/);
            if (match && progressService) {
              const percent = parseInt(match[1]);
              progressService.setProgress(opId, {
                status: 'running',
                operation: 'nas_sync',
                progress: percent,
                message: `同步中... ${percent}%`
              });
            }
          }
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('[NasConfigService] 錯誤輸出:', data.toString().trim());
        });

        child.on('close', (code) => {
          if (code === 0) {
            console.log('[NasConfigService] NAS 同步成功');
            if (progressService) {
              progressService.setProgress(opId, {
                status: 'completed',
                operation: 'nas_sync',
                progress: 100,
                message: 'NAS 同步完成'
              });
            }
            resolve({ success: true, message: 'NAS 同步完成' });
          } else {
            const errorMsg = `NAS 同步失敗 (退出碼: ${code})\n${stderr}`;
            console.error('[NasConfigService]', errorMsg);
            if (progressService) {
              progressService.setProgress(opId, {
                status: 'error',
                operation: 'nas_sync',
                progress: 0,
                message: errorMsg
              });
            }
            reject(new Error(errorMsg));
          }
        });

        child.on('error', (err) => {
          const errorMsg = 'NAS 同步錯誤: ' + err.message;
          console.error('[NasConfigService]', errorMsg);
          if (progressService) {
            progressService.setProgress(opId, {
              status: 'error',
              operation: 'nas_sync',
              progress: 0,
              message: errorMsg
            });
          }
          reject(new Error(errorMsg));
        });
      });
    } catch (error) {
      console.error('[NasConfigService] 同步失敗:', error);
      if (progressService) {
        progressService.setProgress(opId, {
          status: 'error',
          operation: 'nas_sync',
          progress: 0,
          message: error.message
        });
      }
      throw error;
    }
  }
}

module.exports = NasConfigService;


