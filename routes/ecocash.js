const express = require('express');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { getEcocashBalance } = require('../lib/ecocash');

const router = express.Router();
router.use(requireAdmin);

router.get('/', (req, res) => {
  const balance = getEcocashBalance(db);

  const withdrawals = db.prepare(`
    SELECT ew.*, u.name AS withdrawn_by_name
    FROM ecocash_withdrawals ew JOIN users u ON u.id = ew.withdrawn_by
    ORDER BY ew.created_at DESC
  `).all();

  const receipts = db.prepare(`
    SELECT r.*, u.name AS cashier_name FROM receipts r
    JOIN users u ON u.id = r.user_id
    WHERE r.payment_method = 'ecocash_usd' AND r.status = 'completed'
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all();

  res.render('ecocash/index', {
    title: 'Ecocash Balance', balance, withdrawals, receipts,
    error: req.query.error || null, success: req.query.success || null
  });
});

router.post('/', (req, res) => {
  const amount = Math.round((parseFloat(req.body.amount) || 0) * 100) / 100;
  const note = (req.body.note || '').trim() || null;

  if (amount <= 0) {
    return res.redirect('/ecocash?error=' + encodeURIComponent('Enter a withdrawal amount greater than $0.'));
  }

  const balance = getEcocashBalance(db);
  if (amount > balance.balance) {
    return res.redirect('/ecocash?error=' + encodeURIComponent(
      `Withdrawal ($${amount.toFixed(2)}) exceeds the available Ecocash balance ($${balance.balance.toFixed(2)}).`
    ));
  }

  db.prepare(`
    INSERT INTO ecocash_withdrawals (amount, note, withdrawn_by, created_at) VALUES (?, ?, ?, datetime('now', '+2 hours'))
  `).run(amount, note, req.session.user.id);

  res.redirect('/ecocash?success=' + encodeURIComponent(`$${amount.toFixed(2)} withdrawal recorded.`));
});

module.exports = router;
