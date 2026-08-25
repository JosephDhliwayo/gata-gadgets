const express = require('express');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

function defaultRange() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(today) };
}

router.get('/sales', (req, res) => {
  const { from, to } = { ...defaultRange(), ...req.query };

  const receipts = db.prepare(`
    SELECT r.*, u.name AS cashier_name FROM receipts r
    JOIN users u ON u.id = r.user_id
    WHERE r.status = 'completed' AND date(r.created_at) BETWEEN date(?) AND date(?)
    ORDER BY r.created_at DESC
  `).all(from, to);

  const totals = receipts.reduce((acc, r) => {
    acc.total += r.total;
    return acc;
  }, { total: 0 });

  const byProduct = db.prepare(`
    SELECT ri.product_name, SUM(ri.quantity) AS qty_sold, SUM(ri.line_total) AS revenue
    FROM receipt_items ri
    JOIN receipts r ON r.id = ri.receipt_id
    WHERE r.status = 'completed' AND date(r.created_at) BETWEEN date(?) AND date(?)
    GROUP BY ri.product_name
    ORDER BY revenue DESC
  `).all(from, to);

  const byCashier = db.prepare(`
    SELECT u.name AS cashier_name, COUNT(r.id) AS receipt_count, SUM(r.total) AS revenue
    FROM receipts r JOIN users u ON u.id = r.user_id
    WHERE r.status = 'completed' AND date(r.created_at) BETWEEN date(?) AND date(?)
    GROUP BY u.id ORDER BY revenue DESC
  `).all(from, to);

  const returns = db.prepare(`
    SELECT rr.id, rr.reviewed_at, r.receipt_number, u.name AS requested_by_name,
      SUM(rri.quantity * rri.unit_price) AS return_value
    FROM return_requests rr
    JOIN return_request_items rri ON rri.return_request_id = rr.id
    JOIN receipts r ON r.id = rr.receipt_id
    JOIN users u ON u.id = rr.requested_by
    WHERE rr.status = 'approved' AND date(rr.reviewed_at) BETWEEN date(?) AND date(?)
    GROUP BY rr.id
    ORDER BY rr.reviewed_at DESC
  `).all(from, to);
  const totalReturns = returns.reduce((s, r) => s + r.return_value, 0);

  const approvedDiscounts = db.prepare(`
    SELECT COALESCE(SUM(dr.discount_amount), 0) AS total, COUNT(*) AS count
    FROM discount_requests dr
    JOIN receipts r ON r.id = dr.receipt_id
    WHERE dr.status = 'approved' AND date(r.created_at) BETWEEN date(?) AND date(?)
  `).get(from, to);

  res.render('reports/sales', {
    title: 'Sales Report', receipts, totals, byProduct, byCashier, returns, totalReturns, approvedDiscounts, from, to
  });
});

router.get('/stock-valuation', (req, res) => {
  const products = db.prepare(`
    SELECT *, (quantity * cost_price) AS value_at_cost, (quantity * selling_price) AS value_at_retail
    FROM products WHERE active = 1 ORDER BY category, name
  `).all();

  const totals = products.reduce((acc, p) => {
    acc.units += p.quantity;
    acc.cost += p.value_at_cost;
    acc.retail += p.value_at_retail;
    return acc;
  }, { units: 0, cost: 0, retail: 0 });

  const lowStock = products.filter(p => p.quantity <= p.reorder_level);

  res.render('reports/stock-valuation', { title: 'Stock Valuation', products, totals, lowStock, generatedAt: new Date().toISOString() });
});

