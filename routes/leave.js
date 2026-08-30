const express = require('express');
const db = require('../db/database');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/new', (req, res) => {
  res.render('leave/form', { title: 'Request Leave', error: null, formData: null });
});

router.post('/', (req, res) => {
  const { start_date, end_date, reason } = req.body;

  if (!start_date || !end_date) {
    return res.status(400).render('leave/form', { title: 'Request Leave', error: 'Start and end dates are required.', formData: req.body });
  }
  if (end_date < start_date) {
    return res.status(400).render('leave/form', { title: 'Request Leave', error: 'End date cannot be before the start date.', formData: req.body });
  }

  db.prepare(`
    INSERT INTO leave_requests (user_id, start_date, end_date, reason, created_at) VALUES (?, ?, ?, ?, datetime('now', '+2 hours'))
  `).run(req.session.user.id, start_date, end_date, (reason || '').trim() || null);

  res.redirect('/leave');
});

router.get('/', (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';

  const clauses = [];
  const params = [];
  if (!isAdmin) {
    clauses.push('lr.user_id = ?');
    params.push(req.session.user.id);
  }
  if (status) {
    clauses.push('lr.status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const requests = db.prepare(`
    SELECT lr.*, u.name AS user_name, ru.name AS reviewed_by_name
    FROM leave_requests lr
    JOIN users u ON u.id = lr.user_id
    LEFT JOIN users ru ON ru.id = lr.reviewed_by
    ${where}
    ORDER BY lr.created_at DESC
  `).all(...params);

  res.render('leave/list', { title: 'Leave Requests', requests, isAdmin, status });
});

router.post('/:id/approve', requireAdmin, (req, res) => {
  const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!request || request.status !== 'pending') return res.redirect('/leave');

  db.prepare(`
    UPDATE leave_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now', '+2 hours'), review_note = ?
    WHERE id = ?
  `).run(req.session.user.id, (req.body.review_note || '').trim() || null, request.id);

  res.redirect('/leave');
});

router.post('/:id/reject', requireAdmin, (req, res) => {
  const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!request || request.status !== 'pending') return res.redirect('/leave');

  db.prepare(`
    UPDATE leave_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now', '+2 hours'), review_note = ?
    WHERE id = ?
  `).run(req.session.user.id, (req.body.review_note || '').trim() || null, request.id);

  res.redirect('/leave');
});

module.exports = router;
