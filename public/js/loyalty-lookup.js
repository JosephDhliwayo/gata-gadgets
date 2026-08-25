(function () {
  const phoneInput = document.getElementById('customer_phone');
  const nameInput = document.getElementById('customer_name');
  const hint = document.getElementById('loyalty-hint');
  if (!phoneInput || !hint) return;

  const customersDataEl = document.getElementById('customers-data');
  const customers = customersDataEl ? JSON.parse(customersDataEl.textContent) : [];
  const byPhone = new Map(customers.filter(c => c.phone).map(c => [c.phone, c]));
  const byName = new Map(customers.map(c => [c.name, c]));

  let timer = null;

  async function lookup() {
    const phone = phoneInput.value.trim();
    if (!phone) { hint.style.display = 'none'; return; }
    try {
      const res = await fetch(`/customers/lookup?phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      if (data.found) {
        hint.textContent = data.tier === 'Pending'
          ? `${data.name}: not yet eligible for loyalty points · ${data.purchase_count} past purchase(s)`
          : `${data.name}: ${data.tier} tier · ${data.points} pts · ${data.purchase_count} past purchase(s)`;
        hint.style.display = 'block';
      } else {
        hint.textContent = 'New customer — a loyalty profile will be created for this sale.';
        hint.style.display = 'block';
      }
    } catch (e) { hint.style.display = 'none'; }
  }

  phoneInput.addEventListener('input', () => {
    // Picking a known phone from the search list auto-fills the matching customer's name.
    const known = byPhone.get(phoneInput.value.trim());
    if (known && nameInput && !nameInput.value.trim()) {
      nameInput.value = known.name;
    }
    clearTimeout(timer);
    timer = setTimeout(lookup, 400);
  });

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      // Picking a known name auto-fills their phone, which then triggers the loyalty lookup above.
      const known = byName.get(nameInput.value.trim());
      if (known && known.phone && !phoneInput.value.trim()) {
        phoneInput.value = known.phone;
        phoneInput.dispatchEvent(new Event('input'));
      }
    });
  }
})();
