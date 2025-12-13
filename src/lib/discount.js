// Discount helpers for UI.
// Supports new member field `Discount` and legacy field `Student`.

function pick(o, keys = []) {
  if (!o) return undefined;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
    const alt = Object.keys(o).find(
      (kk) => kk.toLowerCase().replace(/\s+/g, "") === String(k).toLowerCase().replace(/\s+/g, "")
    );
    if (alt) return o[alt];
  }
  return undefined;
}

function yesy(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "y" || s === "true" || s === "1";
}

function asDate(v) {
  try {
    if (!v && v !== 0) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === "number") {
      const d = new Date(v);
      return isNaN(d) ? null : d;
    }
    if (v && typeof v.toDate === "function") {
      const d = v.toDate();
      return d instanceof Date && !isNaN(d) ? d : null;
    }
    if (v && typeof v.seconds === "number") {
      const d = new Date(v.seconds * 1000);
      return isNaN(d) ? null : d;
    }
    const d = new Date(v);
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

export function normalizeDiscountValue(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s === "n/a" || s === "na" || s === "none") return "na";
  if (s.includes("student")) return "student";
  if (s.includes("special")) return "special";
  return "na";
}

export function getMemberDiscountValue(member) {
  const raw = pick(member, [
    "Discount",
    "discount",
    "discount_rate",
    "discountRate",
    "DiscountRate",
    "discount_type",
    "discountType",
  ]);
  return normalizeDiscountValue(raw);
}

export function isStudentRate(member) {
  const v = getMemberDiscountValue(member);
  if (v === "student") return true;
  // legacy
  const legacy = pick(member, ["Student", "student", "is_student", "student?"]);
  return yesy(legacy);
}

export function isSpecialRate(member) {
  return getMemberDiscountValue(member) === "special";
}

export function isSenior(member) {
  // Existing UX: senior is derived from age >= 60.
  let ageNum = Number(pick(member, ["Age", "age", "years_old", "YearsOld"]));
  if (isNaN(ageNum)) {
    const bday = pick(member, ["Birthday", "birthday", "birth_date", "dob", "Birth Date"]);
    const d = asDate(bday);
    if (d) {
      const t = new Date();
      ageNum =
        t.getFullYear() -
        d.getFullYear() -
        (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())
          ? 1
          : 0);
    }
  }
  return !isNaN(ageNum) && ageNum >= 60;
}

export function getMemberPills(member) {
  const out = [];
  if (isStudentRate(member)) out.push({ key: "student", label: "Student", className: "student" });
  if (isSenior(member)) out.push({ key: "senior", label: "Senior", className: "senior" });
  if (isSpecialRate(member)) out.push({ key: "special", label: "Special", className: "special" });
  return out;
}
