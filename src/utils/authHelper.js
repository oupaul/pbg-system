/**
 * 獲取用戶資訊用於審計日誌
 * @param {Object} req - Express 請求對象
 * @returns {string} 用戶名稱或 'system'
 */
function getUserInfo(req) {
  if (req.user && req.user.name) {
    return req.user.name;
  }
  if (req.user && req.user.username) {
    return req.user.username;
  }
  if (req.session && req.session.user && req.session.user.name) {
    return req.session.user.name;
  }
  if (req.session && req.session.user && req.session.user.username) {
    return req.session.user.username;
  }
  return 'system';
}

module.exports = {
  getUserInfo
};

