// Express 4 不會處理 async 路由 handler 丟出的錯誤（Promise rejection）：請求會一直卡住直到逾時，
// 且錯誤只會變成 unhandledRejection。這裡在載入路由之前，把 Route 的 handler 包一層：
// 回傳 Promise 的 handler 若 reject，自動交給 next(err)，由全域錯誤處理回應 500。
// 只包「一般 handler」（參數個數 < 4）；錯誤處理 middleware（4 個參數）與子 Router 不動。
const express = require('express');

let patched = false;

function wrap(fn) {
  if (typeof fn !== 'function' || fn.length >= 4 || typeof fn.handle === 'function') return fn;
  const wrapped = function (req, res, next) {
    let result;
    try {
      result = fn.call(this, req, res, next);
    } catch (err) {
      return next(err);
    }
    if (result && typeof result.catch === 'function') {
      result.catch(next);
    }
    return result;
  };
  // 保留原本的參數個數，避免 Express 誤判成錯誤處理 middleware
  Object.defineProperty(wrapped, 'length', { value: fn.length });
  return wrapped;
}

function patchAsyncRoutes() {
  if (patched) return;
  patched = true;
  const methods = require('http').METHODS.map(m => m.toLowerCase()).concat('all');
  methods.forEach((method) => {
    const original = express.Route.prototype[method];
    if (!original) return;
    express.Route.prototype[method] = function (...handlers) {
      const flat = handlers.flat(Infinity).map(wrap);
      return original.apply(this, flat);
    };
  });
}

module.exports = patchAsyncRoutes;
