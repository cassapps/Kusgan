// Nickname normalization rules:
// - max 10 characters
// - letters/numbers and '-' only
// - no spaces (drop everything after first whitespace)

export function normalizeNickname(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const head = raw.split(/\s+/)[0] || '';
  const cleaned = head.replace(/[^A-Za-z0-9-]/g, '');
  return cleaned.toUpperCase().slice(0, 10);
}

export function isValidNickname(input) {
  const s = String(input || '').trim();
  return /^[A-Za-z0-9-]{1,10}$/.test(s);
}
