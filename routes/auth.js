const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { notifyAdmins } = require('../lib/push');

const router = express.Router();

function recordLoginEvent(userId, event) {
  db.prepare(`INSERT INTO login_events (user_id, event, created_at) VALUES (?, ?, datetime('now', '+2 hours'))`).run(userId, event);
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Login', error: null });
});

router.post('/login', (req, res) => {
  const mode = req.body.mode === 'admin' ? 'admin' : 'staff';
  let user = null;

  if (mode === 'staff') {
    // Staff clock in with their assigned Clock-in ID alone — no password. This path can only ever
    // match a 'user' role account, so a cashier's ID can never be used to reach an admin account.
    const clockInId = (req.body.clock_in_id || '').trim();
    user = db.prepare(`SELECT * FROM users WHERE clock_in_id = ? AND role = 'user' AND active = 1`).get(clockInId);
    if (!user) {
      return res.status(401).render('login', { title: 'Login', error: 'Invalid Clock-in ID.', lastMode: 'staff' });
    }
  } else {
    // Admins authenticate with email + password only.
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const candidate = db.prepare(`SELECT * FROM users WHERE email = ? AND role = 'admin' AND active = 1`).get(email);
    if (!candidate || !bcrypt.compareSync(password, candidate.password)) {
      return res.status(401).render('login', { title: 'Login', error: 'Invalid email or password.', lastMode: 'admin' });
    }
    user = candidate;
  }

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  recordLoginEvent(user.id, 'login');
  notifyAdmins({ title: 'GATA GADGETS', body: `${user.name} (${user.role}) logged in.` }).catch(() => {});

  const dest = req.session.returnTo || '/';
  delete req.session.returnTo;
  res.redirect(dest);
});

router.post('/logout', (req, res) => {
  const user = req.session.user;
  if (user) {
    recordLoginEvent(user.id, 'logout');
    notifyAdmins({ title: 'GATA GADGETS', body: `${user.name} (${user.role}) logged out.` }).catch(() => {});
  }
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
