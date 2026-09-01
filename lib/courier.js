function getCourierBalance(db) {
  const sold = db.prepare(`
    SELECT COALESCE(SUM(rp.amount), 0) AS total
    FROM receipt_payments rp JOIN receipts r ON r.id = rp.receipt_id
    WHERE rp.payment_method = 'courier' AND r.status = 'completed'
  `).get().total;

  const collected = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM courier_collections
  `).get().total;

  return {
    sold: Math.round(sold * 100) / 100,
    collected: Math.round(collected * 100) / 100,
    balance: Math.round((sold - collected) * 100) / 100
  };
}

module.exports = { getCourierBalance };
