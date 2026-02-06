// 專案開立發票業績認列獎金計算總表系統 - 前端腳本

document.addEventListener('DOMContentLoaded', function() {
  // 初始化 Select2 下拉選單（使用 jQuery）
  if (typeof $ !== 'undefined' && typeof $.fn.select2 !== 'undefined') {
    // 自動初始化所有帶有 select2-dropdown class 的 select
    $('.select2-dropdown').each(function() {
      const $select = $(this);
      const placeholder = $select.find('option[value=""]').text() || '請選擇...';
      
      $select.select2({
        theme: 'bootstrap-5',
        placeholder: placeholder,
        allowClear: true,
        width: '100%',
        language: {
          noResults: function() {
            return '找不到符合的選項';
          },
          searching: function() {
            return '搜尋中...';
          }
        }
      });
    });
    
    console.log('[Select2] 已初始化', $('.select2-dropdown').length, '個下拉選單');
  } else {
    console.warn('[Select2] jQuery 或 Select2 未載入');
  }
  
  // 自動計算未稅金額
  const priceWithTax = document.querySelector('input[name="price_with_tax"]');
  const priceWithoutTax = document.querySelector('input[name="price_without_tax"]');
  
  if (priceWithTax && priceWithoutTax) {
    priceWithTax.addEventListener('input', function() {
      const withTax = parseFloat(this.value) || 0;
      const withoutTax = Math.round(withTax / 1.05);
      priceWithoutTax.value = withoutTax;
    });
  }

  // 確認刪除
  document.querySelectorAll('[data-confirm]').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (!confirm(this.dataset.confirm || '確定要執行此操作？')) {
        e.preventDefault();
        return false;
      }
    });
  });

  // 表單提交時顯示載入狀態（排除登入表單，避免還原後若後端無回應時卡住）
  document.querySelectorAll('form').forEach(function(form) {
    if (form.action && form.action.includes('/login')) {
      return; // 登入表單使用獨立處理
    }
    form.addEventListener('submit', function(e) {
      const btn = this.querySelector('button[type="submit"]');
      if (btn && !btn.disabled) {
        btn.disabled = true;
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 處理中...';
        btn.setAttribute('data-original-text', originalText);
      }
    });
  });

  // 數字格式化
  document.querySelectorAll('[data-format="currency"]').forEach(function(el) {
    const value = parseFloat(el.textContent);
    if (!isNaN(value)) {
      el.textContent = '$' + value.toLocaleString();
    }
  });

  // 複製功能
  document.querySelectorAll('[data-copy]').forEach(function(el) {
    el.style.cursor = 'pointer';
    el.title = '點擊複製';
    el.addEventListener('click', function() {
      navigator.clipboard.writeText(this.textContent).then(function() {
        showToast('已複製到剪貼簿');
      });
    });
  });

  // 搜尋框自動聚焦
  const searchInput = document.querySelector('input[name="customer"], input[name="q"]');
  if (searchInput && !searchInput.value) {
    // searchInput.focus();
  }

  // 表格排序
  document.querySelectorAll('th[data-sort]').forEach(function(th) {
    th.style.cursor = 'pointer';
    th.addEventListener('click', function() {
      const table = this.closest('table');
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const col = Array.from(this.parentElement.children).indexOf(this);
      const isNumeric = this.dataset.sort === 'number';
      const isAsc = this.classList.contains('sort-asc');

      rows.sort(function(a, b) {
        const aVal = a.children[col].textContent.replace(/[$,]/g, '');
        const bVal = b.children[col].textContent.replace(/[$,]/g, '');
        
        if (isNumeric) {
          return isAsc ? parseFloat(bVal) - parseFloat(aVal) : parseFloat(aVal) - parseFloat(bVal);
        }
        return isAsc ? bVal.localeCompare(aVal, 'zh-TW') : aVal.localeCompare(bVal, 'zh-TW');
      });

      // 更新排序指示
      th.parentElement.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(isAsc ? 'sort-desc' : 'sort-asc');

      // 重新排列
      rows.forEach(row => tbody.appendChild(row));
    });
  });

  // 批次選取
  const selectAll = document.querySelector('#selectAll');
  if (selectAll) {
    selectAll.addEventListener('change', function() {
      document.querySelectorAll('input[name="ids[]"]').forEach(function(cb) {
        cb.checked = selectAll.checked;
      });
    });
  }

  // 日期選擇器預設值
  document.querySelectorAll('input[type="date"]').forEach(function(input) {
    if (!input.value && !input.dataset.noDefault) {
      input.value = new Date().toISOString().split('T')[0];
    }
  });

  // Tooltip 初始化
  if (typeof bootstrap !== 'undefined') {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (el) {
      return new bootstrap.Tooltip(el);
    });
  }
});

// Toast 提示
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast align-items-center text-white bg-${type} border-0 position-fixed bottom-0 end-0 m-3`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>
  `;
  document.body.appendChild(toast);
  
  const bsToast = new bootstrap.Toast(toast);
  bsToast.show();
  
  toast.addEventListener('hidden.bs.toast', function() {
    toast.remove();
  });
}

// API 請求封裝
async function api(endpoint, options = {}) {
  const response = await fetch('/api' + endpoint, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  return response.json();
}

// 格式化金額
function formatCurrency(num) {
  if (num === null || num === undefined) return '-';
  return '$' + Number(num).toLocaleString();
}

// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-TW');
}

