const express = require('express');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

router.get('/', (req, res) => {
  const expenses = db.prepare(`
    SELECT e.*, u.name AS recorded_by_name FROM expenses e
    JOIN users u ON u.id = e.recorded_by
    ORDER BY e.expense_date DESC, e.id DESC
  `).all();
  res.render('expenses/list', { title: 'Expenses', expenses });
});

router.get('/new', (req, res) => {
  res.render('expenses/form', { title: 'Add Expense', error: null, expense: null });
});

router.post('/', (req, res) => {
  const { description, category, amount, expense_date } = req.body;
  if (!description || !amount || !expense_date) {
    return res.status(400).render('expenses/form', { title: 'Add Expense', error: 'Description, amount and date are required.', expense: req.body });
  }
  db.prepare(`
    INSERT INTO expenses (description, category, amount, expense_date, recorded_by, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+2 hours'))
  `).run(description.trim(), (category || 'General').trim(), parseFloat(amount) || 0, expense_date, req.session.user.id);
  res.redirect('/expenses');
});

router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.redirect('/expenses');
});

module.exports = router;
