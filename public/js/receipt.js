(function () {
  const container = document.getElementById('line-items');
  const template = document.getElementById('line-item-template');
  const addBtn = document.getElementById('add-line-btn');
  const subtotalEl = document.getElementById('subtotal-display');
  const totalEl = document.getElementById('total-display');
  const paymentMethodSelect = document.getElementById('payment_method');
  const courierHint = document.getElementById('courier-hint');
  const courierDestinationField = document.getElementById('courier-destination-field');
  const courierDestinationInput = document.getElementById('courier_destination');
  const cashFields = document.getElementById('cash-fields');
  const cashReceivedInput = document.getElementById('cash_received');
  const changeRow = document.getElementById('change-row');
  const changeEl = document.getElementById('change-display');
  const shortfallEl = document.getElementById('cash-shortfall');

  const productsData = JSON.parse(document.getElementById('products-data').textContent);
  const productsByKey = new Map(productsData.map(p => [p.key, p]));

  let currentTotal = 0;

  function money(n) {
    return '$' + (Math.round(n * 100) / 100).toFixed(2);
  }

  function recalc() {
    let subtotal = 0;
    container.querySelectorAll('.line-item-row').forEach((row) => {
      const priceInput = row.querySelector('.price-input');
      const qtyInput = row.querySelector('.qty-input');
      const lineTotalEl = row.querySelector('.line-total');
      const price = parseFloat(priceInput.value);
      const qty = parseInt(qtyInput.value, 10) || 0;
      if (priceInput.disabled || isNaN(price)) {
        lineTotalEl.textContent = '-';
        return;
      }
      const lineTotal = price * qty;
      lineTotalEl.textContent = money(lineTotal);
      subtotal += lineTotal;
    });
    subtotalEl.textContent = money(subtotal);
    totalEl.textContent = money(subtotal);
    currentTotal = subtotal;
    updateChange();
  }

  function updateChange() {
    const isCourier = paymentMethodSelect.value === 'courier';
    courierHint.style.display = isCourier ? 'block' : 'none';
    courierDestinationField.style.display = isCourier ? '' : 'none';
    courierDestinationInput.required = isCourier;
    if (!isCourier) courierDestinationInput.value = '';
    const isCash = paymentMethodSelect.value === 'cash';
    cashFields.style.display = isCash ? '' : 'none';
    if (!isCash || cashReceivedInput.value === '') {
      changeRow.style.display = 'none';
      shortfallEl.style.display = 'none';
      return;
    }
    const cashReceived = parseFloat(cashReceivedInput.value) || 0;
    const change = cashReceived - currentTotal;
    if (change < 0) {
      changeRow.style.display = 'none';
      shortfallEl.style.display = 'block';
    } else {
      changeRow.style.display = '';
      shortfallEl.style.display = 'none';
      changeEl.textContent = money(change);
    }
  }

  function bindProductSearch(row) {
    const searchInput = row.querySelector('.product-search');
    const idInput = row.querySelector('.product-id-input');
    const priceInput = row.querySelector('.price-input');
    const qtyInput = row.querySelector('.qty-input');
    const hintEl = row.querySelector('.product-hint');
    let matchedKey = null;

    function handleSearchInput() {
      const product = productsByKey.get(searchInput.value);
      if (product) {
        if (matchedKey !== product.key) {
          // Reset the price to the catalog price only when the selected product actually changes,
          // so quantity-only edits don't clobber a manually negotiated price.
          priceInput.value = product.price.toFixed(2);
          matchedKey = product.key;
        }
        idInput.value = product.id;
        priceInput.disabled = false;
        qtyInput.max = product.stock;
        if (parseInt(qtyInput.value, 10) > product.stock) qtyInput.value = product.stock;
        hintEl.textContent = `${money(product.price)} catalog price · ${product.stock} in stock`;
      } else {
        matchedKey = null;
        idInput.value = '';
        priceInput.value = '';
        priceInput.disabled = true;
        qtyInput.removeAttribute('max');
        hintEl.textContent = searchInput.value ? 'No matching product — pick one from the list.' : '';
      }
      recalc();
    }

    searchInput.addEventListener('input', handleSearchInput);
    priceInput.addEventListener('input', recalc);
    qtyInput.addEventListener('input', recalc);
  }

  function addRow() {
    const clone = template.content.cloneNode(true);
    container.appendChild(clone);
    const row = container.lastElementChild;
    bindProductSearch(row);
    row.querySelector('.remove-line-btn').addEventListener('click', () => {
      if (container.querySelectorAll('.line-item-row').length > 1) {
        row.remove();
        recalc();
      }
    });
    recalc();
  }

  container.querySelectorAll('.line-item-row').forEach((row) => {
    bindProductSearch(row);
    row.querySelector('.remove-line-btn').addEventListener('click', () => {
      if (container.querySelectorAll('.line-item-row').length > 1) {
        row.remove();
        recalc();
      }
    });
  });

  addBtn.addEventListener('click', addRow);
  paymentMethodSelect.addEventListener('change', updateChange);
  cashReceivedInput.addEventListener('input', updateChange);
  recalc();
})();
