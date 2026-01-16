const fs = require('fs');
const path = require('path');

/**
 * 讀取部署配置文件（JSON 格式）
 * 如果配置文件不存在，返回預設值
 */
function loadDeployConfig() {
  const configPath = path.join(__dirname, '..', '..', 'deploy.config.json');
  const defaultConfig = {
    pageTitleSuffix: '業績獎金系統',
    siteName: '業績獎金系統',
    footerText: '專案開立發票業績認列獎金計算總表系統 ©',
    port: process.env.PORT || 3000,
    serviceName: 'invoice-bonus-system',
    installDirName: 'invoice-bonus-system',
    backupDirName: 'invoice-bonus-backups'
  };

  // 如果配置文件不存在，返回預設值
  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    // 讀取 JSON 配置文件
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    // 合併配置，確保所有必要的欄位都存在
    return {
      pageTitleSuffix: config.pageTitleSuffix || defaultConfig.pageTitleSuffix,
      siteName: config.siteName || defaultConfig.siteName,
      footerText: config.footerText || defaultConfig.footerText,
      port: config.port || defaultConfig.port,
      serviceName: config.serviceName || defaultConfig.serviceName,
      installDirName: config.installDirName || defaultConfig.installDirName,
      backupDirName: config.backupDirName || defaultConfig.backupDirName
    };
  } catch (err) {
    console.warn('[配置] 讀取部署配置文件失敗，使用預設值:', err.message);
    return defaultConfig;
  }
}

module.exports = loadDeployConfig();
