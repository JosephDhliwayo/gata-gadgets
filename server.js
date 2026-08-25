const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const db = require('./db/database');
const { requireLogin } = require('./middleware/auth');
const { getPublicKey } = require('./lib/push');
const { getEcocashBalance } = require('./lib/ecocash');
const { getCourierBalance } = require('./lib/courier');
const { getPeriodFinancials, getProfitLossSeries } = require('./lib/analytics');
const { formatDate, formatDateTime, formatTime, formatMonth } = require('./lib/format');

const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const receiptRoutes = require('./routes/receipts');
const expenseRoutes = require('./routes/expenses');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const returnRoutes = require('./routes/returns');
const customerRoutes = require('./routes/customers');
const chatRoutes = require('./routes/chat');
const announcementRoutes = require('./routes/announcements');
const pushRoutes = require('./routes/push');
const ecocashRoutes = require('./routes/ecocash');
const leaveRoutes = require('./routes/leave');
const discountRoutes = require('./routes/discounts');
const courierRoutes = require('./routes/courier');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable must be set when NODE_ENV=production.');
  process.exit(1);
}

app.set('trust proxy', 1); // required for secure cookies to work correctly behind Caddy/nginx

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secret: process.env.SESSION_SECRET || 'gata-gadgets-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    secure: isProduction,
    sameSite: 'lax'
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.companyName = 'GATA GADGETS';
  res.locals.formatDate = formatDate;
  res.locals.formatDateTime = formatDateTime;
  res.locals.formatTime = formatTime;
  res.locals.formatMonth = formatMonth;

  if (req.session.user) {
    const uid = req.session.user.id;
    res.locals.unreadChatCount = db.prepare(`
      SELECT COUNT(*) AS c FROM chat_messages WHERE recipient_id = ? AND read_at IS NULL
    `).get(uid).c;

    res.locals.unreadAnnouncementCount = db.prepare(`
      SELECT COUNT(*) AS c FROM announcements a
      WHERE NOT EXISTS (SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?)
    `).get(uid).c;

    if (req.session.user.role === 'admin') {
      res.locals.pendingLeaveCount = db.prepare(`
        SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending'
      `).get().c;

      res.locals.pendingDiscountCount = db.prepare(`
        SELECT COUNT(*) AS c FROM discount_requests WHERE status = 'pending'
      `).get().c;
    }
  }
  next();
});

app.use('/', authRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/receipts', receiptRoutes);
app.use('/expenses', expenseRoutes);
app.use('/reports', reportRoutes);
app.use('/users', userRoutes);
app.use('/returns', returnRoutes);
app.use('/customers', customerRoutes);
app.use('/chat', chatRoutes);
app.use('/announcements', announcementRoutes);
app.use('/push', pushRoutes);
app.use('/ecocash', ecocashRoutes);
app.use('/leave', leaveRoutes);
app.use('/discounts', discountRoutes);
app.use('/courier', courierRoutes);

app.get('/', requireLogin, (req, res) => {
  if (req.session.user.role !== 'admin') {
    // Cashiers only work within New Receipt, Returns, Chat, and Announcements — no dashboard.
    return res.redirect('/receipts/new');
  }
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  const weekStart = (() => {
    const dt = new Date(`${today}T00:00:00Z`);
    const dow = dt.getUTCDay(); // 0 = Sunday .. 6 = Saturday
    const diff = dow === 0 ? -6 : 1 - dow;
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt.toISOString().slice(0, 10);
  })();

  const receiptsToday = db.prepare(`
    SELECT COUNT(*) AS count FROM receipts WHERE status = 'completed' AND date(created_at) = date(?)
  `).get(today).count;

  const stockValue = db.prepare(`SELECT COALESCE(SUM(quantity * cost_price),0) AS value FROM products WHERE active = 1`).get().value;
  const lowStock = db.prepare(`SELECT * FROM products WHERE active = 1 AND quantity <= reorder_level ORDER BY quantity ASC LIMIT 8`).all();

  const pendingReturns = db.prepare(`SELECT COUNT(*) AS c FROM return_requests WHERE status = 'pending'`).get().c;

  const courierBalance = getCourierBalance(db).balance;
  const ecocashBalance = getEcocashBalance(db).balance;

  const latestAnnouncements = db.prepare(`
    SELECT a.*, u.name AS posted_by_name FROM announcements a
    JOIN users u ON u.id = a.posted_by
    ORDER BY a.created_at DESC LIMIT 3
  `).all();

  const todayFinancials = getPeriodFinancials(db, today, today);
  const weekFinancials = getPeriodFinancials(db, weekStart, today);
  const monthFinancials = getPeriodFinancials(db, monthStart, today);
  const plSeries = getProfitLossSeries(db);

  const vapidPublicKey = getPublicKey();
  const pushSubscribed = db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?').get(req.session.user.id).c > 0;

  res.render('dashboard', {
    title: 'Dashboard', receiptsToday, stockValue, lowStock, pendingReturns, courierBalance, ecocashBalance,
    latestAnnouncements, plSeries,
    todaySales: todayFinancials.sales, todayProfit: todayFinancials.profit,
    weeklySales: weekFinancials.sales, weeklyProfit: weekFinancials.profit,
    monthlySales: monthFinancials.sales, monthlyProfit: monthFinancials.profit,
    vapidPublicKey, pushSubscribed
  });
});

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Not Found' });
});

app.listen(PORT, () => {
  console.log(`GATA GADGETS app running at http://localhost:${PORT}`);
});
