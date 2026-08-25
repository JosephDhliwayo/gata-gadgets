const express = require('express');
const db = require('../db/database');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { listCustomersWithLoyalty, getCustomerWithLoyalty, findCustomerByPhoneWithLoyalty, TIERS } = require('../lib/loyalty');

const router = express.Router();
router.use(requireLogin);

// JSON lookup used by the receipt capture form to show a customer's tier/points live.
router.get('/lookup', (req, res) => {
  const phone = (req.query.phone || '').trim();
  if (!phone) return res.json({ found: false });
  const customer = findCustomerByPhoneWithLoyalty(db, phone);
  if (!customer) return res.json({ found: false });
  res.json({
    found: true,
    name: customer.name,
    tier: customer.tier,
    points: customer.points,
    purchase_count: customer.purchase_count,
    net_spent: customer.net_spent
  });
});

router.get('/', requireAdmin, (req, res) => {
  const customers = listCustomersWithLoyalty(db);
  const tierCounts = TIERS.reduce((acc, t) => ({ ...acc, [t.name]: 0 }), { Pending: 0 });
  customers.forEach(c => { tierCounts[c.tier] += 1; });
  res.render('customers/list', { title: 'Customer Loyalty', customers, tierCounts, TIERS });
});

router.get('/:id', requireAdmin, (req, res) => {
  const customer = getCustomerWithLoyalty(db, req.params.id);
  if (!customer) return res.status(404).render('errors/404', { title: 'Not Found' });

  const receipts = db.prepare(`
    SELECT r.*, u.name AS cashier_name FROM receipts r
    JOIN users u ON u.id = r.user_id
    WHERE r.customer_id = ? ORDER BY r.created_at DESC
  `).all(req.params.id);

  res.render('customers/view', { title: customer.name, customer, receipts });
});

module.exports = router;
