// 備份還原進度追蹤服務
// 使用內存存儲進度狀態（重啟後會丟失，但對於短期操作足夠）

class BackupProgressService {
  constructor() {
    this.progress = {};
  }

  /**
   * 設置進度
   */
  setProgress(operationId, progress) {
    this.progress[operationId] = {
      ...progress,
      updatedAt: new Date()
    };
  }

  /**
   * 獲取進度
   */
  getProgress(operationId) {
    return this.progress[operationId] || null;
  }

  /**
   * 清除進度（操作完成後）
   */
  clearProgress(operationId) {
    delete this.progress[operationId];
  }

  /**
   * 生成操作 ID
   */
  generateOperationId() {
    return 'op_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}

// 使用單例模式
const progressService = new BackupProgressService();

module.exports = progressService;


