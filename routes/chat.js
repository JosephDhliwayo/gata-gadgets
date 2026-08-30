const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

function renderThread(req, res, otherUserId) {
  const meId = req.session.user.id;
  if (String(otherUserId) === String(meId)) {
    return res.redirect('/chat');
  }

  const otherUser = db.prepare('SELECT id, name, role, active FROM users WHERE id = ?').get(otherUserId);
  if (!otherUser) return res.status(404).render('errors/404', { title: 'Not Found' });

  db.prepare(`
    UPDATE chat_messages SET read_at = datetime('now', '+2 hours')
    WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL
  `).run(otherUserId, meId);

  const messages = db.prepare(`
    SELECT cm.id, cm.sender_id, cm.body, cm.created_at, u.name AS sender_name
    FROM chat_messages cm JOIN users u ON u.id = cm.sender_id
    WHERE (cm.sender_id = ? AND cm.recipient_id = ?) OR (cm.sender_id = ? AND cm.recipient_id = ?)
    ORDER BY cm.created_at ASC
  `).all(meId, otherUserId, otherUserId, meId);

  res.render('chat/thread', {
    title: `Chat · ${otherUser.name}`,
    otherUser,
    messages
  });
}

// Any logged-in user — admin or cashier — can browse every teammate and start a chat with them.
router.get('/', (req, res) => {
  const meId = req.session.user.id;

  const colleagues = db.prepare(`
    SELECT u.id AS user_id, u.name, u.role, u.active,
      (SELECT body FROM chat_messages
        WHERE (sender_id = u.id AND recipient_id = ?) OR (sender_id = ? AND recipient_id = u.id)
        ORDER BY created_at DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM chat_messages
        WHERE (sender_id = u.id AND recipient_id = ?) OR (sender_id = ? AND recipient_id = u.id)
        ORDER BY created_at DESC LIMIT 1) AS last_message_at,
      (SELECT COUNT(*) FROM chat_messages WHERE sender_id = u.id AND recipient_id = ? AND read_at IS NULL) AS unread_count
    FROM users u
    WHERE u.id != ?
    ORDER BY (last_message_at IS NULL), last_message_at DESC, u.name
  `).all(meId, meId, meId, meId, meId, meId);

  res.render('chat/list', { title: 'Chat', colleagues });
});

router.get('/:userId', (req, res) => renderThread(req, res, req.params.userId));

router.post('/:userId', (req, res) => {
  const meId = req.session.user.id;
  const otherUserId = req.params.userId;
  if (String(otherUserId) === String(meId)) return res.redirect('/chat');

  const otherUser = db.prepare('SELECT id FROM users WHERE id = ?').get(otherUserId);
  if (!otherUser) return res.status(404).render('errors/404', { title: 'Not Found' });

  const body = (req.body.body || '').trim();
  if (body) {
    db.prepare(`
      INSERT INTO chat_messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, datetime('now', '+2 hours'))
    `).run(meId, otherUserId, body.slice(0, 2000));
  }

  res.redirect(`/chat/${otherUserId}`);
});

// Lightweight polling endpoint so an open thread picks up new messages without a full reload.
router.get('/:userId/messages', (req, res) => {
  const meId = req.session.user.id;
  const otherUserId = req.params.userId;
  const afterId = parseInt(req.query.after, 10) || 0;

  db.prepare(`
    UPDATE chat_messages SET read_at = datetime('now', '+2 hours')
    WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL
  `).run(otherUserId, meId);

  const messages = db.prepare(`
    SELECT cm.id, cm.sender_id, cm.body, cm.created_at, u.name AS sender_name
    FROM chat_messages cm JOIN users u ON u.id = cm.sender_id
    WHERE ((cm.sender_id = ? AND cm.recipient_id = ?) OR (cm.sender_id = ? AND cm.recipient_id = ?)) AND cm.id > ?
    ORDER BY cm.created_at ASC
  `).all(meId, otherUserId, otherUserId, meId, afterId);

  res.json({ messages });
});

module.exports = router;
