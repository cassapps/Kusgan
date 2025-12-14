const MANILA_TZ = "Asia/Manila";

import { getMemberDiscountValue, isSenior as isSeniorMember } from "./discount.js";

function normName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// IMPORTANT: Only these Particulars are allowed to appear in the UI.
// Anything else (legacy/typos/old products) must be hidden.
export const ALLOWED_PARTICULARS = [
  // Gym membership only
  "Daily Pass - Off Peak",
  "Daily Pass - Peak",
  "Daily Pass - Special",
  "Monthly Pass - Student",
  "Monthly Pass - Senior",
  "Monthly Pass - Regular",
  "Yearly Pass - Regular",
  // Coach subscription only
  "Daily Coach - Off Peak",
  "Daily Coach Only",
  "Monthly Coach Only",
  // Gym & Coach bundle
  "Daily Pass w/ Coach - Off Peak",
  "Daily Pass w/ Coach",
  "Monthly Pass w/ Coach",
  // Merchandise
  "Kusgan Shirt",
  "Kusgan ID",
];

// Defaults used when pricing rows are missing/incomplete.
// Firestore pricing rows (if present) can still override Cost/Validity.
const DEFAULTS = new Map([
  // Gym membership only
  [normName("Daily Pass - Off Peak"), { cost: 70, validity: 1, gym: true, coach: false }],
  [normName("Daily Pass - Peak"), { cost: 100, validity: 1, gym: true, coach: false }],
  [normName("Daily Pass - Special"), { cost: 50, validity: 1, gym: true, coach: false }],
  [normName("Monthly Pass - Student"), { cost: 1000, validity: 30, gym: true, coach: false }],
  [normName("Monthly Pass - Senior"), { cost: 1000, validity: 30, gym: true, coach: false }],
  [normName("Monthly Pass - Regular"), { cost: 1200, validity: 30, gym: true, coach: false }],
  [normName("Yearly Pass - Regular"), { cost: 12000, validity: 365, gym: true, coach: false }],
  // Coach subscription only
  [normName("Daily Coach - Off Peak"), { cost: 150, validity: 1, gym: false, coach: true }],
  [normName("Daily Coach Only"), { cost: 200, validity: 1, gym: false, coach: true }],
  [normName("Monthly Coach Only"), { cost: 2300, validity: 30, gym: false, coach: true }],
  // Gym & Coach bundle
  [normName("Daily Pass w/ Coach - Off Peak"), { cost: 200, validity: 1, gym: true, coach: true }],
  [normName("Daily Pass w/ Coach"), { cost: 250, validity: 1, gym: true, coach: true }],
  [normName("Monthly Pass w/ Coach"), { cost: 3500, validity: 30, gym: true, coach: true }],
  // Merchandise
  [normName("Kusgan Shirt"), { cost: 600, validity: 0, gym: false, coach: false }],
  [normName("Kusgan ID"), { cost: 150, validity: 0, gym: false, coach: false }],
]);

export function getParticularsDefaults(particulars) {
  return DEFAULTS.get(normName(particulars)) || null;
}

const ALLOWED_SET = new Set(ALLOWED_PARTICULARS.map(normName));

export function isAllowedParticulars(particulars) {
  return ALLOWED_SET.has(normName(particulars));
}

export function manilaTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  return { hour, minute, minutes: hour * 60 + minute };
}

export function isManilaOffPeak(date = new Date()) {
  const { minutes } = manilaTimeParts(date);
  // Off peak hours: 8:00am - 3:30pm Manila time
  // Treat as [08:00, 15:30)
  return minutes >= 8 * 60 && minutes < 15 * 60 + 30;
}

export function effectiveValidityDays(particulars, rawValidityDays) {
  const name = normName(particulars);
  if (name === normName("Monthly Pass w/ Coach")) return 365;
  return Number(rawValidityDays || 0) || 0;
}

export function isParticularsVisible(particulars, ctx) {
  return isParticularsVisibleForMember(particulars, ctx?.member);
}

// UI visibility rules (requested):
// - Daily Pass - Special: only if member Discount=Special
// - Monthly Pass - Student: only if member Discount=Student
// - Monthly Pass - Senior: only if member age >= 60
// Everything else in the allowlist remains visible.
export function isParticularsVisibleForMember(particulars, member) {
  if (!isAllowedParticulars(particulars)) return false;
  const name = normName(particulars);

  if (name === normName("Daily Pass - Special")) {
    if (!member) return false;
    return getMemberDiscountValue(member) === "special";
  }
  if (name === normName("Monthly Pass - Student")) {
    if (!member) return false;
    return getMemberDiscountValue(member) === "student";
  }
  if (name === normName("Monthly Pass - Senior")) {
    if (!member) return false;
    return isSeniorMember(member);
  }

  return true;
}
