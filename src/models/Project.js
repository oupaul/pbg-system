const db = require('./db');
const AuditLogService = require('../services/AuditLogService');

const Project = {
  // 取得所有專案（含關聯資料）
  // 新增 user 參數用於角色過濾
  findAll(filters = {}, user = null) {
    let sql = `SELECT * FROM v_project_summary WHERE 1=1`;
    const params = [];

    // 角色過濾邏輯
    if (user) {
      if (user.role === 'salesperson' && user.salesperson_id) {
        // 業務員只能看到自己負責的專案
        sql += ` AND salesperson_id = ?`;
        params.push(user.salesperson_id);
      } else if (user.role !== 'admin' && user.role !== 'user' && user.role !== 'boss') {
        // 非管理員、一般人員、老闆：不顯示「儀表板獨立加總」業務員的專案
        sql += ` AND (salesperson_id IS NULL OR salesperson_id NOT IN (SELECT id FROM salespeople WHERE show_separate_dashboard = 1))`;
      }
    }

    if (filters.year) {
      sql += ` AND contract_year = ?`;
      params.push(filters.year);
    }
    if (filters.status) {
      sql += ` AND status = ?`;
      params.push(filters.status);
    }
    if (filters.type) {
      sql += ` AND project_type = ?`;
      params.push(filters.type);
    }
    if (filters.salesperson) {
      sql += ` AND salesperson_name LIKE ?`;
      params.push(`%${filters.salesperson}%`);
    }
    // 新增：支援關鍵字搜尋（專案編號、專案名稱、公司名稱）
    if (filters.keyword) {
      sql += ` AND (project_code LIKE ? OR project_name LIKE ? OR company_name LIKE ?)`;
      const keywordPattern = `%${filters.keyword}%`;
      params.push(keywordPattern, keywordPattern, keywordPattern);
    }

    // 排序處理
    const validSortFields = {
      'project_code': 'project_code',
      'contract_year': 'contract_year',
      'contract_month': 'contract_month',
      'project_name': 'project_name',
      'project_type': 'project_type',
      'salesperson_name': 'salesperson_name',
      'company_name': 'company_name',
      'price_with_tax': 'price_with_tax',
      'total_invoiced': 'total_invoiced',
      'uninvoiced_amount': 'uninvoiced_amount',
      'total_received': 'total_received',
      'unpaid_amount': 'unpaid_amount', // 未收款金額，需要在 ORDER BY 中使用計算表達式
      'expected_invoice_year_month': 'expected_invoice_year_month',
      'status': 'status'
    };
    
    let sortField = filters.sortBy && validSortFields[filters.sortBy] ? validSortFields[filters.sortBy] : 'contract_year';
    const sortOrder = filters.sortOrder && filters.sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    // 處理未收款金額的排序（視圖中沒有此欄位，需要在 ORDER BY 中使用計算表達式）
    if (sortField === 'unpaid_amount') {
      sortField = `(total_invoiced - COALESCE(total_received, 0) - COALESCE(sales_discount, 0))`;
    }
    
    // 新增：篩選未開立發票的專案（有未開立發票金額的專案）
    // 排除「非營利專案」和「廣告交換」類型
    if (filters.uninvoiced === true || filters.uninvoiced === 'true') {
      sql += ` AND (price_with_tax > COALESCE(total_invoiced, 0)) AND project_type NOT IN ('非營利專案', '廣告交換')`;
    }

    // 新增：篩選有未收款金額的專案（已開立發票 - 已收款 - 銷貨折讓 > 0）
    // 排除「非營利專案」和「廣告交換」類型
    if (filters.unpaid === true || filters.unpaid === 'true') {
      sql += ` AND (total_invoiced > 0) AND (total_invoiced - COALESCE(total_received, 0) - COALESCE(sales_discount, 0) > 0) AND project_type NOT IN ('非營利專案', '廣告交換')`;
    }

    // 新增：篩選逾期未收款專案（有未收款且至少一筆發票的預計收款日已過期）
    if (filters.overdue_unpaid === true || filters.overdue_unpaid === 'true') {
      sql += ` AND (total_invoiced > 0) AND (total_invoiced - COALESCE(total_received, 0) - COALESCE(sales_discount, 0) > 0) AND project_type NOT IN ('非營利專案', '廣告交換')`;
      sql += ` AND id IN (SELECT DISTINCT project_id FROM invoices WHERE expected_payment_date IS NOT NULL AND TRIM(expected_payment_date) <> '' AND date(expected_payment_date) < date('now', 'localtime'))`;
    }

    // 新增：篩選預計開票年月
    if (filters.expected_invoice_year_month) {
      sql += ` AND expected_invoice_year_month = ?`;
      params.push(filters.expected_invoice_year_month);
    }

    // 如果排序欄位不是預設的，添加次要排序
    if (sortField !== 'contract_year') {
      sql += ` ORDER BY ${sortField} ${sortOrder}, contract_year DESC, contract_month DESC, project_code`;
    } else {
      sql += ` ORDER BY ${sortField} ${sortOrder}, contract_month ${sortOrder === 'ASC' ? 'ASC' : 'DESC'}, project_code`;
    }
    
    return db.prepare(sql).all(...params);
  },

  // 依ID取得單一專案
  // 新增 user 參數用於權限檢查
  findById(id, user = null) {
    const project = db.prepare(`SELECT * FROM v_project_summary WHERE id = ?`).get(id);
    
    // 如果專案不存在，直接返回 null
    if (!project) {
      return null;
    }
    
    // 角色權限檢查
    if (user && user.role === 'salesperson' && user.salesperson_id) {
      // 業務員只能查看自己負責的專案
      if (project.salesperson_id !== user.salesperson_id) {
        return null; // 無權限查看
      }
    }
    
    // 視圖 v_project_summary 可能未含 report_group_id，從 projects 表補上（供編輯表單報表群組選單）
    try {
      const base = db.prepare(`SELECT report_group_id FROM projects WHERE id = ?`).get(id);
      if (base !== undefined) project.report_group_id = base.report_group_id;
    } catch (_) { /* 若 projects 尚無 report_group_id 欄位則略過 */ }
    
    return project;
  },

  // 依專案編號取得（舊方法，保留向後兼容）
  findByCode(code) {
    return db.prepare(`SELECT * FROM projects WHERE project_code = ? LIMIT 1`).get(code);
  },

  // 依專案編號和類型取得（新方法，支援同編號不同類型）
  findByCodeAndType(code, type) {
    return db.prepare(`SELECT * FROM projects WHERE project_code = ? AND project_type = ?`).get(code, type);
  },

  // 依專案編號、類型和客戶取得（支援同編號不同客戶）
  findByCodeTypeAndCustomer(code, type, customerId) {
    if (customerId === null || customerId === undefined) {
      // 如果客戶ID為空，使用舊的查找方式（只檢查專案編號和類型）
      return db.prepare(`SELECT * FROM projects WHERE project_code = ? AND project_type = ? AND customer_id IS NULL`).get(code, type);
    }
    return db.prepare(`SELECT * FROM projects WHERE project_code = ? AND project_type = ? AND customer_id = ?`).get(code, type, customerId);
  },

  // 依專案編號、類型、客戶和專案名稱取得（支援同編號不同專案名稱）
  findByCodeTypeCustomerAndName(code, type, customerId, projectName) {
    if (customerId === null || customerId === undefined) {
      if (projectName === null || projectName === undefined) {
        return db.prepare(`SELECT * FROM projects WHERE project_code = ? AND project_type = ? AND customer_id IS NULL AND project_name IS NULL`).get(code, type);
      }
      return db.prepare(`SELECT * FROM projects WHERE project_code = ? AND project_type = ? AND customer_id IS NULL AND project_name = ?`).get(code, type, projectName);
    }
    if (projectName === null || projectName === undefined) {
      return db.prepare(`SELECT * FROM projects WHERE project_code = ? AND project_type = ? AND customer_id = ? AND project_name IS NULL`).get(code, type, customerId);
    }
    return db.prepare(`SELECT * FROM projects WHERE project_code = ? AND project_type = ? AND customer_id = ? AND project_name = ?`).get(code, type, customerId, projectName);
  },

  // 依專案編號取得所有類型（同編號可能有多個類型）
  findAllByCode(code) {
    return db.prepare(`SELECT * FROM projects WHERE project_code = ?`).all(code);
  },

  // 新增專案
  create(data) {
    // 確保所有參數都有預設值，避免 undefined
    const projectCode = data.project_code || null;
    const contractYear = data.contract_year !== undefined && data.contract_year !== null ? parseInt(data.contract_year) : null;
    const contractMonth = data.contract_month !== undefined && data.contract_month !== null ? parseInt(data.contract_month) : null;
    const status = data.status || '未結案';
    const projectType = data.project_type || null;
    const salespersonId = data.salesperson_id !== undefined && data.salesperson_id !== null ? parseInt(data.salesperson_id) : null;
    const customerId = data.customer_id !== undefined && data.customer_id !== null ? parseInt(data.customer_id) : null;
    const projectName = data.project_name || null;
    const priceWithTax = data.price_with_tax !== undefined && data.price_with_tax !== null ? parseFloat(data.price_with_tax) : 0;
    const priceWithoutTax = data.price_without_tax !== undefined && data.price_without_tax !== null ? parseFloat(data.price_without_tax) : 0;
    const salesDiscount = data.sales_discount !== undefined && data.sales_discount !== null ? parseFloat(data.sales_discount) : 0;
    const isNewCustomer = data.is_new_customer ? 1 : 0;
    const expectedInvoiceYearMonth = data.expected_invoice_year_month || null;
    const notes = data.notes || null;
    const reportGroupId = data.report_group_id !== undefined && data.report_group_id !== null && data.report_group_id !== ''
      ? parseInt(data.report_group_id) : null;
    
    const stmt = db.prepare(`
      INSERT INTO projects (
        project_code, contract_year, contract_month, status, project_type,
        salesperson_id, customer_id, project_name, price_with_tax, price_without_tax,
        sales_discount, is_new_customer, expected_invoice_year_month, notes, report_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    try {
      const result = stmt.run(
        projectCode,
        contractYear,
        contractMonth,
        status,
        projectType,
        salespersonId,
        customerId,
        projectName,
        priceWithTax,
        priceWithoutTax,
        salesDiscount,
        isNewCustomer,
        expectedInvoiceYearMonth,
        notes,
        reportGroupId
      );
      
      const projectId = result.lastInsertRowid;
      
      // 檢查是否成功插入
      if (!projectId || projectId === 0) {
        // 可能是 UNIQUE 約束問題，嘗試查找已存在的專案
        const existing = this.findByCodeTypeAndCustomer(projectCode, projectType, customerId);
        if (existing) {
          console.log(`專案已存在: ${projectCode} (${projectType})${customerId ? ` - 客戶ID: ${customerId}` : ' - 無客戶'}, ID: ${existing.id}`);
          return existing.id;
        }
        
        // 如果找不到已存在的專案，可能是其他問題
        console.error('Project.create 失敗: lastInsertRowid 為 0 或 undefined');
        console.error('插入的資料:', {
          projectCode,
          contractYear,
          contractMonth,
          status,
          projectType,
          salespersonId,
          customerId,
          projectName
        });
        console.error('SQL 執行結果:', result);
        return null;
      }
      
      // 記錄修改
      AuditLogService.logCreate('projects', projectId, data, data.userInfo);
      
      return projectId;
    } catch (err) {
      // 如果是 UNIQUE 約束錯誤，可能是專案已存在
      if (err.message && err.message.includes('UNIQUE constraint')) {
        console.error('Project.create UNIQUE 約束錯誤:', err.message);
        console.error('嘗試插入的資料:', {
          projectCode,
          projectType,
          contractYear,
          customerId
        });
        // 嘗試查找已存在的專案（使用專案編號+類型+客戶）
        const existing = this.findByCodeTypeAndCustomer(projectCode, projectType, customerId);
        if (existing) {
          console.log(`專案已存在: ${projectCode} (${projectType})${customerId ? ` - 客戶ID: ${customerId}` : ' - 無客戶'}, ID: ${existing.id}`);
          return existing.id;
        }
      }
      // 其他錯誤，重新拋出
      console.error('Project.create 錯誤:', err);
      throw err;
    }
  },

  // 更新專案
  update(id, data) {
    // 取得舊值 - 直接從 projects 表取得，確保包含所有原始欄位（包括 salesperson_id）
    const oldRecord = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
    if (!oldRecord) return false;

    const fields = [];
    const values = [];

    const allowedFields = [
      'project_code', 'contract_year', 'contract_month', 'status', 'project_type',
      'salesperson_id', 'customer_id', 'project_name', 'price_with_tax', 
      'price_without_tax', 'sales_discount', 'is_new_customer', 'expected_invoice_year_month', 'notes', 'report_group_id'
    ];

    const newData = {};
    // 先初始化 newData 為 oldRecord 的副本，確保所有欄位都有值
    for (const field of allowedFields) {
      newData[field] = oldRecord[field];
    }
    
    // 然後更新有變更的欄位
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        // 處理 null 值和類型轉換
        let value = data[field];
        if (value === '') {
          value = null;
        } else if (field === 'salesperson_id' || field === 'customer_id' || field === 'report_group_id') {
          // 外鍵欄位：空字串或 'null' 轉為 null，否則轉為整數
          value = (value === '' || value === 'null' || value === null) ? null : parseInt(value);
        } else if (field === 'contract_year' || field === 'contract_month') {
          value = value ? parseInt(value) : null;
        } else if (field === 'price_with_tax' || field === 'price_without_tax') {
          value = value ? parseFloat(value) : 0;
        } else if (field === 'is_new_customer') {
          value = value ? 1 : 0;
        }
        values.push(value);
        newData[field] = value;
      }
    }

    if (fields.length === 0) return false;

    fields.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);

    const sql = `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...values);
    
    // 無論是否有變更，都記錄修改（因為 updated_at 總是會更新）
    // 這樣可以確保所有修改都被記錄
    if (result.changes >= 0) {
      // 記錄修改 - 確保包含所有欄位的完整資料
      AuditLogService.logUpdate('projects', id, oldRecord, newData, data.userInfo);
    }
    
    return result.changes > 0;
  },

  // 刪除專案
  delete(id, userInfo = null) {
    // 取得舊值
    const oldRecord = this.findById(id);
    
    const result = db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    
    if (result.changes > 0 && oldRecord) {
      // 記錄刪除
      AuditLogService.logDelete('projects', id, oldRecord, userInfo);
    }
    
    return result.changes > 0;
  },

  // 取得年度列表
  getYears() {
    return db.prepare(`
      SELECT DISTINCT contract_year FROM projects ORDER BY contract_year DESC
    `).all().map(r => r.contract_year);
  },

  // 取得所有預計開票年月（用於篩選）
  getExpectedInvoiceYearMonths() {
    return db.prepare(`
      SELECT DISTINCT expected_invoice_year_month 
      FROM projects 
      WHERE expected_invoice_year_month IS NOT NULL AND expected_invoice_year_month != ''
      ORDER BY expected_invoice_year_month DESC
    `).all().map(r => r.expected_invoice_year_month);
  },

  // 取得專案統計
  // excludeSalespersonIds: 排除的業務 ID 陣列（用於儀表板 exclude_separate 模式）
  getStatistics(year = null, excludeSalespersonIds = null) {
    let sql = `
      SELECT 
        COUNT(*) as total_projects,
        COALESCE(SUM(CASE WHEN status = '未結案' THEN 1 ELSE 0 END), 0) as open_projects,
        COALESCE(SUM(CASE WHEN status = '已結案' THEN 1 ELSE 0 END), 0) as closed_projects,
        COALESCE(SUM(price_with_tax), 0) as total_amount
      FROM projects
    `;
    const conditions = [];
    const params = [];
    if (year) {
      conditions.push('contract_year = ?');
      params.push(year);
    }
    if (excludeSalespersonIds && excludeSalespersonIds.length > 0) {
      conditions.push(`salesperson_id NOT IN (${excludeSalespersonIds.map(() => '?').join(',')})`);
      params.push(...excludeSalespersonIds);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    var result = db.prepare(sql).get(...params);
    
    // 為了向後兼容，保留舊的欄位名稱
    result = result || {};
    result.lab_amount = 0;
    result.ad_amount = 0;
    result.project_amount = 0;
    
    // 動態統計所有專案類型的金額
    const typeConditions = ['project_type IS NOT NULL', "project_type != ''"];
    const typeParams = [];
    if (year) {
      typeConditions.push('contract_year = ?');
      typeParams.push(year);
    }
    if (excludeSalespersonIds && excludeSalespersonIds.length > 0) {
      typeConditions.push(`salesperson_id NOT IN (${excludeSalespersonIds.map(() => '?').join(',')})`);
      typeParams.push(...excludeSalespersonIds);
    }
    let typeStatsSql = `
      SELECT 
        project_type,
        COALESCE(SUM(price_with_tax), 0) as type_amount
      FROM projects
      WHERE ${typeConditions.join(' AND ')}
      GROUP BY project_type
    `;
    var typeStats = db.prepare(typeStatsSql).all(...typeParams);
    
    // 將類型統計存儲到 result 中
    result.typeAmounts = {};
    typeStats.forEach(stat => {
      result.typeAmounts[stat.project_type] = stat.type_amount || 0;
    });
    
    return result;
  }
};

module.exports = Project;
