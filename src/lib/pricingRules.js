const MANILA_TZ = "Asia/Manila";

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
  if (!isAllowedParticulars(particulars)) return false;

  // Temporary override: show all allowed Particulars regardless of eligibility.
  // (Still hides unknown/legacy items via the allowlist above.)
  if (ctx?.showAllParticulars) return true;

  const name = normName(particulars);
  const isOffPeak = !!ctx?.isOffPeak;
  const hasActiveGym = !!ctx?.hasActiveGym;
  const hasActiveCoach = !!ctx?.hasActiveCoach;
  const isStudent = !!ctx?.isStudent;
  const isSenior = !!ctx?.isSenior;
  const isSpecial = !!ctx?.isSpecial;

  // Gym membership only
  if (name === normName("Daily Pass - Off Peak")) return !hasActiveGym && isOffPeak && !isSpecial;
  if (name === normName("Daily Pass - Peak")) return !hasActiveGym && !isOffPeak && !isSpecial;
  if (name === normName("Daily Pass - Special")) return !hasActiveGym && isSpecial;

  if (name === normName("Monthly Pass - Student")) return isStudent;
  if (name === normName("Monthly Pass - Senior")) return isSenior && isSpecial;
  if (name === normName("Monthly Pass - Regular")) return !isStudent && !(isSenior && isSpecial);
  if (name === normName("Yearly Pass - Regular")) return true;

  // Coach subscription only (all require an active gym membership)
  if (name === normName("Daily Coach - Off Peak")) return hasActiveGym && !hasActiveCoach && isOffPeak;
  if (name === normName("Daily Coach Only")) return hasActiveGym && !hasActiveCoach && !isOffPeak;
  if (name === normName("Monthly Coach Only")) return hasActiveGym;

  // Gym & Coach bundle
  if (name === normName("Daily Pass w/ Coach - Off Peak")) return !hasActiveGym && !hasActiveCoach && isOffPeak;
  if (name === normName("Daily Pass w/ Coach")) return !hasActiveGym && !hasActiveCoach && !isOffPeak;
  if (name === normName("Monthly Pass w/ Coach")) return true;

  // Merchandise (allowed) + any other allowed items not covered above
  return true;
}
