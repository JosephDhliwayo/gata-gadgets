const express = require('express');
const db = require('../db/database');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { notifyAdmins } = require('../lib/push');

const router = express.Router();

router.use(requireLogin);

function generateReceiptNumber() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `GG-${stamp}-${rand}`;
}

function availableProducts() {
  return db.prepare('SELECT * FROM products WHERE active = 1 AND quantity > 0 ORDER BY name').all();
}

function knownCustomers() {
  return db.prepare('SELECT id, name, phone FROM customers ORDER BY name').all();
}

function knownCourierDestinations() {
  return db.prepare(`
    SELECT DISTINCT courier_destination FROM receipts
    WHERE courier_destination IS NOT NULL AND courier_destination != ''
    ORDER BY courier_destination
  `).all().map(r => r.courier_destination);
}

router.get('/new', (req, res) => {
  res.render('receipts/new', {
    title: 'New Receipt',
    products: availableProducts(),
    customers: knownCustomers(),
    courierDestinations: knownCourierDestinations(),
    error: null
  });
});

router.post('/', (req, res) => {
  let { customer_name, customer_phone, payment_method, cash_received, courier_destination, product_id, quantity, unit_price } = req.body;
  const productIds = Array.isArray(product_id) ? product_id : (product_id ? [product_id] : []);
  const quantities = Array.isArray(quantity) ? quantity : (quantity ? [quantity] : []);
  const unitPrices = Array.isArray(unit_price) ? unit_price : (unit_price ? [unit_price] : []);

  const rerender = (status, error) => res.status(status).render('receipts/new', {
    title: 'New Receipt', products: availableProducts(), customers: knownCustomers(),
    courierDestinations: knownCourierDestinations(), error
  });

  const cleanPhone = (customer_phone || '').trim() || null;
  if (!cleanPhone) {
    return rerender(400, 'A customer phone number is required to capture a receipt.');
  }

  const lines = [];
  for (let i = 0; i < productIds.length; i++) {
    const pid = parseInt(productIds[i], 10);
    const qty = parseInt(quantities[i], 10);
    if (!pid || !qty || qty <= 0) continue;
    const rawPrice = parseFloat(unitPrices[i]);
    const overridePrice = (!isNaN(rawPrice) && rawPrice >= 0) ? Math.round(rawPrice * 100) / 100 : null;
    lines.push({ pid, qty, overridePrice });
  }

  if (lines.length === 0) {
    return rerender(400, 'Add at least one valid product line.');
  }

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
  const items = [];
  let discountAmount = 0;
  const discountLines = [];
  for (const line of lines) {
    const product = getProduct.get(line.pid);
    if (!product) continue;
    if (product.quantity < line.qty) {
      return rerender(400, `Not enough stock for "${product.name}". Available: ${product.quantity}.`);
    }
    const unitPrice = line.overridePrice !== null ? line.overridePrice : product.selling_price;
    if (unitPrice < product.selling_price) {
      const lineDiscount = Math.round((product.selling_price - unitPrice) * line.qty * 100) / 100;
      discountAmount = Math.round((discountAmount + lineDiscount) * 100) / 100;
      discountLines.push(
        `${product.name}: catalog $${product.selling_price.toFixed(2)} -> sold $${unitPrice.toFixed(2)} (x${line.qty}) = $${lineDiscount.toFixed(2)} off`
      );
    }
    items.push({
      product_id: product.id,
      product_name: product.name,
      quantity: line.qty,
      unit_price: unitPrice,
      unit_cost: product.cost_price,
      line_total: Math.round(unitPrice * line.qty * 100) / 100
    });
  }

  const subtotal = Math.round(items.reduce((s, it) => s + it.line_total, 0) * 100) / 100;
  const total = subtotal;
  const receiptNumber = generateReceiptNumber();
  const validPaymentMethods = ['cash', 'bank_transfer', 'ecocash_usd', 'courier'];
  const cleanPaymentMethod = validPaymentMethods.includes(payment_method) ? payment_method : 'cash';

  let cashReceived = null;
  let changeDue = null;
  if (cleanPaymentMethod === 'cash') {
    cashReceived = Math.round((parseFloat(cash_received) || 0) * 100) / 100;
    if (cashReceived < total) {
      return rerender(400, `Cash received ($${cashReceived.toFixed(2)}) is less than the total due ($${total.toFixed(2)}).`);
    }
    changeDue = Math.round((cashReceived - total) * 100) / 100;
  }

  // Courier sales are credit sales: goods go out now, payment is collected later and
  // only an admin can clear the resulting trade receivable.
  const receivableStatus = cleanPaymentMethod === 'courier' ? 'outstanding' : null;

  const cleanCourierDestination = (courier_destination || '').trim() || null;
  if (cleanPaymentMethod === 'courier' && !cleanCourierDestination) {
    return rerender(400, 'A courier destination is required for courier sales.');
  }

  const cleanName = (customer_name || '').trim() || null;

  const tx = db.transaction(() => {
    // Link (or create) a customer record by phone number so purchases roll up into the loyalty program.
    let customerId;
    const existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(cleanPhone);
    if (existing) {
      customerId = existing.id;
      if (cleanName) db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(cleanName, existing.id);
    } else {
      const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(cleanName || 'Walk-in Customer', cleanPhone);
      customerId = info.lastInsertRowid;
    }

    const info = db.prepare(`
      INSERT INTO receipts (receipt_number, user_id, customer_id, customer_name, customer_phone, subtotal, total, payment_method, cash_received, change_due, receivable_status, courier_destination)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receiptNumber, req.session.user.id, customerId,
      cleanName, cleanPhone,
      subtotal, total, cleanPaymentMethod, cashReceived, changeDue, receivableStatus, cleanCourierDestination
    );
    const receiptId = info.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO receipt_items (receipt_id, product_id, product_name, quantity, unit_price, unit_cost, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const decrementStock = db.prepare(`UPDATE products SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?`);

    for (const it of items) {
      insertItem.run(receiptId, it.product_id, it.product_name, it.quantity, it.unit_price, it.unit_cost, it.line_total);
      decrementStock.run(it.quantity, it.product_id);
    }

    // A cashier selling below catalog price creates a pending discount for admin to review.
    // Admin's own price overrides don't need self-approval.
    let discountRequestId = null;
    if (discountAmount > 0 && req.session.user.role !== 'admin') {
      const discountInfo = db.prepare(`
        INSERT INTO discount_requests (receipt_id, requested_by, discount_amount, details)
        VALUES (?, ?, ?, ?)
      `).run(receiptId, req.session.user.id, discountAmount, discountLines.join('\n'));
      discountRequestId = discountInfo.lastInsertRowid;
    }

    return { receiptId, discountRequestId };
  });

  const { receiptId, discountRequestId } = tx();

  if (discountRequestId) {
    notifyAdmins({
      title: 'GATA GADGETS',
      body: `${req.session.user.name} gave a $${discountAmount.toFixed(2)} discount on receipt ${receiptNumber} — needs approval.`
    }).catch(() => {});
  }

  res.redirect(`/receipts/${receiptId}`);
});

router.get('/', (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  if (!isAdmin) {
    // Cashiers only work within New Receipt, Returns, Chat, and Announcements — no receipt history browsing.
    return res.redirect('/receipts/new');
  }
  const { from, to } = req.query;
  const clauses = [];
  const params = [];
  if (!isAdmin) {
    clauses.push('r.user_id = ?');
    params.push(req.session.user.id);
  }
  if (from) { clauses.push('date(r.created_at) >= date(?)'); params.push(from); }
  if (to) { clauses.push('date(r.created_at) <= date(?)'); params.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const receipts = db.prepare(`
    SELECT r.*, u.name AS cashier_name
    FROM receipts r JOIN users u ON u.id = r.user_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 300
  `).all(...params);

  res.render('receipts/list', { title: 'Receipts', receipts, from: from || '', to: to || '', isAdmin });
});

router.get('/:id', (req, res) => {
  const receipt = db.prepare(`
    SELECT r.*, u.name AS cashier_name
    FROM receipts r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!receipt) return res.status(404).render('errors/404', { title: 'Not Found' });
  if (req.session.user.role !== 'admin' && receipt.user_id !== req.session.user.id) {
    return res.status(403).render('errors/403', { title: 'Access Denied' });
  }
  const items = db.prepare('SELECT * FROM receipt_items WHERE receipt_id = ?').all(req.params.id);
  const discountRequest = db.prepare(`
    SELECT dr.*, ru.name AS reviewed_by_name FROM discount_requests dr
    LEFT JOIN users ru ON ru.id = dr.reviewed_by
    WHERE dr.receipt_id = ?
  `).get(req.params.id);
  res.render('receipts/view', { title: `Receipt ${receipt.receipt_number}`, receipt, items, discountRequest });
});

router.post('/:id/void', requireAdmin, (req, res) => {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (!receipt || receipt.status === 'void') return res.redirect('/receipts');
  const items = db.prepare('SELECT * FROM receipt_items WHERE receipt_id = ?').all(req.params.id);

  const tx = db.transaction(() => {
    db.prepare(`UPDATE receipts SET status = 'void' WHERE id = ?`).run(receipt.id);
    const restock = db.prepare(`UPDATE products SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?`);
    const insertAdj = db.prepare(`
      INSERT INTO stock_adjustments (product_id, type, quantity_change, note, recorded_by)
      VALUES (?, 'return', ?, ?, ?)
    `);
    for (const it of items) {
      if (!it.product_id) continue;
      restock.run(it.quantity, it.product_id);
      insertAdj.run(it.product_id, it.quantity, `Void of receipt ${receipt.receipt_number}`, req.session.user.id);
    }
  });
  tx();
  res.redirect(`/receipts/${receipt.id}`);
});

module.exports = router;
