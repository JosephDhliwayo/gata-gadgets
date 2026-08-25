const express = require('express');
const db = require('../db/database');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/', (req, res) => {
  const announcements = db.prepare(`
    SELECT a.*, u.name AS posted_by_name,
      EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?) AS is_read
    FROM announcements a
    JOIN users u ON u.id = a.posted_by
    ORDER BY a.created_at DESC
  `).all(req.session.user.id);

  const markRead = db.prepare(`
    INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)
  `);
  const tx = db.transaction(() => {
    for (const a of announcements) markRead.run(a.id, req.session.user.id);
  });
  tx();

  res.render('announcements/list', { title: 'Announcements', announcements });
});

router.get('/new', requireAdmin, (req, res) => {
  res.render('announcements/form', { title: 'New Announcement', error: null, formData: null });
});

router.post('/', requireAdmin, (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) {
    return res.status(400).render('announcements/form', { title: 'New Announcement', error: 'Title and message are required.', formData: req.body });
  }
  db.prepare('INSERT INTO announcements (title, body, posted_by) VALUES (?, ?, ?)')
    .run(title.trim(), body.trim(), req.session.user.id);
  res.redirect('/announcements');
});

router.post('/:id/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM announcement_reads WHERE announcement_id = ?').run(req.params.id);
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.redirect('/announcements');
});

module.exports = router;
