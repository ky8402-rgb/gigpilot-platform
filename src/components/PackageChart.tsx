import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

// Register Chart.js components
Chart.register(...registerables);

interface PackageChartProps {
  packageCounts?: Record<string, number>;
  isLoading?: boolean;
}

const PACKAGE_NAME_MAP: Record<string, string> = {
  fullstack: 'Full-Stack',
  full_stack: 'Full-Stack',
  ai_agent: 'AI Agent',
  'ai-agent': 'AI Agent',
  payment_gateway: 'Payment Gateway',
  code_audit: 'Code Audit'
};

export const formatPackageName = (key?: string): string => {
  if (!key) return 'General';
  const clean = String(key).toLowerCase().trim();
  return PACKAGE_NAME_MAP[clean] || key;
};

export const PackageChart: React.FC<PackageChartProps> = ({ packageCounts, isLoading }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Standard package categories
    const standardKeys = ['fullstack', 'ai_agent', 'payment_gateway', 'code_audit'];
    
    // Merge standard keys with any additional keys in packageCounts
    const allKeys = Array.from(new Set([...standardKeys, ...Object.keys(packageCounts || {})]));
    
    const labels = allKeys.map(k => formatPackageName(k));
    const dataValues = allKeys.map(k => (packageCounts && typeof packageCounts[k] === 'number' ? packageCounts[k] : 0));

    // Destroy existing instance before creating new one
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const backgroundColors = [
      'rgba(59, 130, 246, 0.85)',   // Blue
      'rgba(99, 102, 241, 0.85)',   // Indigo
      'rgba(16, 185, 129, 0.85)',   // Emerald
      'rgba(245, 158, 11, 0.85)',   // Amber
      'rgba(168, 85, 247, 0.85)',   // Purple
      'rgba(236, 72, 153, 0.85)'    // Pink
    ];

    const borderColors = [
      '#3b82f6',
      '#6366f1',
      '#10b981',
      '#f59e0b',
      '#a855f7',
      '#ec4899'
    ];

    chartInstanceRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Bids Placed',
            data: dataValues,
            backgroundColor: backgroundColors.slice(0, labels.length),
            borderColor: borderColors.slice(0, labels.length),
            borderWidth: 1.5,
            borderRadius: 8,
            barThickness: 38,
            maxBarThickness: 50
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#f8fafc',
            bodyColor: '#94a3b8',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            callbacks: {
              label: (context) => ` ${context.parsed.y} bids placed`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
              color: '#64748b',
              font: {
                family: 'JetBrains Mono, monospace',
                size: 11
              }
            },
            grid: {
              color: 'rgba(30, 41, 59, 0.6)'
            },
            border: {
              dash: [4, 4]
            }
          },
          x: {
            ticks: {
              color: '#94a3b8',
              font: {
                family: 'Plus Jakarta Sans, sans-serif',
                weight: 'bold',
                size: 12
              }
            },
            grid: {
              display: false
            }
          }
        }
      }
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [packageCounts]);

  return (
    <div className="relative w-full h-[240px]">
      {isLoading && (
        <div className="absolute inset-0 bg-[#111726]/70 backdrop-blur-xs flex items-center justify-center z-10 rounded-xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-400">
            <i className="fas fa-spinner fa-spin text-sm"></i>
            <span>Updating package telemetry...</span>
          </div>
        </div>
      )}
      <canvas id="package-chart" ref={canvasRef} />
    </div>
  );
};
