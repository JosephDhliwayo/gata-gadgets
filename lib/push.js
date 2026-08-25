const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const db = require('../db/database');

const vapidPath = process.env.GATA_VAPID_PATH || path.join(__dirname, '..', 'db', 'vapid.json');

function loadOrCreateVapidKeys() {
  if (fs.existsSync(vapidPath)) {
    return JSON.parse(fs.readFileSync(vapidPath, 'utf8'));
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidPath, JSON.stringify(keys, null, 2));
  return keys;
}

const vapidKeys = loadOrCreateVapidKeys();
webpush.setVapidDetails('mailto:admin@gatagadgets.com', vapidKeys.publicKey, vapidKeys.privateKey);

function getPublicKey() {
  return vapidKeys.publicKey;
}

function saveSubscription(userId, subscription) {
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
}

function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

// Sends a push notification to every subscribed admin. Best-effort: a browser can revoke or
// expire a subscription at any time, so failures just prune that one subscription and continue.
async function notifyAdmins(payload) {
  const subs = db.prepare(`
    SELECT ps.* FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id
    WHERE u.role = 'admin'
  `).all();

  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (sub) => {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };
    try {
      await webpush.sendNotification(pushSubscription, body);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        removeSubscription(sub.endpoint);
      }
    }
  }));
}

module.exports = { getPublicKey, saveSubscription, removeSubscription, notifyAdmins };
