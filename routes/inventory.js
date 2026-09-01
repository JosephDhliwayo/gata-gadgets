const express = require('express');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAdmin);

function getCategories() {
  return db.prepare(`
    SELECT DISTINCT category FROM products
    WHERE category IS NOT NULL AND category != ''
    ORDER BY category
  `).all().map(r => r.category);
}

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let products;
  if (q) {
    const like = `%${q}%`;
    products = db.prepare(
      `SELECT * FROM products WHERE active = 1 AND (name LIKE ? OR sku LIKE ? OR category LIKE ?) ORDER BY name`
    ).all(like, like, like);
  } else {
    products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name').all();
  }
  res.render('inventory/list', { title: 'Inventory', products, q });
});

// Appends the given search term (if any) as a ?q= query string, so admin actions taken from a
// filtered inventory view (edit, restock, remove) return to that same filtered view afterward.
function inventoryUrl(q) {
  return q ? `/inventory?q=${encodeURIComponent(q)}` : '/inventory';
}

router.get('/new', (req, res) => {
  const q = (req.query.q || '').trim();
  res.render('inventory/form', { title: 'Add Product', product: null, error: null, categories: getCategories(), q });
});

router.post('/', (req, res) => {
  const { sku, name, category, cost_price, selling_price, quantity, reorder_level, q } = req.body;
  if (!sku || !name) {
    return res.status(400).render('inventory/form', { title: 'Add Product', product: req.body, error: 'SKU and Name are required.', categories: getCategories(), q });
  }
  try {
    const info = db.prepare(`
      INSERT INTO products (sku, name, category, cost_price, selling_price, quantity, reorder_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+2 hours'), datetime('now', '+2 hours'))
    `).run(
      sku.trim(),
      name.trim(),
      (category || '').trim(),
      parseFloat(cost_price) || 0,
      parseFloat(selling_price) || 0,
      parseInt(quantity, 10) || 0,
      parseInt(reorder_level, 10) || 5
    );
    const qty = parseInt(quantity, 10) || 0;
    if (qty > 0) {
      db.prepare(`
        INSERT INTO stock_adjustments (product_id, type, quantity_change, note, recorded_by, created_at)
        VALUES (?, 'restock', ?, 'Initial stock on creation', ?, datetime('now', '+2 hours'))
      `).run(info.lastInsertRowid, qty, req.session.user.id);
    }
    res.redirect(inventoryUrl(q));
  } catch (err) {
    const msg = String(err.message || '').includes('UNIQUE') ? 'A product with that SKU already exists.' : 'Could not save product.';
    res.status(400).render('inventory/form', { title: 'Add Product', product: req.body, error: msg, categories: getCategories(), q });
  }
});

router.get('/:id/edit', (req, res) => {
  const q = (req.query.q || '').trim();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).render('errors/404', { title: 'Not Found' });
  res.render('inventory/form', { title: 'Edit Product', product, error: null, categories: getCategories(), q });
});

router.post('/:id', (req, res) => {
  const { sku, name, category, cost_price, selling_price, reorder_level, q } = req.body;
  if (!sku || !name) {
    const product = { ...req.body, id: req.params.id };
    return res.status(400).render('inventory/form', { title: 'Edit Product', product, error: 'SKU and Name are required.', categories: getCategories(), q });
  }
  try {
    db.prepare(`
      UPDATE products SET sku = ?, name = ?, category = ?, cost_price = ?, selling_price = ?, reorder_level = ?, updated_at = datetime('now', '+2 hours')
      WHERE id = ?
    `).run(
      sku.trim(),
      name.trim(),
      (category || '').trim(),
      parseFloat(cost_price) || 0,
      parseFloat(selling_price) || 0,
      parseInt(reorder_level, 10) || 5,
      req.params.id
    );
    res.redirect(inventoryUrl(q));
  } catch (err) {
    const msg = String(err.message || '').includes('UNIQUE') ? 'A product with that SKU already exists.' : 'Could not update product.';
    const product = { ...req.body, id: req.params.id };
    res.status(400).render('inventory/form', { title: 'Edit Product', product, error: msg, categories: getCategories(), q });
  }
});

router.post('/:id/restock', (req, res) => {
  const qty = parseInt(req.body.quantity_change, 10);
  const note = (req.body.note || '').trim();
  const q = (req.body.q || '').trim();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product || !qty) return res.redirect(inventoryUrl(q));

  const type = qty < 0 ? 'correction' : 'restock';
  const tx = db.transaction(() => {
    db.prepare('UPDATE products SET quantity = quantity + ?, updated_at = datetime(\'now\', \'+2 hours\') WHERE id = ?').run(qty, product.id);
    db.prepare(`
      INSERT INTO stock_adjustments (product_id, type, quantity_change, note, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+2 hours'))
    `).run(product.id, type, qty, note || null, req.session.user.id);
  });
  tx();
  res.redirect(inventoryUrl(q));
});

router.post('/:id/delete', (req, res) => {
  const q = (req.body.q || '').trim();
  db.prepare('UPDATE products SET active = 0, updated_at = datetime(\'now\', \'+2 hours\') WHERE id = ?').run(req.params.id);
  res.redirect(inventoryUrl(q));
});

module.exports = router;
