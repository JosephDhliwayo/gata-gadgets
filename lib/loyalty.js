// Loyalty scoring: blends total amount spent (net of approved returns), purchase
// regularity (distinct calendar months with a purchase), and purchase quality
// (bonus for higher-value baskets) into a single points total and tier.
//
// A customer only becomes eligible for points at all once their purchases have
// contributed at least PROFIT_ELIGIBILITY_THRESHOLD in gross profit to the business —
// below that they sit in the 'Pending' pseudo-tier with 0 points, regardless of spend.
const QUALITY_THRESHOLD = 100; // receipt total at/above this counts as a "quality" purchase
const QUALITY_BONUS = 5; // points per quality purchase
const REGULARITY_BONUS = 10; // points per distinct calendar month with a purchase
const PROFIT_ELIGIBILITY_THRESHOLD = 500; // cumulative profit contribution required before points accrue

const TIERS = [
  { name: 'Platinum', min: 1500 },
  { name: 'Gold', min: 600 },
  { name: 'Silver', min: 250 },
  { name: 'Bronze', min: 0 }
];

function tierForPoints(points) {
  return TIERS.find(t => points >= t.min).name;
}

const METRICS_SQL = `
  SELECT c.id, c.name, c.phone, c.email, c.created_at,
    COALESCE(rs.purchase_count, 0) AS purchase_count,
    COALESCE(rs.gross_spent, 0) AS gross_spent,
    COALESCE(rt.returns_value, 0) AS returns_value,
    ROUND(COALESCE(rs.gross_spent, 0) - COALESCE(rt.returns_value, 0), 2) AS net_spent,
    COALESCE(rs.quality_bonus, 0) AS quality_bonus,
    COALESCE(rm.months_active, 0) AS months_active,
    ROUND(COALESCE(rp.gross_profit, 0) - COALESCE(rt.returns_profit, 0), 2) AS profit_contribution,
    rs.first_purchase_at, rs.last_purchase_at
  FROM customers c
  LEFT JOIN (
    SELECT customer_id,
      COUNT(*) AS purchase_count,
      SUM(total) AS gross_spent,
      SUM(CASE WHEN total >= ${QUALITY_THRESHOLD} THEN ${QUALITY_BONUS} ELSE 0 END) AS quality_bonus,
      MIN(created_at) AS first_purchase_at,
      MAX(created_at) AS last_purchase_at
    FROM receipts WHERE status = 'completed' AND customer_id IS NOT NULL
    GROUP BY customer_id
  ) rs ON rs.customer_id = c.id
  LEFT JOIN (
    SELECT r.customer_id, COUNT(DISTINCT strftime('%Y-%m', r.created_at)) AS months_active
    FROM receipts r WHERE r.status = 'completed' AND r.customer_id IS NOT NULL
    GROUP BY r.customer_id
  ) rm ON rm.customer_id = c.id
  LEFT JOIN (
    SELECT r.customer_id, SUM((ri.unit_price - ri.unit_cost) * ri.quantity) AS gross_profit
    FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id
    WHERE r.status = 'completed' AND r.customer_id IS NOT NULL
    GROUP BY r.customer_id
  ) rp ON rp.customer_id = c.id
  LEFT JOIN (
    SELECT r.customer_id,
      SUM(rri.quantity * rri.unit_price) AS returns_value,
      SUM(rri.quantity * (rri.unit_price - rri.unit_cost)) AS returns_profit
    FROM return_requests rr
    JOIN return_request_items rri ON rri.return_request_id = rr.id
    JOIN receipts r ON r.id = rr.receipt_id
    WHERE rr.status = 'approved' AND r.customer_id IS NOT NULL
    GROUP BY r.customer_id
  ) rt ON rt.customer_id = c.id
`;

function withLoyalty(row) {
  if (row.profit_contribution < PROFIT_ELIGIBILITY_THRESHOLD) {
    return { ...row, regularity_bonus: 0, points: 0, tier: 'Pending' };
  }
  const regularityBonus = row.months_active * REGULARITY_BONUS;
  const points = Math.max(0, Math.floor(row.net_spent)) + row.quality_bonus + regularityBonus;
  return {
    ...row,
    regularity_bonus: regularityBonus,
    points,
    tier: tierForPoints(points)
  };
}

function listCustomersWithLoyalty(db) {
  const rows = db.prepare(`${METRICS_SQL} ORDER BY c.name`).all();
  return rows.map(withLoyalty).sort((a, b) => b.points - a.points);
}

function getCustomerWithLoyalty(db, customerId) {
  const row = db.prepare(`${METRICS_SQL} WHERE c.id = ?`).get(customerId);
  return row ? withLoyalty(row) : null;
}

function findCustomerByPhoneWithLoyalty(db, phone) {
  const customer = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
  if (!customer) return null;
  return getCustomerWithLoyalty(db, customer.id);
}

module.exports = {
  TIERS,
  QUALITY_THRESHOLD,
  QUALITY_BONUS,
  REGULARITY_BONUS,
  PROFIT_ELIGIBILITY_THRESHOLD,
  tierForPoints,
  listCustomersWithLoyalty,
  getCustomerWithLoyalty,
  findCustomerByPhoneWithLoyalty
};
