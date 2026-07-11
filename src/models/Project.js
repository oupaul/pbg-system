const db = require('./db');
const AuditLogService = require('../services/AuditLogService');
const { PROJECT_VIEW_SCOPE, ROLES } = require('../constants');

// Return salesperson IDs accessible to a user via user_salesperson_access table
function getAssignedSalespersonIds(userId) {
  try {
    const rows = db.prepare(
      'SELECT salesperson_id FROM user_salesperson_access WHERE user_id = ?'
    ).all(userId);
    return rows.map(r => r.salesperson_id);
  } catch {
    return [];
  }
}

const Project = {
  // 取得所有專案（含關聯資料）
  findAll(filters = {}, user = null) {
    let conditions = `WHERE 1=1`;
    const params = [];

    // Project visibility filtering based on role's project_view_scope
    if (user) {
      const scope = user.project_view_scope ||
        (user.role === ROLES.SALESPERSON ? PROJECT_VIEW_SCOPE.OWN : PROJECT_VIEW_SCOPE.ALL);

      if (scope === PROJECT_VIEW_SCOPE.OWN && user.salesperson_id) {
        conditions += ` AND salesperson_id = ?`;
        params.push(user.salesperson_id);
      } else if (scope === PROJECT_VIEW_SCOPE.ASSIGNED) {
        const ids = getAssignedSalespersonIds(user.id);
        if (ids.length > 0) {
          conditions += ` AND salesperson_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        } else {
          conditions += ` AND 1=0`;
        }
      } else if (scope === PROJECT_VIEW_SCOPE.NONE) {
        conditions += ` AND 1=0`;
      }
      // PROJECT_VIEW_SCOPE.ALL — no filter applied
    }

    if (filters.year) {
      conditions += ` AND contract_year = ?`;
      params.push(filters.year);
    }
    if (filters.status) {
      conditions += ` AND status = ?`;
      params.push(filters.status);
    }
    if (filters.type) {
      conditions += ` AND project_type = ?`;
      params.push(filters.type);
    }
    if (filters.salesperson) {
      conditions += ` AND salesperson_name LIKE ?`;
      params.push(`%${filters.salesperson}%`);
    }
    if (filters.keyword) {
      conditions += ` AND (project_code LIKE ? OR project_name LIKE ? OR company_name LIKE ?)`;
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
      'unpaid_amount': 'unpaid_amount',
      'expected_invoice_year_month': 'expected_invoice_year_month',
      'status': 'status'
    };

    let sortField = filters.sortBy && validSortFields[filters.sortBy] ? validSortFields[filters.sortBy] : 'contract_year';
    const sortOrder = filters.sortOrder && filters.sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    if (sortField === 'unpaid_amount') {
      sortField = `(total_invoiced - COALESCE(total_received, 0) - COALESCE(sales_discount, 0))`;
    }

    if (filters.uninvoiced === true || filters.uninvoiced === 'true') {
      conditions += ` AND (price_with_tax > COALESCE(total_invoiced, 0)) AND project_type NOT IN ('非營利專案', '廣告交換')`;
    }
    if (filters.unpaid === true || filters.unpaid === 'true') {
      conditions += ` AND (total_invoiced > 0) AND (total_invoiced - COALESCE(total_received, 0) - COALESCE(sales_discount, 0) > 0) AND project_type NOT IN ('非營利專案', '廣告交換')`;
    }
    if (filters.overdue_unpaid === true || filters.overdue_unpaid === 'true') {
      conditions += ` AND (total_invoiced > 0) AND (total_invoiced - COALESCE(total_received, 0) - COALESCE(sales_discount, 0) > 0) AND project_type NOT IN ('非營利專案', '廣告交換')`;
      conditions += ` AND id IN (SELECT DISTINCT project_id FROM invoices WHERE expected_payment_date IS NOT NULL AND TRIM(expected_payment_date) <> '' AND date(expected_payment_date) < date('now', 'localtime'))`;
    }
    if (filters.expected_invoice_year_month) {
      conditions += ` AND expected_invoice_year_month = ?`;
      params.push(filters.expected_invoice_year_month);
    }

    let orderBy;
    if (sortField !== 'contract_year') {
      orderBy = `ORDER BY ${sortField} ${sortOrder}, contract_year DESC, contract_month DESC, project_code`;
    } else {
      orderBy = `ORDER BY ${sortField} ${sortOrder}, contract_month ${sortOrder === 'ASC' ? 'ASC' : 'DESC'}, project_code`;
    }

    // 發票年度篩選：使用 CTE 計算當年度已開發票金額與已收款金額
    if (filters.invoice_year) {
      const sql = `
        WITH year_invoice_data AS (
          SELECT project_id,
            COALESCE(SUM(amount_with_tax - COALESCE(allowance_amount, 0)), 0) AS year_invoiced
          FROM invoices
          WHERE strftime('%Y', invoice_date) = ?
            AND (status IS NULL OR status = '有效') AND deleted_at IS NULL
          GROUP BY project_id
        ),
        year_payment_data AS (
          SELECT i.project_id,
            COALESCE(SUM(CASE WHEN p.difference_type = '匯費'
              THEN p.bank_deposit_amount + COALESCE(p.payment_difference, 0)
              ELSE p.bank_deposit_amount END), 0) AS year_received
          FROM invoices i
          JOIN payments p ON p.invoice_id = i.id
          WHERE strftime('%Y', i.invoice_date) = ?
            AND (i.status IS NULL OR i.status = '有效') AND i.deleted_at IS NULL AND p.deleted_at IS NULL
          GROUP BY i.project_id
        )
        SELECT vps.*,
          COALESCE(yid.year_invoiced, 0) AS year_invoiced,
          COALESCE(ypd.year_received, 0) AS year_received,
          COALESCE(yid.year_invoiced, 0) - COALESCE(ypd.year_received, 0) AS year_unpaid
        FROM v_project_summary vps
        INNER JOIN year_invoice_data yid ON yid.project_id = vps.id
        LEFT JOIN year_payment_data ypd ON ypd.project_id = vps.id
        ${conditions}
        ${orderBy}
      `;
      return db.prepare(sql).all(filters.invoice_year, filters.invoice_year, ...params);
    }

    const sql = `SELECT * FROM v_project_summary ${conditions} ${orderBy}`;
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
    
    // Project visibility check using project_view_scope
    if (user) {
      const scope = user.project_view_scope ||
        (user.role === ROLES.SALESPERSON ? PROJECT_VIEW_SCOPE.OWN : PROJECT_VIEW_SCOPE.ALL);

      if (scope === PROJECT_VIEW_SCOPE.OWN && user.salesperson_id) {
        if (project.salesperson_id !== user.salesperson_id) return null;
      } else if (scope === PROJECT_VIEW_SCOPE.ASSIGNED) {
        const ids = getAssignedSalespersonIds(user.id);
        if (!ids.includes(project.salesperson_id)) return null;
      } else if (scope === PROJECT_VIEW_SCOPE.NONE) {
        return null;
      }
    }
    
    // 視圖 v_project_summary 可能未含 report_group_id，從 projects 表補上（供編輯表單報表群組選單）
    try {
      const base = db.prepare(`SELECT report_group_id FROM projects WHERE id = ?`).get(id);
      if (base !== undefined) project.report_group_id = base.report_group_id;
    } catch (_) { /* 若 projects 尚無 report_group_id 欄位則略過 */ }
    
    return project;
  },

  // 依客戶ID取得專案列表（供客戶詳情頁使用，依角色權限範圍過濾）
  findByCustomerId(customerId, user = null) {
    let conditions = `WHERE customer_id = ?`;
    const params = [customerId];

    if (user) {
      const scope = user.project_view_scope ||
        (user.role === ROLES.SALESPERSON ? PROJECT_VIEW_SCOPE.OWN : PROJECT_VIEW_SCOPE.ALL);

      if (scope === PROJECT_VIEW_SCOPE.OWN && user.salesperson_id) {
        conditions += ` AND salesperson_id = ?`;
        params.push(user.salesperson_id);
      } else if (scope === PROJECT_VIEW_SCOPE.ASSIGNED) {
        const ids = getAssignedSalespersonIds(user.id);
        if (ids.length > 0) {
          conditions += ` AND salesperson_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        } else {
          conditions += ` AND 1=0`;
        }
      } else if (scope === PROJECT_VIEW_SCOPE.NONE) {
        conditions += ` AND 1=0`;
      }
    }

    return db.prepare(`
      SELECT * FROM v_project_summary
      ${conditions}
      ORDER BY contract_year DESC, contract_month DESC
    `).all(...params);
  },

  // 依客戶ID取得專案統計（供客戶詳情頁使用，依角色權限範圍過濾，與 findByCustomerId 同一套範圍）
  getStatsByCustomerId(customerId, user = null) {
    let conditions = `WHERE customer_id = ?`;
    const params = [customerId];

    if (user) {
      const scope = user.project_view_scope ||
        (user.role === ROLES.SALESPERSON ? PROJECT_VIEW_SCOPE.OWN : PROJECT_VIEW_SCOPE.ALL);

      if (scope === PROJECT_VIEW_SCOPE.OWN && user.salesperson_id) {
        conditions += ` AND salesperson_id = ?`;
        params.push(user.salesperson_id);
      } else if (scope === PROJECT_VIEW_SCOPE.ASSIGNED) {
        const ids = getAssignedSalespersonIds(user.id);
        if (ids.length > 0) {
          conditions += ` AND salesperson_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        } else {
          conditions += ` AND 1=0`;
        }
      } else if (scope === PROJECT_VIEW_SCOPE.NONE) {
        conditions += ` AND 1=0`;
      }
    }

    return db.prepare(`
      SELECT
        COUNT(*) as project_count,
        SUM(price_with_tax) as total_amount,
        SUM(CASE WHEN status = '已結案' THEN 1 ELSE 0 END) as closed_count
      FROM projects
      ${conditions}
    `).get(...params);
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

  // 取得有開立發票的年份列表（用於發票年度篩選）
  getInvoiceYears() {
    return db.prepare(`
      SELECT DISTINCT strftime('%Y', invoice_date) AS year
      FROM invoices
      WHERE invoice_date IS NOT NULL AND invoice_date != ''
        AND (status IS NULL OR status = '有效')
        AND deleted_at IS NULL
      ORDER BY year DESC
    `).all().map(r => r.year).filter(Boolean);
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
  // salespersonId: 僅統計該業務員名下的專案（業務員儀表板依權限範圍過濾用）
  // excludeTypeNames: 排除的專案類型名稱陣列（儀表板主區塊排除獨立加總類型）
  getStatistics(year = null, salespersonId = null, excludeTypeNames = null) {
    const conditions = [];
    const params = [];
    if (year) {
      conditions.push('contract_year = ?');
      params.push(year);
    }
    if (salespersonId) {
      conditions.push('salesperson_id = ?');
      params.push(salespersonId);
    }
    if (excludeTypeNames && excludeTypeNames.length > 0) {
      conditions.push('(project_type IS NULL OR project_type NOT IN (' + excludeTypeNames.map(() => '?').join(',') + '))');
      params.push(...excludeTypeNames);
    }
    const whereClause = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    let sql = `
      SELECT 
        COUNT(*) as total_projects,
        COALESCE(SUM(CASE WHEN status = '未結案' THEN 1 ELSE 0 END), 0) as open_projects,
        COALESCE(SUM(CASE WHEN status = '已結案' THEN 1 ELSE 0 END), 0) as closed_projects,
        COALESCE(SUM(price_with_tax), 0) as total_amount
      FROM projects
      ${whereClause}
    `;
    var result = db.prepare(sql).get(...params);
    
    result = result || {};
    result.lab_amount = 0;
    result.ad_amount = 0;
    result.project_amount = 0;
    
    const typeConditions = ['project_type IS NOT NULL', "project_type != ''"];
    const typeParams = [];
    if (year) {
      typeConditions.push('contract_year = ?');
      typeParams.push(year);
    }
    if (salespersonId) {
      typeConditions.push('salesperson_id = ?');
      typeParams.push(salespersonId);
    }
    if (excludeTypeNames && excludeTypeNames.length > 0) {
      typeConditions.push('(project_type IS NULL OR project_type NOT IN (' + excludeTypeNames.map(() => '?').join(',') + '))');
      typeParams.push(...excludeTypeNames);
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
    
    result.typeAmounts = {};
    typeStats.forEach(stat => {
      result.typeAmounts[stat.project_type] = stat.type_amount || 0;
    });
    
    return result;
  }
};

module.exports = Project;
