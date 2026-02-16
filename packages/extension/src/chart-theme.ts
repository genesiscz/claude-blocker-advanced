// Shared ApexCharts theme configuration matching the extension's dark UI

const COLORS = {
  working: '#22c55e',
  waiting: '#f59e0b',
  idle: '#6b7280',
  cost: '#FFD700',
  costSecondary: '#FFA500',
  cumulative: '#22c55e',
  gridLine: 'rgba(255, 255, 255, 0.06)',
  tooltipBg: 'rgba(17, 17, 17, 0.95)',
  textPrimary: 'rgba(255, 255, 255, 0.9)',
  textSecondary: 'rgba(255, 255, 255, 0.5)',
} as const;

export function getBaseChartOptions(): ApexCharts.ApexOptions {
  return {
    chart: {
      background: 'transparent',
      fontFamily: "'DM Mono', monospace",
      toolbar: {
        show: false,
      },
      animations: {
        enabled: true,
        easing: 'easeinout',
        speed: 600,
        dynamicAnimation: { enabled: true, speed: 350 },
      },
      zoom: {
        enabled: false,
      },
    },
    theme: {
      mode: 'dark',
    },
    grid: {
      borderColor: COLORS.gridLine,
      strokeDashArray: 3,
      padding: { left: 8, right: 8, top: 0, bottom: 0 },
    },
    tooltip: {
      theme: 'dark',
      style: {
        fontSize: '12px',
        fontFamily: "'DM Mono', monospace",
      },
      y: {
        formatter: undefined, // Override per chart
      },
    },
    xaxis: {
      labels: {
        style: {
          colors: COLORS.textSecondary,
          fontSize: '11px',
          fontFamily: "'DM Mono', monospace",
        },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: {
          colors: COLORS.textSecondary,
          fontSize: '11px',
          fontFamily: "'DM Mono', monospace",
        },
      },
    },
    states: {
      hover: {
        filter: { type: 'lighten', value: 0.1 },
      },
      active: {
        filter: { type: 'darken', value: 0.1 },
      },
    },
  };
}

export { COLORS };
