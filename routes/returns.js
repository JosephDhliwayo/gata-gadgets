const express = require('express');
const db = require('../db/database');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

function getReturnableItems(receiptId) {
  return db.prepare(`
    SELECT ri.id AS receipt_item_id, ri.product_id, ri.product_name, ri.quantity, ri.unit_price, ri.unit_cost,
      ri.quantity - COALESCE((
        SELECT SUM(rri.quantity) FROM return_request_items rri
        JOIN return_requests rr ON rr.id = rri.return_request_id
        WHERE rri.receipt_item_id = ri.id AND rr.status IN ('pending','approved')
      ), 0) AS remaining
    FROM receipt_items ri
    WHERE ri.receipt_id = ?
  `).all(receiptId);
}

router.get('/new/:receiptId', (req, res) => {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.receiptId);
  if (!receipt) return res.status(404).render('errors/404', { title: 'Not Found' });

  if (receipt.user_id !== req.session.user.id) {
    return res.status(403).render('errors/403', { title: 'Access Denied' });
  }
  if (receipt.status !== 'completed') {
    return res.status(400).render('errors/403', { title: 'Not Returnable' });
  }

  const items = getReturnableItems(receipt.id).filter(it => it.remaining > 0);
  res.render('returns/new', { title: 'Request Sales Return', receipt, items, error: null });
});

router.post('/', (req, res) => {
  const receiptId = parseInt(req.body.receipt_id, 10);
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
  if (!receipt) return res.status(404).render('errors/404', { title: 'Not Found' });

  // Ownership rule: only the user who captured the original sale may request its return.
  if (receipt.user_id !== req.session.user.id) {
    return res.status(403).render('errors/403', { title: 'Access Denied' });
  }
  if (receipt.status !== 'completed') {
    return res.status(400).render('errors/403', { title: 'Not Returnable' });
  }

  const returnable = getReturnableItems(receipt.id);
  const byId = new Map(returnable.map(it => [String(it.receipt_item_id), it]));

  let receiptItemIds = req.body.receipt_item_id;
  let quantities = req.body.return_quantity;
  receiptItemIds = Array.isArray(receiptItemIds) ? receiptItemIds : (receiptItemIds ? [receiptItemIds] : []);
  quantities = Array.isArray(quantities) ? quantities : (quantities ? [quantities] : []);

  const lines = [];
  for (let i = 0; i < receiptItemIds.length; i++) {
    const qty = parseInt(quantities[i], 10);
    if (!qty || qty <= 0) continue;
    const source = byId.get(String(receiptItemIds[i]));
    if (!source) continue;
    if (qty > source.remaining) {
      const items = getReturnableItems(receipt.id).filter(it => it.remaining > 0);
      return res.status(400).render('returns/new', {
        title: 'Request Sales Return', receipt, items,
        error: `Requested quantity for "${source.product_name}" exceeds what is still returnable (${source.remaining}).`
      });
    }
    lines.push({ ...source, quantity: qty });
  }

  if (lines.length === 0) {
    const items = getReturnableItems(receipt.id).filter(it => it.remaining > 0);
    return res.status(400).render('returns/new', {
      title: 'Request Sales Return', receipt, items,
      error: 'Select at least one item and quantity to return.'
    });
  }

  const reason = (req.body.reason || '').trim();
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO return_requests (receipt_id, requested_by, reason, created_at) VALUES (?, ?, ?, datetime('now', '+2 hours'))
    `).run(receipt.id, req.session.user.id, reason || null);
    const requestId = info.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO return_request_items (return_request_id, receipt_item_id, product_id, product_name, quantity, unit_price, unit_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of lines) {
      insertItem.run(requestId, line.receipt_item_id, line.product_id, line.product_name, line.quantity, line.unit_price, line.unit_cost);
    }
    return requestId;
  });

  const requestId = tx();
  res.redirect(`/returns/${requestId}`);
});

router.get('/', (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';

  const clauses = [];
  const params = [];
  if (!isAdmin) {
    clauses.push('rr.requested_by = ?');
    params.push(req.session.user.id);
  }
  if (status) {
    clauses.push('rr.status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const requests = db.prepare(`
    SELECT rr.*, r.receipt_number, r.total AS receipt_total, u.name AS requested_by_name,
      (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM return_request_items WHERE return_request_id = rr.id) AS return_value
    FROM return_requests rr
    JOIN receipts r ON r.id = rr.receipt_id
    JOIN users u ON u.id = rr.requested_by
    ${where}
    ORDER BY rr.created_at DESC
    LIMIT 300
  `).all(...params);

  res.render('returns/list', { title: 'Sales Returns', requests, isAdmin, status });
});

router.get('/:id', (req, res) => {
  const request = db.prepare(`
    SELECT rr.*, r.receipt_number, r.customer_name, r.total AS receipt_total, r.user_id AS receipt_owner_id,
      u.name AS requested_by_name, ru.name AS reviewed_by_name
    FROM return_requests rr
    JOIN receipts r ON r.id = rr.receipt_id
    JOIN users u ON u.id = rr.requested_by
    LEFT JOIN users ru ON ru.id = rr.reviewed_by
    WHERE rr.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).render('errors/404', { title: 'Not Found' });

  if (req.session.user.role !== 'admin' && request.requested_by !== req.session.user.id) {
    return res.status(403).render('errors/403', { title: 'Access Denied' });
  }

  const items = db.prepare('SELECT * FROM return_request_items WHERE return_request_id = ?').all(req.params.id);
  res.render('returns/view', { title: `Return Request #${request.id}`, request, items });
});

router.post('/:id/approve', requireAdmin, (req, res) => {
  const request = db.prepare('SELECT * FROM return_requests WHERE id = ?').get(req.params.id);
  if (!request || request.status !== 'pending') return res.redirect('/returns');

  const items = db.prepare('SELECT * FROM return_request_items WHERE return_request_id = ?').all(request.id);
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(request.receipt_id);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE return_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now', '+2 hours'), review_note = ?
      WHERE id = ?
    `).run(req.session.user.id, (req.body.review_note || '').trim() || null, request.id);

    const restock = db.prepare(`UPDATE products SET quantity = quantity + ?, updated_at = datetime('now', '+2 hours') WHERE id = ?`);
    const insertAdj = db.prepare(`
      INSERT INTO stock_adjustments (product_id, type, quantity_change, note, recorded_by, created_at)
      VALUES (?, 'return', ?, ?, ?, datetime('now', '+2 hours'))
    `);
    for (const it of items) {
      if (!it.product_id) continue;
      restock.run(it.quantity, it.product_id);
      insertAdj.run(it.product_id, it.quantity, `Approved return on receipt ${receipt.receipt_number} (request #${request.id})`, req.session.user.id);
    }
  });
  tx();
  res.redirect(`/returns/${request.id}`);
});

router.post('/:id/reject', requireAdmin, (req, res) => {
  const request = db.prepare('SELECT * FROM return_requests WHERE id = ?').get(req.params.id);
  if (!request || request.status !== 'pending') return res.redirect('/returns');

  db.prepare(`
    UPDATE return_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now', '+2 hours'), review_note = ?
    WHERE id = ?
  `).run(req.session.user.id, (req.body.review_note || '').trim() || null, request.id);

  res.redirect(`/returns/${request.id}`);
});

module.exports = router;
