'use client'

import { useMemo } from 'react'
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  RadialLinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Point,
} from 'chart.js'
import { Bar, Line, Radar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
)

type PublicationChartSeries = {
  label: string
  values: number[]
}

type PublicationChartBlockProps = {
  title: string
  subtitle?: string
  labels: string[]
  series: PublicationChartSeries[]
  chartType: 'bar' | 'line' | 'radar'
  yLabel?: string
  min?: number
  max?: number
  height?: number
}

const CHART_COLORS = [
  { border: '#0f766e', background: 'rgba(15, 118, 110, 0.16)' },
  { border: '#0f172a', background: 'rgba(15, 23, 42, 0.12)' },
  { border: '#2563eb', background: 'rgba(37, 99, 235, 0.14)' },
  { border: '#ea580c', background: 'rgba(234, 88, 12, 0.14)' },
  { border: '#7c3aed', background: 'rgba(124, 58, 237, 0.14)' },
  { border: '#be123c', background: 'rgba(190, 18, 60, 0.14)' },
] as const

export default function PublicationChartBlock({
  title,
  subtitle,
  labels,
  series,
  chartType,
  yLabel,
  min,
  max,
  height = 380,
}: PublicationChartBlockProps) {
  const chartData = useMemo<ChartData<'bar' | 'line' | 'radar'>>(
    () => ({
      labels,
      datasets: series.map((entry, index) => {
        const palette = CHART_COLORS[index % CHART_COLORS.length]

        return {
          label: entry.label,
          data: entry.values,
          borderColor: palette.border,
          backgroundColor: palette.background,
          borderWidth: 2,
          pointRadius: chartType === 'radar' ? 3 : 2.5,
          pointHoverRadius: 4,
          pointBackgroundColor: palette.border,
          tension: 0.28,
          fill: chartType !== 'bar',
        }
      }),
    }),
    [chartType, labels, series],
  )

  const options = useMemo<ChartOptions<'bar' | 'line' | 'radar'>>(() => {
    const scaleTitle = yLabel?.trim()
    const commonTicks = {
      color: '#475569',
      font: {
        size: 11,
      },
    }

    if (chartType === 'radar') {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#0f172a',
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 18,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
          },
        },
        scales: {
          r: {
            min,
            max,
            angleLines: {
              color: 'rgba(148, 163, 184, 0.28)',
            },
            grid: {
              color: 'rgba(148, 163, 184, 0.24)',
            },
            pointLabels: {
              color: '#0f172a',
              font: {
                size: 11,
              },
            },
            ticks: {
              ...commonTicks,
              backdropColor: 'transparent',
            },
            title: scaleTitle
              ? {
                  display: true,
                  text: scaleTitle,
                  color: '#334155',
                }
              : undefined,
          },
        },
      }
    }

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#0f172a',
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 18,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
        },
      },
      scales: {
        x: {
          ticks: commonTicks,
          grid: {
            display: false,
          },
        },
        y: {
          min,
          max,
          ticks: commonTicks,
          grid: {
            color: 'rgba(148, 163, 184, 0.18)',
          },
          title: scaleTitle
            ? {
                display: true,
                text: scaleTitle,
                color: '#334155',
              }
            : undefined,
        },
      },
    }
  }, [chartType, max, min, yLabel])

  const chart = chartType === 'line'
    ? (
        <Line
          data={chartData as ChartData<'line', (number | [number, number] | Point | null)[], unknown>}
          options={options as ChartOptions<'line'>}
        />
      )
    : chartType === 'radar'
      ? (
          <Radar
            data={chartData as ChartData<'radar', (number | [number, number] | Point | null)[], unknown>}
            options={options as ChartOptions<'radar'>}
          />
        )
      : (
          <Bar
            data={chartData as ChartData<'bar', (number | [number, number] | Point | null)[], unknown>}
            options={options as ChartOptions<'bar'>}
          />
        )

  return (
    <section className="my-10 overflow-hidden rounded-[1.6rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-700">Analytic Chart</div>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title}</h3>
            {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{subtitle}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">{chartType}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
              {series.length} {series.length === 1 ? 'series' : 'series'}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
              {labels.length} labels
            </span>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div style={{ height: `${height}px` }}>{chart}</div>
      </div>
    </section>
  )
}
