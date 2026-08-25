const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Net sales (revenue minus approved returns) and net profit (sales minus COGS minus expenses)
// for an arbitrary date range — shared by dashboard stat cards and the profit & loss trend chart.
function getPeriodFinancials(db, from, to) {
  const revenueRow = db.prepare(`
    SELECT COALESCE(SUM(subtotal), 0) AS revenue FROM receipts
    WHERE status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)
  `).get(from, to);

  const cogsRow = db.prepare(`
    SELECT COALESCE(SUM(ri.unit_cost * ri.quantity), 0) AS cogs
    FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id
    WHERE r.status = 'completed' AND date(r.created_at) BETWEEN date(?) AND date(?)
  `).get(from, to);

  const returnsRow = db.prepare(`
    SELECT
      COALESCE(SUM(rri.quantity * rri.unit_price), 0) AS returns_value,
      COALESCE(SUM(rri.quantity * rri.unit_cost), 0) AS returns_cogs
    FROM return_requests rr
    JOIN return_request_items rri ON rri.return_request_id = rr.id
    WHERE rr.status = 'approved' AND date(rr.reviewed_at) BETWEEN date(?) AND date(?)
  `).get(from, to);

  const expensesRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)
  `).get(from, to);

  const sales = revenueRow.revenue - returnsRow.returns_value;
  const cogs = cogsRow.cogs - returnsRow.returns_cogs;
  return { sales, profit: sales - cogs - expensesRow.total };
}

function addDaysISO(dateStr, days) {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function isoWeekStart(dateStr) {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  const dow = dt.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function buildDailyBuckets(count) {
  const today = new Date().toISOString().slice(0, 10);
  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = addDaysISO(today, -i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    buckets.push({ label: `${DAY_LABELS[dow]} ${date.slice(8, 10)}`, from: date, to: date });
  }
  return buckets;
}

function buildWeeklyBuckets(count) {
  const today = new Date().toISOString().slice(0, 10);
  const thisWeekStart = isoWeekStart(today);
  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    const from = addDaysISO(thisWeekStart, -7 * i);
    const to = addDaysISO(from, 6);
    const [, mm, dd] = from.split('-');
    buckets.push({ label: `${dd}/${mm}`, from, to });
  }
  return buckets;
}

function buildMonthlyBuckets(count) {
  const today = new Date().toISOString().slice(0, 10);
  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    dt.setUTCMonth(dt.getUTCMonth() - i);
    const from = dt.toISOString().slice(0, 10);
    const nextMonth = new Date(dt);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const to = addDaysISO(nextMonth.toISOString().slice(0, 10), -1);
    const label = `${MONTH_LABELS[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}`;
    buckets.push({ label, from, to });
  }
  return buckets;
}

function buildSeries(db, buckets) {
  const labels = [];
  const sales = [];
  const profit = [];
  for (const b of buckets) {
    const financials = getPeriodFinancials(db, b.from, b.to);
    labels.push(b.label);
    sales.push(Math.round(financials.sales * 100) / 100);
    profit.push(Math.round(financials.profit * 100) / 100);
  }
  return { labels, sales, profit };
}

// Daily (last 14 days), weekly (last 8 weeks) and monthly (last 6 months) sales/profit
// trends for the admin dashboard's profit & loss line graph.
function getProfitLossSeries(db) {
  return {
    daily: buildSeries(db, buildDailyBuckets(14)),
    weekly: buildSeries(db, buildWeeklyBuckets(8)),
    monthly: buildSeries(db, buildMonthlyBuckets(6))
  };
}

module.exports = { getPeriodFinancials, getProfitLossSeries };
