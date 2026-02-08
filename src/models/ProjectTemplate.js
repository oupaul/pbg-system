const db = require('./db');

const ProjectTemplate = {
  findAll() {
    return db.prepare(`
      SELECT t.*, s.name as salesperson_name, c.company_name as customer_name
      FROM project_templates t
      LEFT JOIN salespeople s ON t.salesperson_id = s.id
      LEFT JOIN customers c ON t.customer_id = c.id
      ORDER BY t.updated_at DESC
    `).all();
  },

  findById(id) {
    return db.prepare('SELECT * FROM project_templates WHERE id = ?').get(id);
  },

  create(data) {
    const stmt = db.prepare(`
      INSERT INTO project_templates (
        name, description, project_type, salesperson_id, customer_id,
        project_name, price_with_tax, price_without_tax, is_new_customer,
        expected_invoice_year_month, sales_discount, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.name || '',
      data.description || null,
      data.project_type || null,
      data.salesperson_id || null,
      data.customer_id || null,
      data.project_name || null,
      data.price_with_tax != null ? parseFloat(data.price_with_tax) : 0,
      data.price_without_tax != null ? parseFloat(data.price_without_tax) : 0,
      data.is_new_customer ? 1 : 0,
      data.expected_invoice_year_month || null,
      data.sales_discount != null ? parseFloat(data.sales_discount) : 0,
      data.notes || null
    );
    return result.lastInsertRowid;
  },

  update(id, data) {
    const old = this.findById(id);
    if (!old) return false;
    const stmt = db.prepare(`
      UPDATE project_templates SET
        name = ?, description = ?, project_type = ?, salesperson_id = ?, customer_id = ?,
        project_name = ?, price_with_tax = ?, price_without_tax = ?, is_new_customer = ?,
        expected_invoice_year_month = ?, sales_discount = ?, notes = ?,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `);
    stmt.run(
      data.name !== undefined ? data.name : old.name,
      data.description !== undefined ? data.description : old.description,
      data.project_type !== undefined ? data.project_type : old.project_type,
      data.salesperson_id !== undefined ? (data.salesperson_id || null) : old.salesperson_id,
      data.customer_id !== undefined ? (data.customer_id || null) : old.customer_id,
      data.project_name !== undefined ? data.project_name : old.project_name,
      data.price_with_tax !== undefined ? parseFloat(data.price_with_tax) : old.price_with_tax,
      data.price_without_tax !== undefined ? parseFloat(data.price_without_tax) : old.price_without_tax,
      data.is_new_customer !== undefined ? (data.is_new_customer ? 1 : 0) : old.is_new_customer,
      data.expected_invoice_year_month !== undefined ? data.expected_invoice_year_month : old.expected_invoice_year_month,
      data.sales_discount !== undefined ? parseFloat(data.sales_discount) : old.sales_discount,
      data.notes !== undefined ? data.notes : old.notes,
      id
    );
    return true;
  },

  delete(id) {
    const result = db.prepare('DELETE FROM project_templates WHERE id = ?').run(id);
    return result.changes > 0;
  }
};

module.exports = ProjectTemplate;
