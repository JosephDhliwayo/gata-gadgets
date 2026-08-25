const express = require('express');
const db = require('../db/database');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/', (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';

  const clauses = [];
  const params = [];
  if (!isAdmin) {
    clauses.push('dr.requested_by = ?');
    params.push(req.session.user.id);
  }
  if (status) {
    clauses.push('dr.status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const requests = db.prepare(`
    SELECT dr.*, r.receipt_number, r.total AS receipt_total, u.name AS requested_by_name, ru.name AS reviewed_by_name
    FROM discount_requests dr
    JOIN receipts r ON r.id = dr.receipt_id
    JOIN users u ON u.id = dr.requested_by
    LEFT JOIN users ru ON ru.id = dr.reviewed_by
    ${where}
    ORDER BY dr.created_at DESC
  `).all(...params);

  res.render('discounts/list', { title: 'Discounts', requests, isAdmin, status });
});

router.post('/:id/approve', requireAdmin, (req, res) => {
  const request = db.prepare('SELECT * FROM discount_requests WHERE id = ?').get(req.params.id);
  if (!request || request.status !== 'pending') return res.redirect('/discounts');

  db.prepare(`
    UPDATE discount_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?
    WHERE id = ?
  `).run(req.session.user.id, (req.body.review_note || '').trim() || null, request.id);

  res.redirect('/discounts');
});

router.post('/:id/reject', requireAdmin, (req, res) => {
  const request = db.prepare('SELECT * FROM discount_requests WHERE id = ?').get(req.params.id);
  if (!request || request.status !== 'pending') return res.redirect('/discounts');

  db.prepare(`
    UPDATE discount_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?
    WHERE id = ?
  `).run(req.session.user.id, (req.body.review_note || '').trim() || null, request.id);

  res.redirect('/discounts');
});

module.exports = router;
