// 專案附件預覽（圖片、PDF、文字/CSV、Word .docx、Excel .xlsx）
// - 圖片/PDF：由伺服器驗證檔頭後 inline 提供
// - 文字/CSV：伺服器回傳 JSON，這裡用 textContent 顯示（不當 HTML 解析）
// - Word/Excel：伺服器只提供「經檢查的原始位元組」，在使用者的瀏覽器內解析（mammoth.js / ExcelJS）；
//   Word 轉出的 HTML 一律先過白名單過濾（見 sanitizeHtml）才放進頁面
(function () {
  'use strict';

  var modalEl = document.getElementById('attachmentPreviewModal');
  if (!modalEl) return;
  var body = document.getElementById('attachmentPreviewBody');
  var title = document.getElementById('attachmentPreviewTitle');
  var note = document.getElementById('attachmentPreviewNote');
  var dl = document.getElementById('attachmentPreviewDownload');
  var modal = null;
  var openToken = 0; // 防止快速連點時，較慢的舊請求把內容寫進新的預覽視窗

  var MAMMOTH_SRC = '/vendor/mammoth/mammoth.browser.min.js';
  var EXCELJS_SRC = '/vendor/exceljs/exceljs.min.js';
  var MAX_SHEET_ROWS = 500;
  var MAX_SHEET_COLS = 40;
  var MAX_DOC_HTML = 3 * 1024 * 1024; // 轉出的 HTML 超過 3MB 就不顯示（避免頁面當機）

  function clearBody() { while (body.firstChild) body.removeChild(body.firstChild); note.textContent = ''; }
  function showMessage(text, cls) {
    var p = document.createElement('div');
    p.className = 'p-4 text-center ' + (cls || 'text-muted');
    p.textContent = text;
    body.appendChild(p);
  }
  function setNote(parts) { note.textContent = parts.filter(Boolean).join('；'); }

  var scriptPromises = {};
  function loadScript(src) {
    if (!scriptPromises[src]) {
      scriptPromises[src] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = function () { delete scriptPromises[src]; reject(new Error('載入預覽元件失敗')); };
        document.head.appendChild(s);
      });
    }
    return scriptPromises[src];
  }

  // ── Word 轉出的 HTML 過濾：白名單標籤 + 白名單屬性，其餘全部移除 ──
  // 以 DOMParser 解析（解析結果是「不執行任何內容」的獨立文件），再逐一用 createElement 重建乾淨節點。
  var ALLOWED_TAGS = {
    p: [], br: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    strong: [], b: [], em: [], i: [], u: [], s: [], sub: [], sup: [],
    ul: [], ol: [], li: [], blockquote: [], pre: [], code: [],
    table: [], thead: [], tbody: [], tfoot: [], tr: [], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
    a: ['href'], img: ['src', 'alt']
  };
  function safeHref(value) {
    return /^(https?:|mailto:)/i.test(String(value).trim()) ? String(value).trim() : null;
  }
  function safeImgSrc(value) {
    return /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+\/=\s]+$/i.test(String(value)) ? String(value) : null;
  }
  function cleanNode(node, outParent) {
    if (node.nodeType === 3) { // 文字
      outParent.appendChild(document.createTextNode(node.nodeValue));
      return;
    }
    if (node.nodeType !== 1) return; // 註解、處理指令等直接丟棄
    var tag = node.nodeName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'svg' || tag === 'math') return; // 連內容一起丟
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TAGS, tag)) { // 不在白名單：只保留裡面的文字與合法子節點
      for (var c = node.firstChild; c; c = c.nextSibling) cleanNode(c, outParent);
      return;
    }
    var el = document.createElement(tag);
    var allowedAttrs = ALLOWED_TAGS[tag];
    for (var i = 0; i < allowedAttrs.length; i++) {
      var attr = allowedAttrs[i];
      if (!node.hasAttribute(attr)) continue;
      var val = node.getAttribute(attr);
      if (attr === 'href') { var h = safeHref(val); if (h) el.setAttribute('href', h); }
      else if (attr === 'src') { var src = safeImgSrc(val); if (src) el.setAttribute('src', src); }
      else if (attr === 'colspan' || attr === 'rowspan') { if (/^\d{1,3}$/.test(val)) el.setAttribute(attr, val); }
      else if (attr === 'alt') { el.setAttribute('alt', String(val).slice(0, 200)); }
    }
    if (tag === 'a') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    if (tag === 'img' && !el.getAttribute('src')) return; // 圖片來源不合法就整個丟掉
    if (tag === 'table') el.className = 'table table-sm table-bordered';
    if (tag !== 'img' && tag !== 'br') {
      for (var ch = node.firstChild; ch; ch = ch.nextSibling) cleanNode(ch, el);
    }
    outParent.appendChild(el);
  }
  function sanitizeHtml(html) {
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    var container = document.createElement('div');
    for (var n = doc.body.firstChild; n; n = n.nextSibling) cleanNode(n, container);
    return container;
  }

  // ── 各類型的顯示 ──
  function renderCsv(data) {
    var wrap = document.createElement('div');
    wrap.className = 'table-responsive';
    var table = document.createElement('table');
    table.className = 'table table-sm table-bordered table-striped mb-0 small';
    (data.rows || []).forEach(function (row, i) {
      var tr = document.createElement('tr');
      row.forEach(function (cell) {
        var el = document.createElement(i === 0 ? 'th' : 'td');
        el.textContent = cell;
        tr.appendChild(el);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    body.appendChild(wrap);
  }

  function renderText(data) {
    var pre = document.createElement('pre');
    pre.className = 'p-3 mb-0 small';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.textContent = data.text || '';
    body.appendChild(pre);
  }

  function fetchBytes(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(t || '此檔案無法預覽，請下載後開啟'); });
      return res.arrayBuffer();
    });
  }

  function renderDocx(base, token) {
    return Promise.all([fetchBytes(base + '/office'), loadScript(MAMMOTH_SRC)]).then(function (r) {
      if (token !== openToken) return;
      var options = {
        convertImage: window.mammoth.images.imgElement(function (image) {
          return image.read('base64').then(function (b64) { return { src: 'data:' + image.contentType + ';base64,' + b64 }; });
        })
      };
      return window.mammoth.convertToHtml({ arrayBuffer: r[0] }, options).then(function (result) {
        if (token !== openToken) return;
        if (result.value.length > MAX_DOC_HTML) throw new Error('文件內容過大，請下載後開啟');
        var container = sanitizeHtml(result.value);
        container.className = 'p-4';
        container.style.maxWidth = '900px';
        container.style.margin = '0 auto';
        clearBody();
        if (!container.textContent.trim() && !container.querySelector('img,table')) {
          showMessage('文件沒有可顯示的內容，請下載後開啟');
        } else {
          body.appendChild(container);
        }
        setNote(['Word 預覽為簡化版（段落、表格、圖片），版面與樣式請以下載後的檔案為準']);
      });
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  // Excel 的日期以 UTC 儲存：用 UTC 欄位格式化，避免依瀏覽器時區差一天；時間部分是 00:00:00 時只顯示日期
  function formatDate(d) {
    if (isNaN(d.getTime())) return '';
    var date = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    var hasTime = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds();
    return hasTime ? date + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) : date;
  }
  function cellText(cell) {
    try {
      var v = cell.value;
      if (v instanceof Date) return formatDate(v);
      if (v && typeof v === 'object' && v.result instanceof Date) return formatDate(v.result);
      return cell.text === undefined || cell.text === null ? '' : String(cell.text);
    } catch (e) { return ''; }
  }
  function renderSheet(sheet, tableWrap) {
    while (tableWrap.firstChild) tableWrap.removeChild(tableWrap.firstChild);
    var rowCount = Math.min(sheet.rowCount || 0, MAX_SHEET_ROWS);
    var colCount = Math.min(sheet.columnCount || 0, MAX_SHEET_COLS);
    var table = document.createElement('table');
    table.className = 'table table-sm table-bordered mb-0 small';
    for (var r = 1; r <= rowCount; r++) {
      var tr = document.createElement('tr');
      var row = sheet.getRow(r);
      for (var c = 1; c <= colCount; c++) {
        var td = document.createElement(r === 1 ? 'th' : 'td');
        td.textContent = cellText(row.getCell(c));
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    tableWrap.appendChild(table);
    return { truncatedRows: (sheet.rowCount || 0) > MAX_SHEET_ROWS, truncatedCols: (sheet.columnCount || 0) > MAX_SHEET_COLS, empty: rowCount === 0 || colCount === 0 };
  }

  function renderXlsx(base, token) {
    return Promise.all([fetchBytes(base + '/office'), loadScript(EXCELJS_SRC)]).then(function (r) {
      if (token !== openToken) return;
      var workbook = new window.ExcelJS.Workbook();
      return workbook.xlsx.load(r[0]).then(function () {
        if (token !== openToken) return;
        var sheets = workbook.worksheets.filter(function (s) { return s.state !== 'veryHidden'; });
        clearBody();
        if (!sheets.length) { showMessage('活頁簿沒有可顯示的工作表，請下載後開啟'); return; }

        var tabs = document.createElement('div');
        tabs.className = 'd-flex flex-wrap gap-1 p-2 border-bottom bg-light';
        var tableWrap = document.createElement('div');
        tableWrap.className = 'table-responsive';
        var buttons = [];
        function select(index) {
          buttons.forEach(function (b, i) { b.className = 'btn btn-sm ' + (i === index ? 'btn-primary' : 'btn-outline-secondary'); });
          var info = renderSheet(sheets[index], tableWrap);
          if (info.empty) { while (tableWrap.firstChild) tableWrap.removeChild(tableWrap.firstChild); showMessage('此工作表沒有資料'); body.appendChild(tableWrap); }
          setNote([
            'Excel 預覽只顯示儲存格內容（不含格式、圖表、公式；公式顯示計算結果）',
            info.truncatedRows ? '僅顯示前 ' + MAX_SHEET_ROWS + ' 列' : '',
            info.truncatedCols ? '僅顯示前 ' + MAX_SHEET_COLS + ' 欄' : ''
          ]);
        }
        sheets.forEach(function (s, i) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = s.name;
          b.addEventListener('click', function () { select(i); });
          buttons.push(b);
          tabs.appendChild(b);
        });
        body.appendChild(tabs);
        body.appendChild(tableWrap);
        select(0);
      });
    });
  }

  function openPreview(btn) {
    var projectId = btn.getAttribute('data-project-id');
    var attachmentId = btn.getAttribute('data-attachment-id');
    var kind = btn.getAttribute('data-kind');
    var name = btn.getAttribute('data-name') || '附件預覽';
    var base = '/projects/' + projectId + '/attachments/' + attachmentId;
    var token = ++openToken;
    clearBody();
    title.textContent = name;
    dl.setAttribute('href', base + '/download');
    if (!modal) modal = new bootstrap.Modal(modalEl);
    modal.show();

    function fail(err) {
      if (token !== openToken) return;
      clearBody();
      showMessage((err && err.message) ? err.message : '預覽失敗，請稍後再試或下載後開啟', 'text-danger');
    }

    if (kind === 'image') {
      var img = document.createElement('img');
      img.src = base + '/preview';
      img.alt = name;
      img.className = 'd-block mx-auto img-fluid';
      img.onerror = function () { clearBody(); showMessage('此檔案無法預覽，請下載後開啟', 'text-danger'); };
      body.appendChild(img);
    } else if (kind === 'pdf') {
      var frame = document.createElement('iframe');
      frame.src = base + '/preview';
      frame.title = name;
      frame.style.width = '100%';
      frame.style.height = '75vh';
      frame.style.border = '0';
      body.appendChild(frame);
    } else if (kind === 'docx' || kind === 'xlsx') {
      showMessage('載入中...');
      (kind === 'docx' ? renderDocx(base, token) : renderXlsx(base, token)).catch(fail);
    } else {
      showMessage('載入中...');
      fetch(base + '/text', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
          if (token !== openToken) return;
          clearBody();
          if (!r.ok) { showMessage(r.data.error || '此檔案無法預覽，請下載後開啟', 'text-danger'); return; }
          if (r.data.kind === 'csv') renderCsv(r.data); else renderText(r.data);
          setNote([
            '編碼：' + r.data.encoding,
            r.data.truncated ? '檔案較大，僅顯示前段內容，完整內容請下載' : '',
            r.data.columnsTruncated ? '欄位過多，僅顯示前 40 欄' : ''
          ]);
        })
        .catch(fail);
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.attachment-preview-btn') : null;
    if (btn) { e.preventDefault(); openPreview(btn); }
  });
  // 關閉視窗時清空內容（停止 PDF/圖片載入，也不留下檔案內容在 DOM 中）；同時讓進行中的請求作廢
  modalEl.addEventListener('hidden.bs.modal', function () { openToken++; clearBody(); });

  // 供測試與除錯：過濾函式不依賴任何頁面狀態
  window.AttachmentPreview = { sanitizeHtml: sanitizeHtml };
})();
