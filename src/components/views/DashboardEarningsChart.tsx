import React, { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

interface DashboardEarningsChartProps {
  todayEarnings: number;
}

export const DashboardEarningsChart: React.FC<DashboardEarningsChartProps> = ({ todayEarnings }) => {
  const earningsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const earningsChartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    if (earningsCanvasRef.current) {
      const ctx = earningsCanvasRef.current.getContext('2d');
      if (ctx) {
        if (earningsChartInstance.current) {
          earningsChartInstance.current.destroy();
        }

        const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const dayWeights = [0.45, 0.6, 0.72, 0.85, 0.9, 0.95, 1.0];
        const data = labels.map((_, i) => Math.max(0, parseFloat((todayEarnings * dayWeights[i]).toFixed(2))));

        earningsChartInstance.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Earnings (USD)',
              data: data,
              borderColor: '#4f7cff',
              backgroundColor: 'rgba(79, 124, 255, 0.12)',
              borderWidth: 2.5,
              fill: true,
              tension: 0.3,
              pointBackgroundColor: '#4f7cff',
              pointBorderColor: '#0b0d15',
              pointBorderWidth: 2,
              pointRadius: 4,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: '#161b2b',
                titleColor: '#f0f3fa',
                bodyColor: '#9aa2bf',
                borderColor: '#2a3147',
                borderWidth: 1,
                padding: 10,
              },
            },
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
      if (earningsChartInstance.current) {
        earningsChartInstance.current.destroy();
        earningsChartInstance.current = null;
      }
    };
  }, [todayEarnings]);

  return (
    <div className="h-[180px] w-full relative">
      <canvas ref={earningsCanvasRef}></canvas>
    </div>
  );
};

export default DashboardEarningsChart;
