const db = require('./db');
const AuditLogService = require('../services/AuditLogService');
const { PROJECT_VIEW_SCOPE, ROLES } = require('../constants');

// 正規化客戶/廠商身份欄位：vendor_type 僅在具備廠商身份（廠商/兩者皆是）時才有意義
function normalizePartyFields(data) {
  const partyType = ['客戶', '廠商', '兩者皆是'].includes(data.party_type) ? data.party_type : '客戶';
  const hasVendorRole = partyType === '廠商' || partyType === '兩者皆是';
  const vendorType = hasVendorRole && ['個人', '公司'].includes(data.vendor_type) ? data.vendor_type : null;
  return { partyType, vendorType };
}

// 與 Project.js/Pipeline.js 相同的權限範圍過濾邏輯，供客戶列表的「專案金額加總」欄位使用：
// 只加總使用者有權限查看金額的專案，避免透過列表加總洩漏無權限查看專案的金額
// （比照客戶詳情頁「金額鎖定」的精神，但業務員姓名本身不算敏感資訊，仍全部顯示）
function buildProjectAmountScopeCase(user) {
  if (!user) return { sql: '1=1', params: [] };
  const scope = user.project_view_scope ||
    (user.role === ROLES.SALESPERSON ? PROJECT_VIEW_SCOPE.OWN : PROJECT_VIEW_SCOPE.ALL);

  if (scope === PROJECT_VIEW_SCOPE.ALL) return { sql: '1=1', params: [] };
  if (scope === PROJECT_VIEW_SCOPE.NONE) return { sql: '1=0', params: [] };
  if (scope === PROJECT_VIEW_SCOPE.OWN) {
    if (!user.salesperson_id) return { sql: '1=0', params: [] };
    return { sql: 'p.salesperson_id = ?', params: [user.salesperson_id] };
  }
  if (scope === PROJECT_VIEW_SCOPE.ASSIGNED) {
    let ids = [];
    try {
      ids = db.prepare('SELECT salesperson_id FROM user_salesperson_access WHERE user_id = ?').all(user.id).map(r => r.salesperson_id);
    } catch { /* ignore */ }
    if (ids.length === 0) return { sql: '1=0', params: [] };
    return { sql: `p.salesperson_id IN (${ids.map(() => '?').join(',')})`, params: ids };
  }
  return { sql: '1=0', params: [] };
}

