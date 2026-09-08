// ============================================
// CONFIGURATION - Live Backend URL (EC2 / Amplify)
// Canonical Default: https://3-222-149-9.sslip.io
// ============================================
export const CANONICAL_BACKEND_URL = 'https://3-222-149-9.sslip.io';

const getDashboardApiUrl = (): string => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    const envUrl =
      (import.meta as any).env.REACT_APP_API_URL ||
      (import.meta as any).env.VITE_BACKEND_URL ||
      (import.meta as any).env.VITE_API_BASE_URL ||
      (import.meta as any).env.VITE_API_URL;
    if (
      envUrl &&
      typeof envUrl === 'string' &&
      envUrl.trim().length > 0 &&
      !envUrl.includes('ky7079.co') &&
      !envUrl.includes('onrender.com') &&
      !envUrl.includes('render.com')
    ) {
      return envUrl.trim().replace(/\/+$/, '');
    }
  }
  if (typeof process !== 'undefined' && process.env) {
    const procUrl =
      process.env.REACT_APP_API_URL ||
      process.env.API_BASE_URL ||
      process.env.VITE_BACKEND_URL;
    if (
      procUrl &&
      typeof procUrl === 'string' &&
      procUrl.trim().length > 0 &&
      !procUrl.includes('ky7079.co') &&
      !procUrl.includes('onrender.com') &&
      !procUrl.includes('render.com')
    ) {
      return procUrl.trim().replace(/\/+$/, '');
    }
  }
  return CANONICAL_BACKEND_URL;
};

export const API_BASE_URL = getDashboardApiUrl();

// ============================================
// FETCH FUNCTIONS
// ============================================

// Fetch dashboard statistics
export async function fetchStats() {
    const endpoints = [
        `${API_BASE_URL}/api/Bid/stats`,
        `${API_BASE_URL}/api/bids/stats`,
        `${API_BASE_URL}/api/freelancer/stats`
    ];

    for (const url of endpoints) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (!contentType.includes('application/json')) continue;
            const data = await response.json();
            updateStatsUI(data);
            return data;
        } catch (_) {}
    }

    showError('stats', 'Connecting to live EC2 backend service...');
    return null;
}

// Fetch recent bids with /api/Bid (Prisma) and /api/bids fallbacks
export async function fetchBids(limit = 50) {
    const endpoints = [
        `${API_BASE_URL}/api/Bid?limit=${limit}`,
        `${API_BASE_URL}/api/bids?limit=${limit}`,
        `${API_BASE_URL}/api/freelancer/bids?limit=${limit}`
    ];

    for (const url of endpoints) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (!contentType.includes('application/json')) continue;
            const data = await response.json();
            updateBidsTable(data);
            return data;
        } catch (_) {}
    }

    showError('bids', 'Connecting to live EC2 backend service...');
    return [];
}

// Aliases for dashboard compatibility
export const getRecentBids = fetchBids;
export const fetchDashboardBids = fetchBids;

// Fetch leads (from RemoteOK and other sources)
export async function fetchLeads(limit = 20) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/leads?limit=${limit}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        updateLeadsTable(data);
        return data;
    } catch (error) {
        console.error('Error fetching leads:', error);
        showError('leads', 'Failed to load leads. Backend may be starting up.');
        return [];
    }
}

// ============================================
// UI UPDATE FUNCTIONS
// ============================================

// Update the stats cards on the dashboard
export function updateStatsUI(stats: any) {
    if (!stats) return;
    // Update summary cards
    const elements: Record<string, any> = {
        'total-bids': stats.total ?? stats.total_bids ?? 0,
        'active-bids': stats.active ?? stats.active_bids ?? 0,
        'won-bids': stats.won ?? stats.won_bids ?? 0,
        'earned': stats.earned ?? stats.total_earned ?? 0,
        'win-rate': stats.win_rate ?? 0,
    };

    for (const [id, value] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) {
            if (id === 'earned') {
                el.textContent = `$${Number(value).toFixed(2)}`;
            } else if (id === 'win-rate') {
                el.textContent = `${value}%`;
            } else {
                el.textContent = String(value);
            }
        }
    }

    // Update package chart if Chart.js is available
    if (stats.package_counts && (window as any).Chart) {
        updatePackageChart(stats.package_counts);
    }
}