router.get('/profit-loss', (req, res) => {
  const { from, to } = { ...defaultRange(), ...req.query };

  const salesRow = db.prepare(`
    SELECT COALESCE(SUM(r.subtotal),0) AS revenue
    FROM receipts r WHERE r.status = 'completed' AND date(r.created_at) BETWEEN date(?) AND date(?)
  `).get(from, to);

  const cogsRow = db.prepare(`
    SELECT COALESCE(SUM(ri.unit_cost * ri.quantity),0) AS cogs
    FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id
    WHERE r.status = 'completed' AND date(r.created_at) BETWEEN date(?) AND date(?)
  `).get(from, to);

  const expensesByCategory = db.prepare(`
    SELECT category, COALESCE(SUM(amount),0) AS total
    FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)
    GROUP BY category ORDER BY total DESC
  `).all(from, to);

  const totalExpenses = expensesByCategory.reduce((s, e) => s + e.total, 0);

  const returnsRow = db.prepare(`
    SELECT
      COALESCE(SUM(rri.quantity * rri.unit_price), 0) AS returns_value,
      COALESCE(SUM(rri.quantity * rri.unit_cost), 0) AS returns_cogs
    FROM return_requests rr
    JOIN return_request_items rri ON rri.return_request_id = rr.id
    WHERE rr.status = 'approved' AND date(rr.reviewed_at) BETWEEN date(?) AND date(?)
  `).get(from, to);

  const grossRevenue = salesRow.revenue;
  const salesReturns = returnsRow.returns_value;
  const revenue = grossRevenue - salesReturns;

  const grossCogs = cogsRow.cogs;
  const returnsCogs = returnsRow.returns_cogs;
  const cogs = grossCogs - returnsCogs;

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - totalExpenses;

  res.render('reports/profit-loss', {
    title: 'Profit & Loss Statement',
    from, to, grossRevenue, salesReturns, revenue, grossCogs, returnsCogs, cogs, grossProfit,
    expensesByCategory, totalExpenses, netProfit
  });
});

function defaultTrendRange() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 89);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(today) };
}

