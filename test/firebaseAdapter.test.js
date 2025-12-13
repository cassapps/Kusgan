import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fb.getCollection and fb.queryCollection before importing the modules under test
vi.mock('../src/lib/firebase.js', () => {
  const getCollection = vi.fn();
  const queryCollection = vi.fn();
  return {
    default: { getCollection, queryCollection },
    getCollection,
    queryCollection,
  };
});

import * as fb from '../src/lib/firebase.js';
import * as api from '../src/api/firebase.js';

describe('firebase adapter helpers', () => {
  beforeEach(() => {
    fb.getCollection.mockReset();
    fb.queryCollection.mockReset();
  });

  it('fetchMembersRecent returns members with recent payments and entries', async () => {
    const members = [
      { id: 'A', memberId: 'A', firstName: 'Anne', createdAt: new Date().toISOString() },
      { id: 'B', memberId: 'B', firstName: 'Bob', createdAt: '2020-01-01' },
    ];
    const payments = [ { MemberID: 'B', date: new Date().toISOString() } ];
    const entries = [ { MemberID: 'A', Date: new Date().toISOString() } ];

    // fetchMembersRecent now relies on queryCollection for scoped reads + batched member lookups.
    fb.queryCollection.mockImplementation(async (col, opts = {}) => {
      if (col === 'payments') return payments;
      if (col === 'gymEntries') return entries;

      if (col === 'members') {
        const wheres = Array.isArray(opts.wheres) ? opts.wheres : [];
        const inWhere = wheres.find(w => w && w.op === 'in' && Array.isArray(w.value));
        if (inWhere) {
          // Support both doc-id and MemberID batched queries.
          if (inWhere.field === '__name__') {
            return members.filter(m => inWhere.value.includes(m.id));
          }
          if (inWhere.field === 'MemberID') {
            return members.filter(m => inWhere.value.includes(m.memberId));
          }
        }

        // Fallback bounded members query.
        return members;
      }

      return [];
    });

    // Keep getCollection mock for any fallback paths.
    fb.getCollection.mockImplementation(async (col) => {
      if (col === 'members') return members;
      return [];
    });

    const res = await api.fetchMembersRecent({ limit: 10, days: 30 });
    expect(res.rows).toBeDefined();
    const ids = res.rows.map(r => r.id || r.memberId);
    expect(ids).toContain('A');
    expect(ids).toContain('B');
  });

  it('searchMembersByName uses queryCollection for prefix search and caches', async () => {
    const sample = [ { id: 'C', firstName: 'Carlos' }, { id: 'D', firstName: 'Carmen' } ];
    // first call: queryCollection returns sample
    fb.queryCollection.mockImplementationOnce(async () => sample);
    const r1 = await api.searchMembersByName('Car');
    expect(r1.rows.length).toBeGreaterThanOrEqual(1);
    // second call: should hit cache (queryCollection won't be called again)
    fb.queryCollection.mockImplementationOnce(async () => []);
    const r2 = await api.searchMembersByName('Car');
    expect(r2.rows.length).toBeGreaterThanOrEqual(1);
  });
});
