// packages/extension/src/chart-theme.ts
import {
  Chart,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';

// Register all components once
Chart.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  Filler,
  Tooltip,
  Legend,
  zoomPlugin,
);

const COLORS = {
  working: '#22c55e',
  workingAlpha: 'rgba(34, 197, 94, 0.6)',
  waiting: '#f59e0b',
  waitingAlpha: 'rgba(245, 158, 11, 0.6)',
  idle: '#6b7280',
  idleAlpha: 'rgba(107, 114, 128, 0.6)',
  cost: '#FFD700',
  costAlpha: 'rgba(255, 215, 0, 0.15)',
  costSecondary: '#FFA500',
  cumulative: '#22c55e',
  cumulativeAlpha: 'rgba(34, 197, 94, 0.15)',
  gridLine: 'rgba(255, 255, 255, 0.06)',
  tooltipBg: 'rgba(17, 17, 17, 0.95)',
  textPrimary: 'rgba(255, 255, 255, 0.9)',
  textSecondary: 'rgba(255, 255, 255, 0.5)',
} as const;

// Set global Chart.js defaults for dark theme
Chart.defaults.color = COLORS.textSecondary;
Chart.defaults.borderColor = COLORS.gridLine;
Chart.defaults.font.family = "'DM Mono', monospace";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.tooltip.backgroundColor = COLORS.tooltipBg;
Chart.defaults.plugins.tooltip.titleFont = { family: "'DM Mono', monospace", size: 11, weight: 'normal' };
Chart.defaults.plugins.tooltip.bodyFont = { family: "'DM Mono', monospace", size: 12, weight: 'normal' };
Chart.defaults.plugins.tooltip.borderColor = 'rgba(255, 255, 255, 0.08)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.displayColors = true;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
Chart.defaults.animation = { duration: 600, easing: 'easeInOutQuart' };
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;

export { Chart, COLORS };