// Update the bids table
export function updateBidsTable(bidsData: any) {
    const tableBody = document.getElementById('bids-table-body');
    if (!tableBody) return;

    const bids = Array.isArray(bidsData) ? bidsData : (bidsData?.bids || []);

    if (!bids || bids.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center; color: #64748b; padding: 30px;">
                    🤖 No bids placed yet. The auto-bidding engine is running...
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = bids.map((bid: any) => {
        const title = bid.jobTitle || bid.job_title || bid.title || 'Freelance Project';
        const client = bid.clientName || bid.company || bid.client_name || '—';
        const pkg = formatPackageName(bid.package);
        const amount = Number(bid.amount ?? bid.bidAmount ?? bid.bid_amount ?? 0);
        const status = String(bid.status || 'unknown').toLowerCase();
        const dateStr = bid.createdAt || bid.created_at || bid.submittedAt || bid.submitted_at;
        const formattedDate = dateStr ? new Date(dateStr).toLocaleDateString() : '—';

        return `
        <tr class="border-b border-slate-800/60 hover:bg-slate-900/40 transition-colors">
            <td class="py-3 px-4 font-medium text-white">${escapeHtml(title)}</td>
            <td class="py-3 px-4 text-slate-400">${escapeHtml(client)}</td>
            <td class="py-3 px-4 text-indigo-300">${escapeHtml(pkg)}</td>
            <td class="py-3 px-4 font-mono font-semibold text-emerald-400">$${amount.toFixed(2)}</td>
            <td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
              status === 'won' || status === 'awarded' || status === 'accepted' ? 'bg-emerald-500/20 text-emerald-300' :
              status === 'active' || status === 'submitted' || status === 'pending' ? 'bg-cyan-500/20 text-cyan-300' :
              status === 'interviewing' ? 'bg-indigo-500/20 text-indigo-300' :
              'bg-slate-800 text-slate-400'
            }">${escapeHtml(status)}</span></td>
            <td class="py-3 px-4 text-slate-400 text-xs">${formattedDate}</td>
        </tr>
    `;
    }).join('');
}

// Update the leads table
export function updateLeadsTable(leadsData: any) {
    const tableBody = document.getElementById('leads-table-body');
    if (!tableBody) return;

    const leads = Array.isArray(leadsData) ? leadsData : (leadsData?.leads || []);

    if (!leads || leads.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; color: #64748b; padding: 30px;">
                    🔍 No leads captured yet. The system is scanning...
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = leads.map((lead: any) => `
        <tr class="border-b border-slate-800/60 hover:bg-slate-900/40 transition-colors">
            <td class="py-3 px-4 font-medium text-white">${escapeHtml(lead.job_title || lead.title || 'Lead')}</td>
            <td class="py-3 px-4 text-slate-400">${escapeHtml(lead.company || '—')}</td>
            <td class="py-3 px-4 text-sky-400">${escapeHtml(lead.source || 'RemoteOK')}</td>
            <td class="py-3 px-4 text-purple-300">${escapeHtml(formatPackageName(lead.matched_package || lead.package))}</td>
            <td class="py-3 px-4 text-slate-400 text-xs">${lead.created_at ? new Date(lead.created_at).toLocaleDateString() : (lead.date ? new Date(lead.date).toLocaleDateString() : '—')}</td>
        </tr>
    `).join('');
}

// Update the package chart (if Chart.js is loaded)
export function updatePackageChart(packageCounts: Record<string, number>) {
    const canvas = document.getElementById('package-chart') as HTMLCanvasElement | null;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const labels = Object.keys(packageCounts);
    const values = Object.values(packageCounts);

    const nameMap: Record<string, string> = {
        'fullstack': 'Full-Stack',
        'ai_agent': 'AI Agent',
        'payment_gateway': 'Payment Gateway',
        'code_audit': 'Code Audit'
    };

    const displayLabels = labels.map(k => nameMap[k] || k);

    // If chart already exists, destroy it first
    if ((window as any).packageChartInstance) {
        (window as any).packageChartInstance.destroy();
    }

    const ChartConstructor = (window as any).Chart;
    if (ChartConstructor) {
        (window as any).packageChartInstance = new ChartConstructor(ctx, {
            type: 'bar',
            data: {
                labels: displayLabels.length ? displayLabels : ['No bids yet'],
                datasets: [{
                    label: 'Bids Placed',
                    data: values.length ? values : [0],
                    backgroundColor: ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b'],
                    borderRadius: 6,
                    barPercentage: 0.6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#e2e8f0',
                        bodyColor: '#94a3b8',
                        borderColor: '#334155',
                        borderWidth: 1,
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, color: '#94a3b8' },
                        grid: { color: '#1e293b' }
                    },
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Format package name for display
export function formatPackageName(packageKey?: string) {
    const map: Record<string, string> = {
        'fullstack': 'Full-Stack',
        'ai_agent': 'AI Agent',
        'payment_gateway': 'Payment Gateway',
        'code_audit': 'Code Audit'
    };
    return packageKey ? (map[packageKey] || packageKey) : '—';
}

// Escape HTML to prevent XSS
export function escapeHtml(text: string) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show error message in a specific section
export function showError(section: string, message: string) {
    const container = document.getElementById(`${section}-error`);
    if (container) {
        container.textContent = message;
        container.style.display = 'block';
    }
    // Also try to show in the table body
    const tableBody = document.getElementById(`${section}-table-body`);
    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center; color: #ef4444; padding: 30px;">
                    ⚠️ ${message}
                </td>
            </tr>
        `;
    }
}

// ============================================
// LOAD ALL DATA ON PAGE LOAD
// ============================================

export async function loadDashboard() {
    // Show loading state
    document.querySelectorAll('.loading').forEach(el => {
        (el as HTMLElement).style.display = 'block';
    });

    // Fetch all data in parallel
    const [stats, bids, leads] = await Promise.all([
        fetchStats(),
        fetchBids(50),
        fetchLeads(20)
    ]);

    // Hide loading state
    document.querySelectorAll('.loading').forEach(el => {
        (el as HTMLElement).style.display = 'none';
    });

    // Update last updated timestamp
    const timestamp = document.getElementById('last-updated');
    if (timestamp) {
        timestamp.textContent = new Date().toLocaleString();
    }

    return { stats, bids, leads };
}

// ============================================
// AUTO-REFRESH (every 60 seconds)
// ============================================
let refreshInterval: any = null;

export function startAutoRefresh(intervalSeconds = 60) {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        console.log('🔄 Auto-refreshing dashboard data...');
        loadDashboard();
    }, intervalSeconds * 1000);
}

export function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

// ============================================
// INITIALIZATION
// ============================================
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        // Load data
        loadDashboard();

        // Start auto-refresh every 60 seconds
        startAutoRefresh(60);

        // Add manual refresh button if it exists
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                loadDashboard();
            });
        }

        console.log('🚀 Dashboard connected to backend:', API_BASE_URL);
    });
}
