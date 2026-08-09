const db = require('./db');
const AuditLogService = require('../services/AuditLogService');
const Project = require('./Project');

// 預估專案類型支援複選：checkbox 同名欄位在 express (qs extended) 底下，
// 勾選多個時 req.body.project_type 會是陣列，勾選一個時是字串，都正規化成逗號分隔字串儲存
function normalizeProjectTypes(value) {
  if (Array.isArray(value)) {
    const cleaned = value.map(v => String(v).trim()).filter(Boolean);
    return cleaned.length ? cleaned.join(',') : null;
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

const Pipeline = {
  // 取得銷售機會列表：對所有登入者開放（比照客戶/廠商列表的做法），業務開發資訊由團隊互相可見，
  // 不像正式專案的財務金額需要依角色權限範圍過濾；可依狀態/客戶篩選
  findAll(filters = {}, user = null) {
    let conditions = `WHERE p.deleted_at IS NULL`;
    const params = [];

    if (filters.status) {
      conditions += ` AND p.status = ?`;
      params.push(filters.status);
    }

    if (filters.customer_id) {
      conditions += ` AND p.customer_id = ?`;
      params.push(filters.customer_id);
    }

    return db.prepare(`
      SELECT p.*, c.company_name as customer_name, c.customer_code,
             s.name as salesperson_name, ou.name as owner_user_name
      FROM pipelines p
      LEFT JOIN customers c ON p.customer_id = c.id
      LEFT JOIN salespeople s ON p.salesperson_id = s.id
      LEFT JOIN users ou ON p.owner_user_id = ou.id
      ${conditions}
      ORDER BY
        CASE p.status WHEN '洽談中' THEN 0 WHEN '已成交' THEN 1 ELSE 2 END,
        p.expected_close_year_month ASC,
        p.created_at DESC
    `).all(...params);
  },

  findById(id) {
    return db.prepare(`
      SELECT p.*, c.company_name as customer_name, c.customer_code,
             s.name as salesperson_name, ou.name as owner_user_name
      FROM pipelines p
      LEFT JOIN customers c ON p.customer_id = c.id
      LEFT JOIN salespeople s ON p.salesperson_id = s.id
      LEFT JOIN users ou ON p.owner_user_id = ou.id
      WHERE p.id = ? AND p.deleted_at IS NULL
    `).get(id);
  },

  create(data) {
    if (!data.customer_id) throw new Error('客戶為必填欄位');
    if (!data.opportunity_name || !data.opportunity_name.trim()) throw new Error('商機名稱為必填欄位');
    if (!normalizeProjectTypes(data.project_type)) throw new Error('預估專案類型為必填欄位，請至少選擇一項');
    if (data.win_probability === undefined || data.win_probability === null || data.win_probability === '') {
      throw new Error('成交機率為必填欄位');
    }
    if (!data.expected_close_year_month) throw new Error('預計成交月份為必填欄位');

    const stmt = db.prepare(`
      INSERT INTO pipelines (
        customer_id, salesperson_id, owner_user_id, opportunity_name, project_type,
        estimated_amount, win_probability, expected_close_year_month, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      parseInt(data.customer_id),
      data.salesperson_id ? parseInt(data.salesperson_id) : null,
      data.owner_user_id ? parseInt(data.owner_user_id) : null,
      data.opportunity_name.trim(),
      normalizeProjectTypes(data.project_type),
      data.estimated_amount !== undefined && data.estimated_amount !== null ? parseFloat(data.estimated_amount) : 0,
      data.win_probability !== undefined && data.win_probability !== null && data.win_probability !== ''
        ? parseInt(data.win_probability) : null,
      data.expected_close_year_month || null,
      data.notes || null
    );

    const id = result.lastInsertRowid;
    AuditLogService.logCreate('pipelines', id, data, data.userInfo);
    return id;
  },

  update(id, data) {
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;

    // 這三項欄位由表單一次整包送出（非部分更新），視為必填欄位驗證
    if (data.project_type !== undefined && !normalizeProjectTypes(data.project_type)) {
      throw new Error('預估專案類型為必填欄位，請至少選擇一項');
    }
    if (data.win_probability !== undefined && (data.win_probability === null || data.win_probability === '')) {
      throw new Error('成交機率為必填欄位');
    }
    if (data.expected_close_year_month !== undefined && !data.expected_close_year_month) {
      throw new Error('預計成交月份為必填欄位');
    }

    const fields = [];
    const values = [];

    const setField = (col, val) => { fields.push(`${col} = ?`); values.push(val); };

    if (data.salesperson_id !== undefined) setField('salesperson_id', data.salesperson_id ? parseInt(data.salesperson_id) : null);
    if (data.owner_user_id !== undefined) setField('owner_user_id', data.owner_user_id ? parseInt(data.owner_user_id) : null);
    if (data.opportunity_name !== undefined) setField('opportunity_name', data.opportunity_name.trim());
    if (data.project_type !== undefined) setField('project_type', normalizeProjectTypes(data.project_type));
    if (data.estimated_amount !== undefined) setField('estimated_amount', parseFloat(data.estimated_amount) || 0);
    if (data.win_probability !== undefined) {
      setField('win_probability', data.win_probability !== '' && data.win_probability !== null ? parseInt(data.win_probability) : null);
    }
    if (data.expected_close_year_month !== undefined) setField('expected_close_year_month', data.expected_close_year_month || null);
    if (data.notes !== undefined) setField('notes', data.notes || null);

    if (fields.length === 0) return false;

    fields.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);

    db.prepare(`UPDATE pipelines SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    AuditLogService.logUpdate('pipelines', id, oldRecord, data, data.userInfo);
    return true;
  },

  // 標記成交/流失（成交本身不會建立專案，需財務另外走「轉入專案」流程）
  setStatus(id, status, extra = {}) {
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;
    if (!['洽談中', '已成交', '已流失'].includes(status)) throw new Error('無效的狀態');
    if (oldRecord.converted_project_id) throw new Error('此商機已轉入專案，無法變更狀態');

    db.prepare(`
      UPDATE pipelines
      SET status = ?, lost_reason = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(status, status === '已流失' ? (extra.lost_reason || null) : null, id);

    AuditLogService.logUpdate('pipelines', id, oldRecord, { status }, extra.userInfo);
    return true;
  },

  // 轉入專案：由財務人員提供專案編號，實際建立 projects 資料列
  convertToProject(id, projectData) {
    const pipeline = this.findById(id);
    if (!pipeline) throw new Error('找不到此商機');
    if (pipeline.status !== '已成交') throw new Error('僅「已成交」的商機可以轉入專案');
    if (pipeline.converted_project_id) throw new Error('此商機已轉入專案');

    const projectId = Project.create({
      ...projectData,
      customer_id: pipeline.customer_id,
      salesperson_id: projectData.salesperson_id || pipeline.salesperson_id
    });

    if (!projectId) throw new Error('建立專案失敗');

    db.prepare(`
      UPDATE pipelines
      SET converted_project_id = ?, converted_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(projectId, id);

    AuditLogService.logUpdate('pipelines', id, pipeline, { converted_project_id: projectId }, projectData.userInfo);
    return projectId;
  },

  softDelete(id, userInfo) {
    const oldRecord = this.findById(id);
    if (!oldRecord) return false;
    if (oldRecord.converted_project_id) throw new Error('此商機已轉入專案，無法刪除');

    db.prepare(`UPDATE pipelines SET deleted_at = datetime('now', 'localtime') WHERE id = ?`).run(id);
    AuditLogService.logDelete('pipelines', id, oldRecord, userInfo);
    return true;
  }
};

module.exports = Pipeline;
