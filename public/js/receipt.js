(function () {
  const container = document.getElementById('line-items');
  const template = document.getElementById('line-item-template');
  const addBtn = document.getElementById('add-line-btn');
  const subtotalEl = document.getElementById('subtotal-display');
  const totalEl = document.getElementById('total-display');

  const paymentRowsContainer = document.getElementById('payment-rows');
  const paymentRowTemplate = document.getElementById('payment-row-template');
  const addPaymentBtn = document.getElementById('add-payment-btn');
  const paymentSummaryEl = document.getElementById('payment-summary');
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

  function paymentRows() {
    return Array.from(paymentRowsContainer.querySelectorAll('.payment-row'));
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
    refreshPayments();
  }

  // With exactly one payment row, its amount always equals the total automatically (and can't
  // be hand-edited) — same zero-extra-input experience as before split payments existed. Adding
  // a second row hands full manual control to the cashier, since the split must be typed in.
  function refreshPayments() {
    const rows = paymentRows();
    const single = rows.length === 1;
    rows.forEach((row) => {
      const amountInput = row.querySelector('.payment-amount-input');
      amountInput.readOnly = single;
      if (single) amountInput.value = currentTotal > 0 ? currentTotal.toFixed(2) : '';
      row.querySelector('.remove-payment-btn').style.display = rows.length > 1 ? '' : 'none';
    });
    updatePaymentState();
  }

  function updatePaymentState() {
    const rows = paymentRows();
    let allocated = 0;
    let hasCash = false;
    let hasCourier = false;
    let cashAmount = 0;

    rows.forEach((row) => {
      const method = row.querySelector('.payment-method-select').value;
      const amount = parseFloat(row.querySelector('.payment-amount-input').value) || 0;
      allocated += amount;
      if (method === 'cash') { hasCash = true; cashAmount += amount; }
      if (method === 'courier') hasCourier = true;
    });
    allocated = Math.round(allocated * 100) / 100;

    courierHint.style.display = hasCourier ? 'block' : 'none';
    courierDestinationField.style.display = hasCourier ? '' : 'none';
    courierDestinationInput.required = hasCourier;
    if (!hasCourier) courierDestinationInput.value = '';

    cashFields.style.display = hasCash ? '' : 'none';

    const diff = Math.round((currentTotal - allocated) * 100) / 100;
    if (Math.abs(diff) < 0.005) {
      paymentSummaryEl.textContent = `Allocated ${money(allocated)} of ${money(currentTotal)} — balanced.`;
      paymentSummaryEl.style.color = 'var(--success)';
    } else if (diff > 0) {
      paymentSummaryEl.textContent = `Allocated ${money(allocated)} of ${money(currentTotal)} — ${money(diff)} remaining.`;
      paymentSummaryEl.style.color = 'var(--warning)';
    } else {
      paymentSummaryEl.textContent = `Allocated ${money(allocated)} of ${money(currentTotal)} — ${money(-diff)} over.`;
      paymentSummaryEl.style.color = 'var(--danger)';
    }

    if (!hasCash || cashReceivedInput.value === '') {
      changeRow.style.display = 'none';
      shortfallEl.style.display = 'none';
      return;
    }
    const cashReceived = parseFloat(cashReceivedInput.value) || 0;
    const change = cashReceived - cashAmount;
    if (change < 0) {
      changeRow.style.display = 'none';
      shortfallEl.style.display = 'block';
    } else {
      changeRow.style.display = '';
      shortfallEl.style.display = 'none';
      changeEl.textContent = money(change);
    }
  }

  function bindPaymentRow(row) {
    row.querySelector('.payment-method-select').addEventListener('change', updatePaymentState);
    row.querySelector('.payment-amount-input').addEventListener('input', updatePaymentState);
    row.querySelector('.remove-payment-btn').addEventListener('click', () => {
      if (paymentRows().length > 1) {
        row.remove();
        refreshPayments();
      }
    });
  }

  function addPaymentRow() {
    const clone = paymentRowTemplate.content.cloneNode(true);
    paymentRowsContainer.appendChild(clone);
    const row = paymentRowsContainer.lastElementChild;
    bindPaymentRow(row);
    refreshPayments();
  }

  paymentRows().forEach(bindPaymentRow);
  addPaymentBtn.addEventListener('click', addPaymentRow);
  cashReceivedInput.addEventListener('input', updatePaymentState);

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
  recalc();
})();
