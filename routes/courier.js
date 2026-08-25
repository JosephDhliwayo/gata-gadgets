const express = require('express');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { getCourierBalance } = require('../lib/courier');

const router = express.Router();
router.use(requireAdmin);

router.get('/', (req, res) => {
  const balance = getCourierBalance(db);

  const collections = db.prepare(`
    SELECT cc.*, u.name AS collected_by_name
    FROM courier_collections cc JOIN users u ON u.id = cc.collected_by
    ORDER BY cc.created_at DESC
  `).all();

  const receipts = db.prepare(`
    SELECT r.*, u.name AS cashier_name FROM receipts r
    JOIN users u ON u.id = r.user_id
    WHERE r.payment_method = 'courier' AND r.status = 'completed'
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all();

  res.render('courier/index', {
    title: 'Courier Balance', balance, collections, receipts,
    error: req.query.error || null, success: req.query.success || null
  });
});

router.post('/', (req, res) => {
  const amount = Math.round((parseFloat(req.body.amount) || 0) * 100) / 100;
  const note = (req.body.note || '').trim() || null;

  if (amount <= 0) {
    return res.redirect('/courier?error=' + encodeURIComponent('Enter an amount collected greater than $0.'));
  }

  const balance = getCourierBalance(db);
  if (amount > balance.balance) {
    return res.redirect('/courier?error=' + encodeURIComponent(
      `Amount collected ($${amount.toFixed(2)}) exceeds the outstanding courier balance ($${balance.balance.toFixed(2)}).`
    ));
  }

  db.prepare(`
    INSERT INTO courier_collections (amount, note, collected_by) VALUES (?, ?, ?)
  `).run(amount, note, req.session.user.id);

  res.redirect('/courier?success=' + encodeURIComponent(`$${amount.toFixed(2)} collection recorded.`));
});

module.exports = router;
