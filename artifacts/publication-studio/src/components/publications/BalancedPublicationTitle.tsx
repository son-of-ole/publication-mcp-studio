'use client'

import { layout, layoutWithLines, prepareWithSegments, walkLineRanges } from '@chenglou/pretext'
import { useEffect, useRef, useState } from 'react'

type BalancedPublicationTitleProps = {
  text: string
  className?: string
}

type BalancedTitleLayout = {
  fontSize: number
  lineHeight: number
  width: number
  lines: string[]
}

function getResponsiveTitleMetrics(width: number) {
  if (width >= 960) {
    return { fontSize: 64, lineHeight: 66 }
  }

  if (width >= 760) {
    return { fontSize: 54, lineHeight: 58 }
  }

  if (width >= 560) {
    return { fontSize: 44, lineHeight: 48 }
  }

  return { fontSize: 34, lineHeight: 40 }
}

function buildFont(fontSize: number) {
  return `700 ${fontSize}px Georgia, "Iowan Old Style", "Times New Roman", serif`
}

function findBalancedWidth(text: string, maxWidth: number, fontSize: number, lineHeight: number): BalancedTitleLayout | null {
  const font = buildFont(fontSize)
  let prepared
  try {
    prepared = prepareWithSegments(text, font)
  } catch {
    return null
  }
  if (!prepared) return null
  const baseline = layout(prepared, maxWidth, lineHeight)

  if (baseline.lineCount <= 1) {
    const singleLine = layoutWithLines(prepared, maxWidth, lineHeight)
    const measuredWidth = singleLine.lines[0]?.width ?? maxWidth
    return {
      fontSize,
      lineHeight,
      width: Math.min(maxWidth, Math.ceil(measuredWidth)),
      lines: singleLine.lines.map((line) => line.text),
    }
  }

  let low = Math.max(240, Math.floor(maxWidth * 0.52))
  let high = Math.max(low, Math.floor(maxWidth))
  let bestWidth = high

  while (low <= high) {
    const candidate = Math.floor((low + high) / 2)
    const candidateLayout = layout(prepared, candidate, lineHeight)

    if (candidateLayout.lineCount > baseline.lineCount) {
      low = candidate + 1
    } else {
      bestWidth = candidate
      high = candidate - 1
    }
  }

  let lineCount = 0
  let widestLine = 0
  walkLineRanges(prepared, bestWidth, (line) => {
    lineCount += 1
    widestLine = Math.max(widestLine, line.width)
  })

  const lines = layoutWithLines(prepared, bestWidth, lineHeight).lines.map((line) => line.text)

  return {
    fontSize,
    lineHeight,
    width: Math.min(bestWidth, Math.ceil(widestLine)),
    lines: lineCount > 0 ? lines : [text],
  }
}

export default function BalancedPublicationTitle({
  text,
  className,
}: BalancedPublicationTitleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [titleLayout, setTitleLayout] = useState<BalancedTitleLayout | null>(null)

  useEffect(() => {
    const element = containerRef.current

    if (!element) {
      return
    }

    let cancelled = false

    const recompute = async () => {
      const width = element.clientWidth

      if (width <= 0) {
        return
      }

      if ('fonts' in document) {
        await document.fonts.ready
      }

      if (cancelled) {
        return
      }

      const metrics = getResponsiveTitleMetrics(width)
      const nextLayout = findBalancedWidth(text, width, metrics.fontSize, metrics.lineHeight)

      if (!cancelled) {
        setTitleLayout(nextLayout)
      }
    }

    const observer = new ResizeObserver(() => {
      void recompute()
    })

    observer.observe(element)
    void recompute()

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [text])

  return (
    <div ref={containerRef} className={className}>
      {titleLayout ? (
        <div
          className="mx-auto"
          style={{
            width: `${titleLayout.width}px`,
            maxWidth: '100%',
          }}
        >
          {titleLayout.lines.map((line, index) => (
            <div
              key={`${line}-${index}`}
              style={{
                fontFamily: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
                fontSize: `${titleLayout.fontSize}px`,
                fontWeight: 700,
                lineHeight: `${titleLayout.lineHeight}px`,
                letterSpacing: '-0.03em',
              }}
            >
              {line}
            </div>
          ))}
        </div>
      ) : (
        <h1 className="mx-auto text-center text-4xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl">
          {text}
        </h1>
      )}
    </div>
  )
}
