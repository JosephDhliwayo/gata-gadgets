function getEcocashBalance(db) {
  const received = db.prepare(`
    SELECT COALESCE(SUM(rp.amount), 0) AS total
    FROM receipt_payments rp JOIN receipts r ON r.id = rp.receipt_id
    WHERE rp.payment_method = 'ecocash_usd' AND r.status = 'completed'
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
