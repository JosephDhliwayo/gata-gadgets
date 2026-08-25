const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { getPublicKey, saveSubscription, removeSubscription } = require('../lib/push');

const router = express.Router();
router.use(requireAdmin);

router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: getPublicKey() });
});

router.post('/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'Invalid subscription payload.' });
  }
  saveSubscription(req.session.user.id, subscription);
  res.json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) removeSubscription(endpoint);
  res.json({ ok: true });
});

module.exports = router;
