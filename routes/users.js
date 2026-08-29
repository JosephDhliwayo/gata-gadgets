const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { getPeriodFinancials } = require('../lib/analytics');

const router = express.Router();
router.use(requireAdmin);

router.get('/', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.clock_in_id, u.role, u.active, u.commission_rate, u.created_at,
      COUNT(r.id) AS receipt_count,
      COALESCE(SUM(CASE WHEN r.status = 'completed' THEN r.total ELSE 0 END), 0) AS total_sales,
      MAX(r.created_at) AS last_sale_at
    FROM users u
    LEFT JOIN receipts r ON r.user_id = u.id AND r.status = 'completed'
    GROUP BY u.id
    ORDER BY u.name
  `).all();

  const stats = users.reduce((acc, u) => {
    acc.total += 1;
    if (u.active) acc.active += 1; else acc.disabled += 1;
    if (u.role === 'admin') acc.admins += 1; else acc.cashiers += 1;
    return acc;
  }, { total: 0, active: 0, disabled: 0, admins: 0, cashiers: 0 });

  const today = new Date().toISOString().slice(0, 10);
  const activeToday = db.prepare(`
    SELECT COUNT(DISTINCT user_id) AS c FROM receipts WHERE status = 'completed' AND date(created_at) = date(?)
  `).get(today).c;

  const weekStart = (() => {
    const dt = new Date(`${today}T00:00:00Z`);
    const dow = dt.getUTCDay(); // 0 = Sunday .. 6 = Saturday
    const diff = dow === 0 ? -6 : 1 - dow;
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt.toISOString().slice(0, 10);
  })();
  const monthStart = today.slice(0, 7) + '-01';

  const topPerformers = [...users]
    .filter(u => u.receipt_count > 0)
    .map(u => ({
      ...u,
      todayProfit: getPeriodFinancials(db, today, today, u.id).profit,
      weekProfit: getPeriodFinancials(db, weekStart, today, u.id).profit,
      monthProfit: getPeriodFinancials(db, monthStart, today, u.id).profit
    }))
    .sort((a, b) => b.monthProfit - a.monthProfit)
    .slice(0, 5);

  res.render('users/list', {
    title: 'Manage Users', users, stats, activeToday, topPerformers,
    error: req.query.error || null, success: req.query.success || null
  });
});

function suggestNextClockInId() {
  const rows = db.prepare("SELECT clock_in_id FROM users WHERE clock_in_id GLOB '[0-9]*'").all();
  const maxNumeric = rows.reduce((max, r) => {
    const n = parseInt(r.clock_in_id, 10);
    return !isNaN(n) && n > max ? n : max;
  }, 0);
  return String(maxNumeric + 1).padStart(3, '0');
}

router.get('/new', (req, res) => {
  res.render('users/form', { title: 'Add User', error: null, formData: { clock_in_id: suggestNextClockInId() } });
});

router.post('/', (req, res) => {
  const { name, email, clock_in_id, password, role } = req.body;
  const cleanClockInId = (clock_in_id || '').trim();
  if (!name || !email || !cleanClockInId || !password || password.length < 6) {
    return res.status(400).render('users/form', {
      title: 'Add User', formData: req.body,
      error: 'Name, email, a Clock-in ID, and a password of at least 6 characters are required.'
    });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (name, email, clock_in_id, password, role) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), cleanClockInId, hash, role === 'admin' ? 'admin' : 'user');
    res.redirect('/users');
  } catch (err) {
    const isUnique = String(err.message || '').includes('UNIQUE');
    const isEmail = isUnique && String(err.message || '').includes('users.email');
    const msg = isUnique
      ? (isEmail ? 'A user with that email already exists.' : 'That Clock-in ID is already assigned to another user.')
      : 'Could not create user.';
    res.status(400).render('users/form', { title: 'Add User', error: msg, formData: req.body });
  }
});

router.post('/:id/toggle-active', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (user) {
    if (user.id === req.session.user.id) {
      return res.redirect('/users');
    }
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(user.active ? 0 : 1, user.id);
  }
  res.redirect('/users');
});

router.post('/:id/delete', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.redirect('/users');

  if (user.id === req.session.user.id) {
    return res.redirect('/users?error=' + encodeURIComponent('You cannot delete your own account.'));
  }

  if (user.role === 'admin') {
    const otherAdmins = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id != ?`).get(user.id).c;
    if (otherAdmins === 0) {
      return res.redirect('/users?error=' + encodeURIComponent('Cannot delete the last administrator account.'));
    }
  }

  const activity = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM receipts WHERE user_id = ?) AS receipts,
      (SELECT COUNT(*) FROM expenses WHERE recorded_by = ?) AS expenses,
      (SELECT COUNT(*) FROM stock_adjustments WHERE recorded_by = ?) AS stock_adjustments,
      (SELECT COUNT(*) FROM chat_messages WHERE sender_id = ? OR recipient_id = ?) AS chat_messages,
      (SELECT COUNT(*) FROM announcements WHERE posted_by = ?) AS announcements,
      (SELECT COUNT(*) FROM return_requests WHERE requested_by = ? OR reviewed_by = ?) AS return_requests
  `).get(user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id);

  const hasActivity = Object.values(activity).some(c => c > 0);
  if (hasActivity) {
    return res.redirect('/users?error=' + encodeURIComponent(
      `${user.name} has activity on record (sales, messages, or other history) and can't be permanently deleted, since that would break receipts, reports, and audit trails. Disable the account instead to remove their access while keeping history intact.`
    ));
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.redirect('/users?success=' + encodeURIComponent(`${user.name} was permanently deleted.`));
});

router.post('/:id/clock-in-id', (req, res) => {
  const cleanClockInId = (req.body.clock_in_id || '').trim();
  if (!cleanClockInId) {
    return res.redirect('/users?error=' + encodeURIComponent('Clock-in ID cannot be empty.'));
  }
  try {
    db.prepare('UPDATE users SET clock_in_id = ? WHERE id = ?').run(cleanClockInId, req.params.id);
    res.redirect('/users');
  } catch (err) {
    const msg = String(err.message || '').includes('UNIQUE')
      ? 'That Clock-in ID is already assigned to another user.'
      : 'Could not update Clock-in ID.';
    res.redirect('/users?error=' + encodeURIComponent(msg));
  }
});

router.post('/:id/commission', (req, res) => {
  let rate = parseFloat(req.body.commission_rate);
  if (isNaN(rate)) rate = 0;
  rate = Math.max(0, Math.min(100, Math.round(rate * 100) / 100));
  db.prepare('UPDATE users SET commission_rate = ? WHERE id = ?').run(rate, req.params.id);
  res.redirect('/users');
});

router.post('/:id/reset-password', (req, res) => {
  const { password } = req.body;
  if (password && password.length >= 6) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.params.id);
  }
  res.redirect('/users');
});

module.exports = router;
