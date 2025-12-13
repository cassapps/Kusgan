import { describe, expect, it } from 'vitest';
import { effectiveValidityDays, isManilaOffPeak, isParticularsVisible } from '../src/lib/pricingRules.js';

// Manila is UTC+8.
const utc = (y, m, d, hh, mm) => new Date(Date.UTC(y, m - 1, d, hh, mm, 0));

describe('pricingRules', () => {
  it('isManilaOffPeak matches 8:00–15:30 Manila time', () => {
    // 08:00 Manila == 00:00 UTC
    expect(isManilaOffPeak(utc(2025, 1, 1, 0, 0))).toBe(true);
    // 15:29 Manila == 07:29 UTC
    expect(isManilaOffPeak(utc(2025, 1, 1, 7, 29))).toBe(true);
    // 15:30 Manila == 07:30 UTC
    expect(isManilaOffPeak(utc(2025, 1, 1, 7, 30))).toBe(false);
  });

  it('effectiveValidityDays overrides Monthly Pass w/ Coach to 365', () => {
    expect(effectiveValidityDays('Monthly Pass w/ Coach', 30)).toBe(365);
    expect(effectiveValidityDays('Yearly Pass - Regular', 365)).toBe(365);
  });

  it('Daily Pass - Special hides other daily passes', () => {
    const ctx = { hasActiveGym: false, hasActiveCoach: false, isStudent: false, isSenior: false, isSpecial: true, isOffPeak: true };
    expect(isParticularsVisible('Daily Pass - Special', ctx)).toBe(true);
    expect(isParticularsVisible('Daily Pass - Off Peak', ctx)).toBe(false);
    expect(isParticularsVisible('Daily Pass - Peak', ctx)).toBe(false);
  });

  it('Coach-only items require active gym membership', () => {
    const ctxNoGym = { hasActiveGym: false, hasActiveCoach: false, isStudent: false, isSenior: false, isSpecial: false, isOffPeak: true };
    expect(isParticularsVisible('Monthly Coach Only', ctxNoGym)).toBe(false);

    const ctxGym = { ...ctxNoGym, hasActiveGym: true };
    expect(isParticularsVisible('Monthly Coach Only', ctxGym)).toBe(true);
  });
  
  it('Unknown/legacy Particulars are hidden', () => {
    const ctx = { hasActiveGym: false, hasActiveCoach: false, isStudent: false, isSenior: false, isSpecial: false, isOffPeak: true };
    expect(isParticularsVisible('Daily Pass', ctx)).toBe(false);
    expect(isParticularsVisible('Daily Coach Offpeak', { ...ctx, hasActiveGym: true })).toBe(false);
    expect(isParticularsVisible('Some Random Product', ctx)).toBe(false);
  });

  it('showAllParticulars shows all allowed items', () => {
    const ctx = { hasActiveGym: true, hasActiveCoach: true, isStudent: false, isSenior: false, isSpecial: false, isOffPeak: false, showAllParticulars: true };
    // Allowed items should be visible regardless of eligibility.
    expect(isParticularsVisible('Daily Pass - Off Peak', ctx)).toBe(true);
    expect(isParticularsVisible('Daily Coach - Off Peak', ctx)).toBe(true);
    // Unknown items still hidden.
    expect(isParticularsVisible('Daily Pass', ctx)).toBe(false);
  });
});
