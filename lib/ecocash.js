function getEcocashBalance(db) {
  const received = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total FROM receipts
    WHERE payment_method = 'ecocash_usd' AND status = 'completed'
  `).get().total;

  const withdrawn = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM ecocash_withdrawals
  `).get().total;

  return {
    received: Math.round(received * 100) / 100,
    withdrawn: Math.round(withdrawn * 100) / 100,
    balance: Math.round((received - withdrawn) * 100) / 100
  };
}

module.exports = { getEcocashBalance };