// ========================================
// 使用者閒置自動登出功能
// ========================================

(function() {
  // 只在已登入的頁面執行（檢查是否有使用者選單）
  if (!document.querySelector('#userDropdown')) {
    return;
  }

  // 從伺服器配置讀取參數，如果不存在則使用預設值
  const idleTimeoutMinutes = (window.idleConfig && window.idleConfig.timeoutMinutes) || 30;
  const idleWarningMinutes = (window.idleConfig && window.idleConfig.warningMinutes) || 2;

  // 如果閒置時間為 0，則停用閒置登出功能
  if (idleTimeoutMinutes === 0) {
    console.log('[閒置檢測] 已停用（閒置時間設定為 0）');
    return;
  }

  // 配置參數（轉換為毫秒）
  const IDLE_TIMEOUT = idleTimeoutMinutes * 60 * 1000;
  const WARNING_TIME = idleWarningMinutes * 60 * 1000;
  
  let idleTimer = null;
  let warningTimer = null;
  let countdownInterval = null;
  let warningShown = false;

  // 重置閒置計時器
  function resetIdleTimer() {
    // 清除現有計時器
    if (idleTimer) clearTimeout(idleTimer);
    if (warningTimer) clearTimeout(warningTimer);
    
    // 如果警告已顯示，關閉它
    if (warningShown) {
      hideWarning();
    }

    // 設置警告計時器（閒置時間 - 警告時間）
    warningTimer = setTimeout(showWarning, IDLE_TIMEOUT - WARNING_TIME);
    
    // 設置登出計時器
    idleTimer = setTimeout(autoLogout, IDLE_TIMEOUT);
  }

  // 顯示警告對話框
  function showWarning() {
    if (warningShown) return;
    warningShown = true;

    // 創建警告對話框
    const modalHtml = `
      <div class="modal fade" id="idleWarningModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header bg-warning text-dark">
              <h5 class="modal-title">
                <i class="bi bi-exclamation-triangle-fill"></i> 閒置警告
              </h5>
            </div>
            <div class="modal-body text-center">
              <p class="mb-3">您已閒置一段時間，系統將在 <strong id="countdown">${Math.floor(WARNING_TIME / 1000)}</strong> 秒後自動登出。</p>
              <p class="text-muted small">為了保護您的帳戶安全，請點擊「繼續使用」以延長會話時間。</p>
            </div>
            <div class="modal-footer justify-content-center">
              <button type="button" class="btn btn-primary" id="extendSession">
                <i class="bi bi-clock-history"></i> 繼續使用
              </button>
              <button type="button" class="btn btn-secondary" id="logoutNow">
                <i class="bi bi-box-arrow-right"></i> 立即登出
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 添加到頁面
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 顯示對話框
    const modal = new bootstrap.Modal(document.getElementById('idleWarningModal'));
    modal.show();

    // 倒數計時
    let remainingSeconds = WARNING_TIME / 1000;
    const countdownElement = document.getElementById('countdown');
    
    countdownInterval = setInterval(() => {
      remainingSeconds--;
      if (countdownElement) {
        countdownElement.textContent = remainingSeconds;
      }
      if (remainingSeconds <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);

    // 繼續使用按鈕
    document.getElementById('extendSession').addEventListener('click', () => {
      modal.hide();
      hideWarning();
      resetIdleTimer();
      showToast('會話時間已延長', 'success');
    });

    // 立即登出按鈕
    document.getElementById('logoutNow').addEventListener('click', () => {
      performLogout();
    });
  }

  // 隱藏警告對話框
  function hideWarning() {
    warningShown = false;
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    
    const modalElement = document.getElementById('idleWarningModal');
    if (modalElement) {
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) {
        modal.hide();
      }
      // 延遲移除，等待動畫完成
      setTimeout(() => {
        modalElement.remove();
        // 移除 backdrop
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      }, 300);
    }
  }

  // 自動登出
  function autoLogout() {
    hideWarning();
    showToast('由於長時間未操作，您已被自動登出', 'warning');
    setTimeout(() => {
      performLogout();
    }, 1000);
  }

  // 執行登出
  function performLogout() {
    // 創建隱藏表單提交登出請求
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/logout';
    document.body.appendChild(form);
    form.submit();
  }

  // 監聽使用者活動事件
  const activityEvents = [
    'mousedown',
    'mousemove',
    'keypress',
    'scroll',
    'touchstart',
    'click'
  ];

  // 節流函數，避免過度觸發
  let lastActivity = Date.now();
  function throttledResetTimer() {
    const now = Date.now();
    // 只在距離上次重置超過 1 秒時才重置（避免過度計算）
    if (now - lastActivity > 1000) {
      lastActivity = now;
      resetIdleTimer();
    }
  }

  // 綁定事件監聽器
  activityEvents.forEach(event => {
    document.addEventListener(event, throttledResetTimer, true);
  });

  // 初始化計時器
  resetIdleTimer();

  // 控制台輸出（開發時可用）
  console.log('[閒置檢測] 已啟用');
  console.log('[閒置檢測] 閒置時間:', idleTimeoutMinutes, '分鐘');
  console.log('[閒置檢測] 警告時間:', idleWarningMinutes, '分鐘');
  console.log('[閒置檢測] 自動登出時間:', IDLE_TIMEOUT / 1000 / 60, '分鐘後');
})();
