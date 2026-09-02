import React, { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

interface AnalyticsViewProps {
  onExportData: () => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ onExportData }) => {
  const doughnutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const barCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const doughnutChartRef = useRef<Chart | null>(null);
  const barChartRef = useRef<Chart | null>(null);

  useEffect(() => {
    // Render Doughnut Chart
    if (doughnutCanvasRef.current) {
      const ctx1 = doughnutCanvasRef.current.getContext('2d');
      if (ctx1) {
        if (doughnutChartRef.current) doughnutChartRef.current.destroy();
        doughnutChartRef.current = new Chart(ctx1, {
          type: 'doughnut',
          data: {
            labels: ['Web Dev', 'Design', 'Writing', 'Marketing', 'Other'],
            datasets: [{
              data: [32, 24, 18, 16, 10],
              backgroundColor: ['#4f7cff', '#2ecc71', '#f39c12', '#a855f7', '#5d6788'],
              borderWidth: 0,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: '#9aa2bf', font: { size: 10 }, boxWidth: 10, padding: 12 },
              },
            },
          },
        });
      }
    }

    // Render Bar Chart
    if (barCanvasRef.current) {
      const ctx2 = barCanvasRef.current.getContext('2d');
      if (ctx2) {
        if (barChartRef.current) barChartRef.current.destroy();
        barChartRef.current = new Chart(ctx2, {
          type: 'bar',
          data: {
            labels: ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
            datasets: [{
              label: 'Revenue (USD)',
              data: [320, 410, 380, 520, 490, 610],
              backgroundColor: 'rgba(79, 124, 255, 0.65)',
              borderColor: '#4f7cff',
              borderRadius: 6,
              borderWidth: 1,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: {
                grid: { color: 'rgba(255, 255, 255, 0.04)' },
                ticks: { color: '#5d6788', font: { size: 10 } },
              },
              x: {
                grid: { display: false },
                ticks: { color: '#5d6788', font: { size: 10 } },
              },
            },
          },
        });
      }
    }

    return () => {
      if (doughnutChartRef.current) {
        doughnutChartRef.current.destroy();
        doughnutChartRef.current = null;
      }
      if (barChartRef.current) {
        barChartRef.current.destroy();
        barChartRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-5">
      <div className="bg-[#161b2b] rounded-2xl border border-[#2a3147] p-6 shadow-lg">
        <div className="flex items-center justify-between pb-4 border-b border-[#2a3147] mb-5">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <i className="fas fa-chart-line text-[#4f7cff]"></i>
            Performance &amp; Category Analytics
          </h3>
          <button
            onClick={onExportData}
            className="text-xs text-[#4f7cff] hover:underline font-medium cursor-pointer"
          >
            Export Data →
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-[#11141f] rounded-xl p-4 border border-[#2a3147] h-[220px] flex flex-col justify-between">
            <span className="text-xs font-semibold text-[#9aa2bf]">Earnings Distribution by Category</span>
            <div className="h-[170px] relative">
              <canvas ref={doughnutCanvasRef}></canvas>
            </div>
          </div>

          <div className="bg-[#11141f] rounded-xl p-4 border border-[#2a3147] h-[220px] flex flex-col justify-between">
            <span className="text-xs font-semibold text-[#9aa2bf]">Monthly Revenue Trajectory ($ USD)</span>
            <div className="h-[170px] relative">
              <canvas ref={barCanvasRef}></canvas>
            </div>
          </div>
        </div>

        <div className="mt-5 p-4 bg-[#11141f] rounded-xl border border-[#2a3147]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-[#5d6788] block">Avg. Order Value</span>
              <strong className="text-white font-mono text-sm mt-0.5 block">$24.80 USD</strong>
            </div>
            <div>
              <span className="text-[#5d6788] block">Fastest Turnaround</span>
              <strong className="text-[#2ecc71] font-mono text-sm mt-0.5 block">12 min</strong>
            </div>
            <div>
              <span className="text-[#5d6788] block">Top Category</span>
              <strong className="text-[#4f7cff] font-mono text-sm mt-0.5 block">Web Development</strong>
            </div>
            <div>
              <span className="text-[#5d6788] block">Net Profit Margin</span>
              <strong className="text-[#2ecc71] font-mono text-sm mt-0.5 block">96.8%</strong>
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-xl bg-[#0b0d15] border border-[#20273a] flex flex-wrap items-center justify-between text-xs gap-3">
          <div className="flex items-center gap-2 text-[#9aa2bf]">
            <span className="w-2 h-2 rounded-full bg-[#2ecc71]"></span>
            <span>Analytics Engine: Active (SQLite &amp; In-Memory Stream Real-Time Sync)</span>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">Last 30 Days Rolling Window</span>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsView;
