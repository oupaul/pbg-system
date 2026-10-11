jest.mock('../src/services/BackupProgressService', () => ({}));
const BackupRestoreService = require('../src/services/BackupRestoreService');

describe('備份檔名白名單', () => {
  test.each(['backup_20260101_120000.tar.gz', 'uninstall_backup_20260101_120000.tar.gz'])('接受 %s', (name) => {
    expect(BackupRestoreService.isValidBackupFileName(name)).toBe(true);
  });
  test.each([
    '../../etc/passwd', '../backup_1.tar.gz', 'backup_1/../../x.tar.gz', 'backup_1.tar.gz; rm -rf /',
    'backup_1.tar.gz"', 'evil.tar.gz', 'backup_.tar', '', null, undefined, 'backup_..tar.gz/x',
  ])('拒絕 %p', (name) => {
    expect(BackupRestoreService.isValidBackupFileName(name)).toBe(false);
  });
});
