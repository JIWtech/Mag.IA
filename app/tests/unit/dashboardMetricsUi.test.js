import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const componentSource = readFileSync(new URL('../../src/features/dashboard/components/DashboardMetrics.jsx', import.meta.url), 'utf8');
const dashboardCss = readFileSync(new URL('../../src/styles/pages/dashboard.css', import.meta.url), 'utf8');

test('dashboard metrics use one standardized sparkline component', () => {
  assert.match(componentSource, /function MetricSparkline/);
  assert.match(componentSource, /cards\.map/);
  assert.match(componentSource, /<MetricSparkline/);
  assert.doesNotMatch(componentSource, /function ActivityBars|function ShareRing|function QualificationMeter/);
});

test('standardized sparklines preserve gradient, glow, and live endpoint effects', () => {
  assert.match(componentSource, /className="metric-sparkline-area"/);
  assert.match(componentSource, /className="metric-sparkline-line"/);
  assert.match(componentSource, /className="metric-sparkline-pulse"/);
  assert.match(dashboardCss, /\.metric-sparkline-line\s*\{[^}]*filter:\s*drop-shadow/s);
  assert.match(dashboardCss, /\.metric-sparkline-pulse\s*\{[^}]*animation:/s);
});
