(function () {
  const toggleBtn = document.getElementById('nav-toggle-btn');
  const nav = document.getElementById('nav-links');
  if (!toggleBtn || !nav) return;

  toggleBtn.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
})();
