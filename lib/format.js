// Converts a SQLite "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" string into DD/MM/YYYY
// (optionally with a trailing HH:MM) for display across the app.
function formatDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  const datePart = s.slice(0, 10);
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

function formatDateTime(value) {
  if (!value) return '';
  const s = String(value).trim();
  const datePart = formatDate(s);
  const timePart = s.slice(11, 16);
  return timePart ? `${datePart} ${timePart}` : datePart;
}

function formatTime(value) {
  if (!value) return '';
  return String(value).trim().slice(11, 16);
}

// Converts a "YYYY-MM" month key into "MM/YYYY".
function formatMonth(value) {
  if (!value) return '';
  const s = String(value).trim();
  const [y, m] = s.split('-');
  if (!y || !m) return s;
  return `${m}/${y}`;
}

module.exports = { formatDate, formatDateTime, formatTime, formatMonth };