const Customer = {
  // 取得所有客戶（客戶/廠商資料對所有使用者開放，僅專案才需要依權限範圍過濾；可選擇依往來狀態/客戶廠商身份/廠商類型篩選）
  // user：用於「專案金額加總」欄位依角色權限範圍過濾金額（比照客戶詳情頁的做法，件數不過濾、金額才過濾）
  findAll(filters = {}, user = null) {
    const statusCond = filters.status ? ' AND c.status = ?' : '';
    const statusParams = filters.status ? [filters.status] : [];
    // party_type = '兩者皆是' 的資料同時具備客戶與廠商身份，篩選「客戶」或「廠商」時都要包含進來
    const partyCond = filters.party_type ? ` AND (c.party_type = ? OR c.party_type = '兩者皆是')` : '';
    const partyParams = filters.party_type ? [filters.party_type] : [];
    const vendorCond = filters.vendor_type ? ' AND c.vendor_type = ?' : '';
    const vendorParams = filters.vendor_type ? [filters.vendor_type] : [];
    const amountScope = buildProjectAmountScopeCase(user);
    return db.prepare(`
      SELECT c.*, COUNT(DISTINCT p.id) as project_count,
        SUM(CASE WHEN ${amountScope.sql} THEN p.price_with_tax ELSE 0 END) as total_project_amount,
        GROUP_CONCAT(DISTINCT sp.name) as salesperson_names,
        u.name as owner_salesperson_name
      FROM customers c
      LEFT JOIN projects p ON c.id = p.customer_id
      LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
      LEFT JOIN users u ON c.owner_salesperson_id = u.id
      WHERE c.deleted_at IS NULL${statusCond}${partyCond}${vendorCond}
      GROUP BY c.id
      ORDER BY c.company_name
    `).all(...amountScope.params, ...statusParams, ...partyParams, ...vendorParams);
  },

  // 依ID取得
  findById(id) {
    return db.prepare(`
      SELECT c.*, u.name as owner_salesperson_name
      FROM customers c
      LEFT JOIN users u ON c.owner_salesperson_id = u.id
      WHERE c.id = ? AND c.deleted_at IS NULL
    `).get(id);
  },

  // 依客戶編號取得
  findByCode(code) {
    return db.prepare(`SELECT * FROM customers WHERE customer_code = ?`).get(code);
  },

  // 依統編取得
  findByTaxId(taxId) {
    return db.prepare(`SELECT * FROM customers WHERE tax_id = ?`).get(taxId);
  },

  // 關鍵字搜尋（搜尋客戶編號、統一編號、公司名稱、聯絡人，可選擇依往來狀態/客戶廠商身份篩選）
  search(keyword, filters = {}, user = null) {
    if (!keyword || keyword.trim() === '') {
      return this.findAll(filters, user);
    }

    const searchTerm = `%${keyword.trim()}%`;
    const statusCond = filters.status ? ' AND c.status = ?' : '';
    const statusParams = filters.status ? [filters.status] : [];
    const partyCond = filters.party_type ? ` AND (c.party_type = ? OR c.party_type = '兩者皆是')` : '';
    const partyParams = filters.party_type ? [filters.party_type] : [];
    const vendorCond = filters.vendor_type ? ' AND c.vendor_type = ?' : '';
    const vendorParams = filters.vendor_type ? [filters.vendor_type] : [];
    const amountScope = buildProjectAmountScopeCase(user);
    return db.prepare(`
      SELECT c.*, COUNT(DISTINCT p.id) as project_count,
        SUM(CASE WHEN ${amountScope.sql} THEN p.price_with_tax ELSE 0 END) as total_project_amount,
        GROUP_CONCAT(DISTINCT sp.name) as salesperson_names,
        u.name as owner_salesperson_name
      FROM customers c
      LEFT JOIN projects p ON c.id = p.customer_id
      LEFT JOIN salespeople sp ON p.salesperson_id = sp.id
      LEFT JOIN users u ON c.owner_salesperson_id = u.id
      WHERE c.deleted_at IS NULL${statusCond}${partyCond}${vendorCond}
        AND (c.customer_code LIKE ? OR c.tax_id LIKE ? OR c.company_name LIKE ? OR c.contact_name LIKE ?)
      GROUP BY c.id
      ORDER BY c.company_name
    `).all(...amountScope.params, ...statusParams, ...partyParams, ...vendorParams, searchTerm, searchTerm, searchTerm, searchTerm);
  },

  // 新增客戶
  create(data) {
    // 確保 customer_code 不為 null（因為資料庫有 NOT NULL 約束）
    if (!data.customer_code) {
      throw new Error('客戶編號不能為空');
    }
    
    // 確保 company_name 不為 null（因為資料庫有 NOT NULL 約束）
    if (!data.company_name) {
      throw new Error('公司名稱不能為空');
    }
    
    const { partyType, vendorType } = normalizePartyFields(data);

    const stmt = db.prepare(`
      INSERT INTO customers (
        customer_code, tax_id, company_name, is_new_customer,
        contact_name, contact_phone, contact_email, owner_salesperson_id,
        customer_level, industry, status, party_type, vendor_type,
        bank_name, bank_account, address
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      const result = stmt.run(
        data.customer_code,
        data.tax_id || null,
        data.company_name,
        data.is_new_customer ? 1 : 0,
        data.contact_name || null,
        data.contact_phone || null,
        data.contact_email || null,
        data.owner_salesperson_id || null,
        data.customer_level || null,
        data.industry || null,
        data.status || '往來中',
        partyType,
        vendorType,
        data.bank_name || null,
        data.bank_account || null,
        data.address || null
      );
      
      const customerId = result.lastInsertRowid;
      
      // 如果插入失敗（lastInsertRowid 為 0），拋出異常
      if (!customerId || customerId === 0) {
        console.error('客戶插入失敗，lastInsertRowid 為 0');
        console.error('插入的資料:', data);
        // 嘗試查找是否因為 UNIQUE 約束而失敗
        const existing = this.findByCode(data.customer_code);
        if (existing) {
          throw new Error(`客戶編號 '${data.customer_code}' 已存在 (ID: ${existing.id})`);
        }
        throw new Error('客戶插入失敗：lastInsertRowid 為 0');
      }
      
      // 記錄新增
      AuditLogService.logCreate('customers', customerId, {
        customer_code: data.customer_code,
        tax_id: data.tax_id || null,
        company_name: data.company_name,
        is_new_customer: data.is_new_customer ? 1 : 0,
        contact_name: data.contact_name || null,
        contact_phone: data.contact_phone || null,
        contact_email: data.contact_email || null,
        owner_salesperson_id: data.owner_salesperson_id || null,
        customer_level: data.customer_level || null,
        industry: data.industry || null,
        status: data.status || '往來中',
        party_type: partyType,
        vendor_type: vendorType,
        bank_name: data.bank_name || null,
        bank_account: data.bank_account || null,
        address: data.address || null
      }, data.userInfo);
      
      return customerId;
    } catch (err) {
      // 如果是 UNIQUE 約束錯誤，提供更詳細的錯誤訊息
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        console.error('UNIQUE 約束錯誤:', err.message);
        console.error('插入的資料:', data);
        // 嘗試查找現有客戶
        const existing = this.findByCode(data.customer_code);
        if (existing) {
          throw new Error(`客戶編號 '${data.customer_code}' 已存在 (ID: ${existing.id})`);
        }
        // 如果客戶編號不存在，可能是統一編號衝突
        if (data.tax_id) {
          const existingByTaxId = this.findByTaxId(data.tax_id);
          if (existingByTaxId) {
            throw new Error(`統一編號 '${data.tax_id}' 已存在 (客戶編號: ${existingByTaxId.customer_code}, ID: ${existingByTaxId.id})`);
          }
        }
      }
      throw err;
    }
  },

  // 更新客戶
  update(id, data) {
    // 取得舊值
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;
    
    // 構建更新欄位和值
    const fields = [];
    const values = [];
    const newData = {};
    
    if (data.customer_code !== undefined) {
      fields.push('customer_code = ?');
      values.push(data.customer_code);
      newData.customer_code = data.customer_code;
    } else {
      newData.customer_code = oldRecord.customer_code;
    }
    
    if (data.tax_id !== undefined) {
      fields.push('tax_id = ?');
      values.push(data.tax_id);
      newData.tax_id = data.tax_id;
    } else {
      newData.tax_id = oldRecord.tax_id;
    }
    
    if (data.company_name !== undefined) {
      fields.push('company_name = ?');
      values.push(data.company_name);
      newData.company_name = data.company_name;
    } else {
      newData.company_name = oldRecord.company_name;
    }
    
    if (data.is_new_customer !== undefined) {
      fields.push('is_new_customer = ?');
      values.push(data.is_new_customer);
      newData.is_new_customer = data.is_new_customer;
    } else {
      newData.is_new_customer = oldRecord.is_new_customer;
    }

    if (data.contact_name !== undefined) {
      fields.push('contact_name = ?');
      values.push(data.contact_name || null);
      newData.contact_name = data.contact_name || null;
    } else {
      newData.contact_name = oldRecord.contact_name;
    }

    if (data.contact_phone !== undefined) {
      fields.push('contact_phone = ?');
      values.push(data.contact_phone || null);
      newData.contact_phone = data.contact_phone || null;
    } else {
      newData.contact_phone = oldRecord.contact_phone;
    }

    if (data.contact_email !== undefined) {
      fields.push('contact_email = ?');
      values.push(data.contact_email || null);
      newData.contact_email = data.contact_email || null;
    } else {
      newData.contact_email = oldRecord.contact_email;
    }

    if (data.owner_salesperson_id !== undefined) {
      fields.push('owner_salesperson_id = ?');
      values.push(data.owner_salesperson_id || null);
      newData.owner_salesperson_id = data.owner_salesperson_id || null;
    } else {
      newData.owner_salesperson_id = oldRecord.owner_salesperson_id;
    }

    if (data.customer_level !== undefined) {
      fields.push('customer_level = ?');
      values.push(data.customer_level || null);
      newData.customer_level = data.customer_level || null;
    } else {
      newData.customer_level = oldRecord.customer_level;
    }

    if (data.industry !== undefined) {
      fields.push('industry = ?');
      values.push(data.industry || null);
      newData.industry = data.industry || null;
    } else {
      newData.industry = oldRecord.industry;
    }

    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status || '往來中');
      newData.status = data.status || '往來中';
    } else {
      newData.status = oldRecord.status;
    }

    if (data.party_type !== undefined || data.vendor_type !== undefined) {
      const { partyType, vendorType } = normalizePartyFields({
        party_type: data.party_type !== undefined ? data.party_type : oldRecord.party_type,
        vendor_type: data.vendor_type !== undefined ? data.vendor_type : oldRecord.vendor_type
      });
      fields.push('party_type = ?', 'vendor_type = ?');
      values.push(partyType, vendorType);
      newData.party_type = partyType;
      newData.vendor_type = vendorType;
    } else {
      newData.party_type = oldRecord.party_type;
      newData.vendor_type = oldRecord.vendor_type;
    }

    if (data.bank_name !== undefined) {
      fields.push('bank_name = ?');
      values.push(data.bank_name || null);
      newData.bank_name = data.bank_name || null;
    } else {
      newData.bank_name = oldRecord.bank_name;
    }

    if (data.bank_account !== undefined) {
      fields.push('bank_account = ?');
      values.push(data.bank_account || null);
      newData.bank_account = data.bank_account || null;
    } else {
      newData.bank_account = oldRecord.bank_account;
    }

    if (data.address !== undefined) {
      fields.push('address = ?');
      values.push(data.address || null);
      newData.address = data.address || null;
    } else {
      newData.address = oldRecord.address;
    }

    // 如果沒有要更新的欄位，直接返回
    if (fields.length === 0) return false;
    
    // 添加 updated_at
    fields.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);
    
    const sql = `UPDATE customers SET ${fields.join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...values);
    
    // 無論 result.changes 是否大於 0，都記錄修改（因為 updated_at 總是會更新）
    if (result.changes >= 0) {
      // 記錄修改
      AuditLogService.logUpdate('customers', id, oldRecord, newData, data.userInfo);
    }
    
    return result.changes > 0;
  },

  // 軟刪除客戶/廠商（僅標記 deleted_at，關聯的專案/銷售機會/活動紀錄仍完整保留，
  // 相關頁面的 JOIN 依然能正確顯示客戶名稱；僅列表/查詢會過濾掉已刪除的客戶）
  softDelete(id, userInfo) {
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;

    db.prepare(`UPDATE customers SET deleted_at = datetime('now', 'localtime') WHERE id = ?`).run(id);
    AuditLogService.logDelete('customers', id, oldRecord, userInfo);
    return true;
  },

  // 取得或建立客戶
  findOrCreate(data) {
    // 如果沒有任何識別資訊，返回 null
    if (!data.customer_code && !data.tax_id && !data.company_name) {
      return null;
    }

    // 在函數開始時就提取並標準化 company_name，避免在 syncCompanyName 中重複處理
    let normalizedCompanyName = null;
    if (data.company_name) {
      try {
        if (typeof data.company_name === 'string') {
          normalizedCompanyName = data.company_name.trim() || null;
        } else if (typeof data.company_name === 'object' && data.company_name !== null) {
          // 如果是對象，嘗試提取文字內容
          // 使用 try-catch 來防止訪問屬性時觸發異常
          try {
            if ('text' in data.company_name && data.company_name.text !== undefined) {
              const textValue = data.company_name.text;
              if (typeof textValue === 'string') {
                normalizedCompanyName = textValue.trim() || null;
              } else if (textValue !== null && textValue !== undefined) {
                normalizedCompanyName = String(textValue).trim() || null;
              }
            } else if ('value' in data.company_name && data.company_name.value !== undefined) {
              const valueValue = data.company_name.value;
              if (typeof valueValue === 'string') {
                normalizedCompanyName = valueValue.trim() || null;
              } else if (valueValue !== null && valueValue !== undefined) {
                normalizedCompanyName = String(valueValue).trim() || null;
              }
            }
          } catch (propErr) {
            // 如果訪問屬性時發生錯誤，設為 null
            console.warn(`無法提取 company_name 屬性: ${propErr.message}`);
            normalizedCompanyName = null;
          }
        } else if (data.company_name !== null && data.company_name !== undefined) {
          // 其他類型，直接轉換為字串
          normalizedCompanyName = String(data.company_name).trim() || null;
        }
      } catch (extractErr) {
        // 如果提取過程中發生錯誤，設為 null
        console.warn(`提取 company_name 時發生錯誤: ${extractErr.message}`);
        normalizedCompanyName = null;
      }
    }

    // 小工具：若已有客戶且傳入公司名稱與現有不同，且新名稱非空，則更新公司名稱
    const syncCompanyName = (customer) => {
      if (!customer) return customer;
      // 使用已經標準化的 company_name，避免重複處理
      if (normalizedCompanyName && normalizedCompanyName.length > 0 && customer.company_name !== normalizedCompanyName) {
        try {
          db.prepare(`UPDATE customers SET company_name = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
            .run(normalizedCompanyName, customer.id);
          customer.company_name = normalizedCompanyName;
          console.log(`更新客戶公司名稱: ID ${customer.id}, 新名稱: ${normalizedCompanyName}`);
        } catch (updateErr) {
          console.error(`更新客戶公司名稱失敗 (ID: ${customer.id}):`, updateErr.message);
        }
      }
      return customer;
    };
    
    // 先嘗試用客戶編號查找
    let customer = null;
    if (data.customer_code) {
      customer = this.findByCode(data.customer_code);
      if (customer) {
        console.log(`使用客戶編號 '${data.customer_code}' 找到現有客戶: ID ${customer.id}`);
        return syncCompanyName(customer);
      }
    }
    
    // 如果沒找到，嘗試用統一編號查找
    if (!customer && data.tax_id) {
      customer = this.findByTaxId(data.tax_id);
      if (customer) {
        console.log(`使用統一編號 '${data.tax_id}' 找到現有客戶: ID ${customer.id}`);
        return syncCompanyName(customer);
      }
    }
    
    // 如果還是沒找到，嘗試用公司名稱查找（如果只有公司名稱，或客戶編號和統一編號都找不到）
    if (!customer && data.company_name) {
      // 只有在沒有客戶編號和統一編號，或者客戶編號和統一編號都找不到時，才用公司名稱查找
      if (!data.customer_code && !data.tax_id) {
        customer = db.prepare(`SELECT * FROM customers WHERE company_name = ?`).get(data.company_name);
        if (customer) {
          console.log(`使用公司名稱 '${data.company_name}' 找到現有客戶: ID ${customer.id}`);
        }
      }
    }
    
    // 如果找不到，建立新客戶
    if (!customer) {
      // 確保至少有公司名稱或統一編號，才能建立客戶
      if (!data.company_name && !data.tax_id) {
        return null;
      }
      
      // 如果沒有客戶編號，但有統一編號或公司名稱，使用統一編號或公司名稱作為客戶編號
      // 這樣可以避免自動生成隨機編號，使用更有意義的識別碼
      if (!data.customer_code) {
        if (data.tax_id) {
          // 優先使用統一編號作為客戶編號
          data.customer_code = data.tax_id;
        } else if (data.company_name) {
          // 如果沒有統一編號，使用公司名稱作為客戶編號
          data.customer_code = data.company_name;
        }
      }
      
      try {
        const id = this.create(data);
        customer = this.findById(id);
        if (!customer) {
          console.error('建立客戶後無法取得客戶資料，ID:', id);
          return null;
        }
      } catch (err) {
        console.error('建立客戶失敗:', err);
        console.error('建立客戶的資料:', data);
        console.error('錯誤堆疊:', err.stack);
        
        // 如果是客戶編號已存在的錯誤（從 Customer.create 拋出的），直接查找現有客戶
        if (err.message && err.message.includes('已存在')) {
          // 從錯誤訊息中提取客戶編號和 ID，例如："客戶編號 '03702716' 已存在 (ID: 23)"
          const match = err.message.match(/客戶編號 '([^']+)' 已存在 \(ID: (\d+)\)/);
          if (match && match[1]) {
            const existingCode = match[1];
            const existingId = match[2] ? parseInt(match[2], 10) : null;
            
            // 優先使用 ID 查找（更快更準確）
            if (existingId) {
              customer = this.findById(existingId);
              if (customer) {
                console.log(`從錯誤訊息中找到現有客戶 (ID: ${existingId}): ${existingCode}`);
                return syncCompanyName(customer);
              }
            }
            
            // 如果 ID 查找失敗，使用客戶編號查找
            customer = this.findByCode(existingCode);
            if (customer) {
              console.log(`從錯誤訊息中找到現有客戶 (編號: ${existingCode}): ID ${customer.id}`);
              return syncCompanyName(customer);
            }
          } else {
            // 如果正則匹配失敗，嘗試更寬鬆的匹配
            const looseMatch = err.message.match(/客戶編號 '([^']+)'/);
            if (looseMatch && looseMatch[1]) {
              const existingCode = looseMatch[1];
              customer = this.findByCode(existingCode);
              if (customer) {
                console.log(`從錯誤訊息中找到現有客戶 (編號: ${existingCode}): ID ${customer.id}`);
                return syncCompanyName(customer);
              }
            }
          }
        }
        
        // 如果是 UNIQUE 約束錯誤，可能是客戶編號衝突，嘗試查找
        if (err.message && err.message.includes('UNIQUE constraint')) {
          console.log('UNIQUE 約束錯誤，嘗試查找現有客戶...');
          // 優先使用客戶編號查找（最準確）
          if (data.customer_code) {
            customer = this.findByCode(data.customer_code);
            if (customer) {
              console.log('使用客戶編號找到現有客戶:', customer.id);
              return syncCompanyName(customer);
            }
          }
          // 如果使用統一編號作為客戶編號時發生衝突，嘗試用統一編號查找
          if (!customer && data.tax_id) {
            customer = this.findByTaxId(data.tax_id);
            if (customer) {
              console.log('使用統一編號找到現有客戶:', customer.id);
              return syncCompanyName(customer);
            }
          }
          // 如果還是找不到，嘗試用公司名稱查找
          if (!customer && data.company_name) {
            customer = db.prepare(`SELECT * FROM customers WHERE company_name = ?`).get(data.company_name);
            if (customer) {
              console.log('使用公司名稱找到現有客戶:', customer.id);
              return syncCompanyName(customer);
            }
          }
        }
        
        // 如果所有查找都失敗，最後嘗試用原始資料查找
        if (!customer) {
          // 最後嘗試：使用原始資料中的客戶編號或統一編號查找
          if (data.customer_code) {
            customer = this.findByCode(data.customer_code);
            if (customer) {
              console.log(`最後嘗試：使用客戶編號 '${data.customer_code}' 找到現有客戶: ID ${customer.id}`);
              return syncCompanyName(customer);
            }
          }
          if (data.tax_id) {
            customer = this.findByTaxId(data.tax_id);
            if (customer) {
              console.log(`最後嘗試：使用統一編號 '${data.tax_id}' 找到現有客戶: ID ${customer.id}`);
              return syncCompanyName(customer);
            }
          }
          console.error('無法建立或找到客戶，返回 null');
          return null;
        }
      }
    }
    
    return syncCompanyName(customer);
  }
};

module.exports = Customer;
