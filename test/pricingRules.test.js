import { describe, expect, it } from 'vitest';
import { effectiveValidityDays, isManilaOffPeak, isParticularsVisibleForMember } from '../src/lib/pricingRules.js';

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

  it('Daily Pass - Special only visible for Discount=Special', () => {
    expect(isParticularsVisibleForMember('Daily Pass - Special', { Discount: 'Special' })).toBe(true);
    expect(isParticularsVisibleForMember('Daily Pass - Special', { Discount: 'Student' })).toBe(false);
    expect(isParticularsVisibleForMember('Daily Pass - Special', null)).toBe(false);
  });

  it('Monthly Pass - Student only visible for Discount=Student', () => {
    expect(isParticularsVisibleForMember('Monthly Pass - Student', { Discount: 'Student' })).toBe(true);
    expect(isParticularsVisibleForMember('Monthly Pass - Student', { Discount: 'Special' })).toBe(false);
    expect(isParticularsVisibleForMember('Monthly Pass - Student', null)).toBe(false);
  });

  it('Monthly Pass - Senior only visible for age >= 60', () => {
    expect(isParticularsVisibleForMember('Monthly Pass - Senior', { Age: 60 })).toBe(true);
    expect(isParticularsVisibleForMember('Monthly Pass - Senior', { Age: 59 })).toBe(false);
    expect(isParticularsVisibleForMember('Monthly Pass - Senior', null)).toBe(false);
  });
  
  it('Unknown/legacy Particulars are hidden', () => {
    expect(isParticularsVisibleForMember('Daily Pass', {})).toBe(false);
    expect(isParticularsVisibleForMember('Daily Coach Offpeak', {})).toBe(false);
    expect(isParticularsVisibleForMember('Some Random Product', {})).toBe(false);
  });
});