// Monday (as an ISO date string) of the week containing the given YYYY-MM-DD day string.
function mondayOf(dayStr) {
  const dt = new Date(`${dayStr}T00:00:00Z`);
  const dow = dt.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

router.get('/performance', (req, res) => {
  const { from, to } = { ...defaultTrendRange(), ...req.query };

  const salesByDay = db.prepare(`
    SELECT date(created_at) AS day, SUM(subtotal) AS revenue
    FROM receipts WHERE status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)
    GROUP BY day
  `).all(from, to);

  const cogsByDay = db.prepare(`
    SELECT date(r.created_at) AS day, SUM(ri.unit_cost * ri.quantity) AS cogs
    FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id
    WHERE r.status = 'completed' AND date(r.created_at) BETWEEN date(?) AND date(?)
    GROUP BY day
  `).all(from, to);

  const returnsByDay = db.prepare(`
    SELECT date(rr.reviewed_at) AS day,
      SUM(rri.quantity * rri.unit_price) AS return_value,
      SUM(rri.quantity * rri.unit_cost) AS return_cogs
    FROM return_requests rr
    JOIN return_request_items rri ON rri.return_request_id = rr.id
    WHERE rr.status = 'approved' AND date(rr.reviewed_at) BETWEEN date(?) AND date(?)
    GROUP BY day
  `).all(from, to);

  const expensesByDay = db.prepare(`
    SELECT expense_date AS day, SUM(amount) AS amount
    FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)
    GROUP BY expense_date
  `).all(from, to);

  const dayMap = new Map();
  const ensureDay = (day) => {
    if (!dayMap.has(day)) dayMap.set(day, { day, revenue: 0, cogs: 0, returnsValue: 0, returnsCogs: 0, expenses: 0 });
    return dayMap.get(day);
  };
  salesByDay.forEach(r => { ensureDay(r.day).revenue += r.revenue; });
  cogsByDay.forEach(r => { ensureDay(r.day).cogs += r.cogs; });
  returnsByDay.forEach(r => { const d = ensureDay(r.day); d.returnsValue += r.return_value; d.returnsCogs += r.return_cogs; });
  expensesByDay.forEach(r => { ensureDay(r.day).expenses += r.amount; });

  const daily = [...dayMap.values()].map(d => {
    const netRevenue = d.revenue - d.returnsValue;
    const netCogs = d.cogs - d.returnsCogs;
    return { period: d.day, sales: netRevenue, profit: netRevenue - netCogs - d.expenses };
  }).sort((a, b) => b.period.localeCompare(a.period));

  const aggregate = (keyFn) => {
    const map = new Map();
    daily.forEach(d => {
      const key = keyFn(d.period);
      if (!map.has(key)) map.set(key, { period: key, sales: 0, profit: 0 });
      const bucket = map.get(key);
      bucket.sales += d.sales;
      bucket.profit += d.profit;
    });
    return [...map.values()].sort((a, b) => b.period.localeCompare(a.period));
  };

  const weekly = aggregate(mondayOf);
  const monthly = aggregate(day => day.slice(0, 7));

  // Per-user monthly gross profit (revenue minus COGS, net of that user's returns; not allocated
  // a share of business-wide expenses since those aren't attributable to any one cashier).
  const usersById = new Map(db.prepare('SELECT id, name, commission_rate FROM users').all().map(u => [u.id, u]));

  const salesByDayUser = db.prepare(`
    SELECT date(created_at) AS day, user_id, SUM(subtotal) AS revenue
    FROM receipts WHERE status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)
    GROUP BY day, user_id
  `).all(from, to);

  const cogsByDayUser = db.prepare(`
    SELECT date(r.created_at) AS day, r.user_id, SUM(ri.unit_cost * ri.quantity) AS cogs
    FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id
    WHERE r.status = 'completed' AND date(r.created_at) BETWEEN date(?) AND date(?)
    GROUP BY day, r.user_id
  `).all(from, to);

  const returnsByDayUser = db.prepare(`
    SELECT date(rr.reviewed_at) AS day, r.user_id,
      SUM(rri.quantity * rri.unit_price) AS return_value,
      SUM(rri.quantity * rri.unit_cost) AS return_cogs
    FROM return_requests rr
    JOIN return_request_items rri ON rri.return_request_id = rr.id
    JOIN receipts r ON r.id = rr.receipt_id
    WHERE rr.status = 'approved' AND date(rr.reviewed_at) BETWEEN date(?) AND date(?)
    GROUP BY day, r.user_id
  `).all(from, to);

  const userMonthMap = new Map();
  const ensureUserMonth = (day, userId) => {
    const month = day.slice(0, 7);
    const key = `${month}|${userId}`;
    if (!userMonthMap.has(key)) userMonthMap.set(key, { month, userId, revenue: 0, cogs: 0, returnsValue: 0, returnsCogs: 0 });
    return userMonthMap.get(key);
  };
  salesByDayUser.forEach(r => { ensureUserMonth(r.day, r.user_id).revenue += r.revenue; });
  cogsByDayUser.forEach(r => { ensureUserMonth(r.day, r.user_id).cogs += r.cogs; });
  returnsByDayUser.forEach(r => {
    const b = ensureUserMonth(r.day, r.user_id);
    b.returnsValue += r.return_value;
    b.returnsCogs += r.return_cogs;
  });

  const perUserMonthly = [...userMonthMap.values()]
    .map(u => {
      const netRevenue = u.revenue - u.returnsValue;
      const netCogs = u.cogs - u.returnsCogs;
      const profit = netRevenue - netCogs;
      const userInfo = usersById.get(u.userId);
      const commissionRate = userInfo ? userInfo.commission_rate : 0;
      return {
        month: u.month,
        userName: userInfo ? userInfo.name : 'Unknown',
        revenue: netRevenue, cogs: netCogs, profit,
        commissionRate,
        commission: Math.max(0, profit) * (commissionRate / 100)
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month) || b.profit - a.profit);

  res.render('reports/performance', { title: 'Performance', from, to, daily, weekly, monthly, perUserMonthly });
});

router.get('/attendance', (req, res) => {
  const { from, to } = { ...defaultRange(), ...req.query };

  const rows = db.prepare(`
    SELECT le.user_id, u.name AS user_name, date(le.created_at) AS day,
      MIN(CASE WHEN le.event = 'login' THEN le.created_at END) AS clock_in,
      MAX(CASE WHEN le.event = 'logout' THEN le.created_at END) AS clock_out
    FROM login_events le
    JOIN users u ON u.id = le.user_id
    WHERE date(le.created_at) BETWEEN date(?) AND date(?)
    GROUP BY le.user_id, date(le.created_at)
    ORDER BY day DESC, u.name
  `).all(from, to);

  const entries = rows.map(r => {
    let hours = null;
    if (r.clock_in && r.clock_out && r.clock_out > r.clock_in) {
      hours = (new Date(r.clock_out.replace(' ', 'T') + 'Z') - new Date(r.clock_in.replace(' ', 'T') + 'Z')) / 3600000;
    }
    return { ...r, hours };
  });

  res.render('reports/attendance', { title: 'Attendance', entries, from, to });
});

module.exports = router;
