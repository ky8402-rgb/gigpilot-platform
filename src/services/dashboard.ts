// ============================================
// CONFIGURATION - Live Render Backend URL
// ============================================
export const API_BASE_URL = 'https://gigpilot-backend.onrender.com';

// ============================================
// FETCH FUNCTIONS
// ============================================

// Fetch dashboard statistics
export async function fetchStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/bids/stats`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        updateStatsUI(data);
        return data;
    } catch (error) {
        console.error('Error fetching stats:', error);
        showError('stats', 'Failed to load statistics. Backend may be starting up.');
        return null;
    }
}

// Fetch recent bids
export async function fetchBids(limit = 50) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/bids?limit=${limit}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        updateBidsTable(data);
        return data;
    } catch (error) {
        console.error('Error fetching bids:', error);
        showError('bids', 'Failed to load bids. Backend may be starting up.');
        return [];
    }
}

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

    tableBody.innerHTML = bids.map((bid: any) => `
        <tr class="border-b border-slate-800/60 hover:bg-slate-900/40 transition-colors">
            <td class="py-3 px-4 font-medium text-white">${escapeHtml(bid.job_title || bid.title || 'Unknown Project')}</td>
            <td class="py-3 px-4 text-slate-400">${escapeHtml(bid.company || bid.client_name || '—')}</td>
            <td class="py-3 px-4 text-indigo-300">${escapeHtml(formatPackageName(bid.package))}</td>
            <td class="py-3 px-4 font-mono font-semibold text-emerald-400">$${(Number(bid.bid_amount) || 0).toFixed(2)}</td>
            <td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
              bid.status === 'won' ? 'bg-emerald-500/20 text-emerald-300' :
              bid.status === 'active' || bid.status === 'submitted' ? 'bg-cyan-500/20 text-cyan-300' :
              bid.status === 'interviewing' ? 'bg-indigo-500/20 text-indigo-300' :
              'bg-slate-800 text-slate-400'
            }">${escapeHtml(bid.status || 'unknown')}</span></td>
            <td class="py-3 px-4 text-slate-400 text-xs">${bid.submitted_at ? new Date(bid.submitted_at).toLocaleDateString() : '—'}</td>
        </tr>
    `).join('');
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
