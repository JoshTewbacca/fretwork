// Dependency-free inline SVG bar chart. Scales to its container width via
// viewBox + preserveAspectRatio rather than any fixed pixel width, and uses
// currentColor so it inherits the surrounding text color (see stats.css for
// how StatsPanel sets that).

import type { JSX } from 'preact'

export interface SparklineProps {
  points: number[]
  labels?: string[]
  height?: number
  ariaLabel: string
}

const UNIT_WIDTH = 10
const BAR_GAP_RATIO = 0.3

export function Sparkline({ points, labels, height = 40, ariaLabel }: SparklineProps): JSX.Element {
  const count = points.length
  const width = Math.max(count, 1) * UNIT_WIDTH
  const max = points.reduce((m, v) => Math.max(m, v), 0)

  const unit = count > 0 ? width / count : 0
  const gap = unit * BAR_GAP_RATIO
  const barWidth = Math.max(unit - gap, 0)

  return (
    <svg
      class="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      {points.map((value, i) => {
        // All-zero series: draw a flat baseline tick instead of dividing by
        // a zero max (which would otherwise yield NaN heights).
        const barHeight = max > 0 ? (value / max) * (height - 2) : 1
        const x = i * unit + gap / 2
        const y = height - barHeight
        const label = labels?.[i]
        return (
          <rect key={i} x={x} y={y} width={barWidth} height={barHeight} fill="currentColor">
            {label ? <title>{`${label}: ${value}`}</title> : null}
          </rect>
        )
      })}
    </svg>
  )
}
