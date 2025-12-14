// Helper to produce a human-friendly display name for a member or a sheet row.
// Accepts an object (member record or visit/payment row) and attempts common
// keys used across the app: NickName, nickname, Nick, FirstName + LastName, name.
import { normalizeNickname } from './nickname.js';
function pick(o, keys = []) {
  if (!o) return undefined;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
    const alt = Object.keys(o).find(kk => kk.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, ""));
    if (alt) return o[alt];
  }
  return undefined;
}

export default function displayName(obj) {
  if (!obj) return "";
  if (typeof obj === 'string') return obj;
  // common nickname keys
  const nick = pick(obj, ["NickName", "nickname", "Nick", "nick", "Nick_Name", "Nick Name"]);
  if (nick && String(nick).trim()) {
    const normalized = normalizeNickname(nick);
    if (normalized) return normalized;
    // If the nickname sanitizes to empty, at least avoid long strings.
    return String(nick).trim().slice(0, 10).toUpperCase();
  }

  // first + last
  const fn = pick(obj, ["FirstName", "firstname", "first_name", "first"]) || "";
  const ln = pick(obj, ["LastName", "lastname", "last_name", "last"]) || "";
  const full = `${String(fn).trim()} ${String(ln).trim()}`.trim();
  if (full) return full;

  // Member record sometimes stores concatenated fields
  const display = pick(obj, ["DisplayName", "displayname", "display"]);
  if (display && String(display).trim()) return String(display).trim();

  // Some rows may store a single full name under Name/name.
  const name = pick(obj, ["name", "Name"]);
  if (name && String(name).trim()) return String(name).trim();

  // fallback to id keys
  const id = pick(obj, ["MemberID", "memberid", "member_id", "id"]) || "";
  if (id && String(id).trim()) return String(id).trim();

  return "";
}
