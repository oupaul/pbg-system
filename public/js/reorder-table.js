// 選項類管理頁的「拖曳／上移下移」排序。
// 用法：<table data-reorder-url="/cost-types/reorder">，<tbody> 的每一列帶 data-id，
// 並有一個 <td class="reorder-cell"></td>（內容由這支程式產生：拖曳把手、序號、上移／下移）。
// 排好後把「全部」id 依新順序 POST 給伺服器（見 src/utils/reorder.js），失敗就還原畫面。
(function () {
  'use strict';

  var style = document.createElement('style');
  style.textContent =
    '.reorder-cell{white-space:nowrap}' +
    '.reorder-handle{cursor:grab;color:#64748B;padding:0 .25rem;user-select:none}' +
    '.reorder-handle:active{cursor:grabbing}' +
    '.reorder-no{display:inline-block;min-width:1.5em;text-align:right;margin-right:.35rem;color:#475569}' +
    '.reorder-btn{padding:0 .3rem;line-height:1.2}' +
    'tr.reorder-dragging{opacity:.4}' +
    'table.reorder-busy{pointer-events:none;opacity:.7}' +
    '#reorder-toast{position:fixed;right:1rem;bottom:1rem;z-index:2000;padding:.5rem .9rem;border-radius:6px;' +
    'color:#fff;font-size:.9rem;box-shadow:0 4px 12px rgba(0,0,0,.2);display:none}';
  document.head.appendChild(style);

  var toastTimer = null;
  function toast(message, isError) {
    var el = document.getElementById('reorder-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'reorder-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.background = isError ? '#dc3545' : '#1E293B';
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, isError ? 4000 : 1500);
  }

  function init(table) {
    var url = table.getAttribute('data-reorder-url');
    var tbody = table.tBodies[0];
    if (!url || !tbody) return;

    function rows() {
      return Array.prototype.filter.call(tbody.rows, function (r) { return r.hasAttribute('data-id'); });
    }
    function renumber() {
      var list = rows();
      list.forEach(function (row, i) {
        var no = row.querySelector('.reorder-no');
        if (no) no.textContent = String(i + 1);
        var up = row.querySelector('.reorder-up');
        var down = row.querySelector('.reorder-down');
        if (up) up.disabled = i === 0;
        if (down) down.disabled = i === list.length - 1;
      });
    }

    // 產生每列的把手、序號與上移／下移按鈕
    rows().forEach(function (row) {
      var cell = row.querySelector('td.reorder-cell');
      if (!cell) return;
      cell.innerHTML =
        '<span class="reorder-handle" title="拖曳調整順序"><i class="bi bi-grip-vertical"></i></span>' +
        '<span class="reorder-no"></span>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary reorder-btn reorder-up" aria-label="上移" title="上移"><i class="bi bi-chevron-up"></i></button> ' +
        '<button type="button" class="btn btn-sm btn-outline-secondary reorder-btn reorder-down" aria-label="下移" title="下移"><i class="bi bi-chevron-down"></i></button>';
    });
    renumber();

    var snapshot = null; // 開始調整前的順序，儲存失敗時還原用
    function takeSnapshot() { snapshot = rows(); }
    function restore() {
      if (!snapshot) return;
      snapshot.forEach(function (row) { tbody.appendChild(row); });
      renumber();
    }

    function save() {
      var ids = rows().map(function (r) { return Number(r.getAttribute('data-id')); });
      table.classList.add('reorder-busy');
      fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ ids: ids })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
      }).then(function (r) {
        if (r.status === 200 && r.data && r.data.ok) {
          toast('順序已儲存', false);
        } else {
          restore();
          toast((r.data && r.data.error) || '儲存順序失敗，已還原', true);
          if (r.status === 409) setTimeout(function () { location.reload(); }, 1500);
        }
      }).catch(function () {
        restore();
        toast('網路錯誤，順序未儲存', true);
      }).then(function () {
        table.classList.remove('reorder-busy');
      });
    }

    // 上移／下移
    tbody.addEventListener('click', function (e) {
      var btn = e.target.closest('.reorder-up, .reorder-down');
      if (!btn || btn.disabled) return;
      var row = btn.closest('tr');
      if (!row) return;
      takeSnapshot();
      if (btn.classList.contains('reorder-up')) {
        var prev = row.previousElementSibling;
        if (!prev) return;
        tbody.insertBefore(row, prev);
      } else {
        var next = row.nextElementSibling;
        if (!next) return;
        tbody.insertBefore(next, row);
      }
      renumber();
      save();
    });

    // 拖曳（只有按住把手才可拖，避免影響列內其他操作）
    var dragging = null;
    tbody.addEventListener('mousedown', function (e) {
      var handle = e.target.closest('.reorder-handle');
      if (!handle) return;
      handle.closest('tr').draggable = true;
    });
    tbody.addEventListener('dragstart', function (e) {
      var row = e.target.closest && e.target.closest('tr');
      if (!row || !row.draggable) return;
      dragging = row;
      takeSnapshot();
      row.classList.add('reorder-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', row.getAttribute('data-id')); } catch (err) { /* IE/舊版 */ }
    });
    tbody.addEventListener('dragover', function (e) {
      if (!dragging) return;
      e.preventDefault();
      var target = e.target.closest('tr');
      if (!target || target === dragging || !target.hasAttribute('data-id')) return;
      var box = target.getBoundingClientRect();
      var after = e.clientY > box.top + box.height / 2;
      tbody.insertBefore(dragging, after ? target.nextElementSibling : target);
    });
    tbody.addEventListener('drop', function (e) { if (dragging) e.preventDefault(); });
    tbody.addEventListener('dragend', function () {
      if (!dragging) return;
      var row = dragging;
      dragging = null;
      row.classList.remove('reorder-dragging');
      row.draggable = false;
      var before = snapshot ? snapshot.map(function (r) { return r.getAttribute('data-id'); }).join(',') : '';
      var after = rows().map(function (r) { return r.getAttribute('data-id'); }).join(',');
      renumber();
      if (before !== after) save();
    });
    document.addEventListener('mouseup', function () {
      if (dragging) return;
      rows().forEach(function (r) { if (r.draggable) r.draggable = false; });
    });
  }

  function start() {
    Array.prototype.forEach.call(document.querySelectorAll('table[data-reorder-url]'), init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
