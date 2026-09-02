/**
 * Unit Tests for Dashboard Metrics & API Data Parsing
 * Tests: fetchBackendStats, fetchBackendBids, fetchBackendLeads
 * 
 * Verifies:
 * - Proper data transformation and parsing of metrics
 * - Resilient error handling when network fails or backend is waking up
 * - Safe array unwrapping for bids and leads responses
 */

import {
  fetchBackendStats,
  fetchBackendBids,
  fetchBackendLeads,
  BackendStats,
  BackendBidItem,
  BackendLeadItem,
} from './api';

// Helper mock for window.fetch
function mockFetchResponse(status: number, data: any, ok: boolean = true) {
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as Response);
}

function mockFetchNetworkError(errorMessage: string = 'Network failure') {
  return Promise.reject(new Error(errorMessage));
}

// Test Runner Suite
export async function runApiUnitTests(): Promise<{
  passed: number;
  failed: number;
  results: { testName: string; success: boolean; error?: string }[];
}> {
  const originalFetch = globalThis.fetch;
  const results: { testName: string; success: boolean; error?: string }[] = [];
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed++;
      results.push({ testName: name, success: true });
    } catch (err: any) {
      failed++;
      results.push({ testName: name, success: false, error: err?.message || String(err) });
    }
  }

  try {
    // ------------------------------------------------------------------------
    // 1. fetchBackendStats Unit Tests
    // ------------------------------------------------------------------------
    await test('fetchBackendStats parses normal backend payload correctly', async () => {
      globalThis.fetch = () =>
        mockFetchResponse(200, {
          total: 120,
          active: 15,
          won: 8,
          earned: 4250.5,
          win_rate: 6.7,
          package_counts: { Enterprise: 3, Pro: 5 },
          total_leads: 45,
        });

      const stats: BackendStats | null = await fetchBackendStats();
      if (!stats) throw new Error('Expected non-null stats');
      if (stats.total !== 120) throw new Error(`Expected total 120, got ${stats.total}`);
      if (stats.active !== 15) throw new Error(`Expected active 15, got ${stats.active}`);
      if (stats.won !== 8) throw new Error(`Expected won 8, got ${stats.won}`);
      if (stats.earned !== 4250.5) throw new Error(`Expected earned 4250.5, got ${stats.earned}`);
      if (stats.win_rate !== 6.7) throw new Error(`Expected win_rate 6.7, got ${stats.win_rate}`);
      if (stats.package_counts?.Enterprise !== 3) throw new Error('package_counts not parsed');
      if (stats.total_leads !== 45) throw new Error('total_leads not parsed');
    });

    await test('fetchBackendStats handles alternative snake_case keys', async () => {
      globalThis.fetch = () =>
        mockFetchResponse(200, {
          total_bids: 88,
          active_bids: 12,
          won_bids: 4,
          total_earned: 1900,
          win_rate: 4.5,
        });

      const stats = await fetchBackendStats();
      if (!stats) throw new Error('Expected non-null stats');
      if (stats.total !== 88) throw new Error(`Expected total 88, got ${stats.total}`);
      if (stats.active !== 12) throw new Error(`Expected active 12, got ${stats.active}`);
      if (stats.won !== 4) throw new Error(`Expected won 4, got ${stats.won}`);
      if (stats.earned !== 1900) throw new Error(`Expected earned 1900, got ${stats.earned}`);
    });

    await test('fetchBackendStats returns null safely on HTTP 500 or Network Error', async () => {
      globalThis.fetch = () => mockFetchNetworkError('Connection refused');

      const stats = await fetchBackendStats();
      if (stats !== null) {
        throw new Error(`Expected null stats on failure, got: ${JSON.stringify(stats)}`);
      }
    });

    // ------------------------------------------------------------------------
    // 2. fetchBackendBids Unit Tests
    // ------------------------------------------------------------------------
    await test('fetchBackendBids unwraps raw array of bids', async () => {
      const mockBids = [
        { id: 'bid_1', job_title: 'React Dev', bid_amount: 500, status: 'active' },
        { id: 'bid_2', job_title: 'Node Backend', bid_amount: 1200, status: 'won' },
      ];
      globalThis.fetch = () => mockFetchResponse(200, mockBids);

      const bids: BackendBidItem[] = await fetchBackendBids(10);
      if (bids.length !== 2) throw new Error(`Expected 2 bids, got ${bids.length}`);
      if (bids[0].job_title !== 'React Dev') throw new Error('Bid 0 job_title mismatch');
    });

    await test('fetchBackendBids unwraps nested object payload ({ bids: [...] })', async () => {
      const mockPayload = {
        bids: [{ id: 'bid_3', title: 'Python Scraper', bid_amount: 350, status: 'submitted' }],
      };
      globalThis.fetch = () => mockFetchResponse(200, mockPayload);

      const bids = await fetchBackendBids(10);
      if (bids.length !== 1 || (bids[0].title !== 'Python Scraper' && bids[0].job_title !== 'Python Scraper')) {
        throw new Error(`Failed to unwrap nested bids array: ${JSON.stringify(bids)}`);
      }
    });

    await test('fetchBackendBids returns empty array on network failure', async () => {
      globalThis.fetch = () => mockFetchNetworkError('502 Bad Gateway');

      const bids = await fetchBackendBids(20);
      if (!Array.isArray(bids) || bids.length !== 0) {
        throw new Error('Expected empty array fallback for bids');
      }
    });

    // ------------------------------------------------------------------------
    // 3. fetchBackendLeads Unit Tests
    // ------------------------------------------------------------------------
    await test('fetchBackendLeads parses direct array of leads correctly', async () => {
      const mockLeads = [
        { id: 'lead_1', job_title: 'Full Stack Engineer', company: 'TechCorp', source: 'RemoteOK' },
        { id: 'lead_2', job_title: 'DevOps Architect', company: 'CloudInc', source: 'Freelancer' },
      ];
      globalThis.fetch = () => mockFetchResponse(200, mockLeads);

      const leads: BackendLeadItem[] = await fetchBackendLeads(10);
      if (leads.length !== 2) throw new Error(`Expected 2 leads, got ${leads.length}`);
      if (leads[0].company !== 'TechCorp') throw new Error('Lead 0 company mismatch');
    });

    await test('fetchBackendLeads unwraps nested object payload ({ leads: [...] })', async () => {
      const mockPayload = {
        leads: [{ id: 'lead_3', title: 'Smart Contract Auditor', company: 'Web3 DAO' }],
      };
      globalThis.fetch = () => mockFetchResponse(200, mockPayload);

      const leads = await fetchBackendLeads(5);
      if (leads.length !== 1 || (leads[0].title !== 'Smart Contract Auditor' && leads[0].job_title !== 'Smart Contract Auditor')) {
        throw new Error(`Failed to unwrap nested leads payload: ${JSON.stringify(leads)}`);
      }
    });

    await test('fetchBackendLeads returns empty array gracefully on server error', async () => {
      globalThis.fetch = () => mockFetchResponse(500, { error: 'Database connection failed' }, false);

      const leads = await fetchBackendLeads(5);
      if (!Array.isArray(leads) || leads.length !== 0) {
        throw new Error('Expected empty array fallback for leads on error');
      }
    });
  } finally {
    // Restore global fetch
    globalThis.fetch = originalFetch;
  }

  return { passed, failed, results };
}

// Self-executing runner for Node/CI environments
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
  runApiUnitTests().then(({ passed, failed, results }) => {
    console.log(`\n=== API Unit Tests: ${passed} Passed, ${failed} Failed ===`);
    results.forEach((r) => {
      console.log(`${r.success ? '✅' : '❌'} ${r.testName}${r.error ? ` (${r.error})` : ''}`);
    });
  });
}
