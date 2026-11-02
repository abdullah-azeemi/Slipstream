'use client'

import { use, useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react'
import '@/components/landing/landing.css'
import { geist, geistMono } from '@/components/landing/font'
import { TabList, ToggleGroup } from '@/components/landing/Tabs'
import { api, telemetryApi } from '@/lib/api'
import {
  getSegmentDriverNumbers,
  getSegmentEntries,
  getSegmentLapByDriver,
  getQualifyingAdvancePosition,
  reconcileSelectedDrivers,
  type QualiSegmentsData,
} from '@/lib/telemetry-quali'
import { createHoverClearController } from '@/lib/hover-clear'
import { teamColour, formatLapTime } from '@/lib/utils'
import type { Driver, TelemetrySample } from '@/types/f1'
import PracticeAnalysis from '@/components/analysis/PracticeAnalysis'
import BrakingAnalysis from '@/components/analysis/BrakingAnalysis'
import CornerInsights from '@/components/analysis/CornerInsights'
import QualiSpeedPanel from '@/components/telemetry/QualiSpeedPanel'
import SvgSpeedTrace from '@/components/telemetry/SvgSpeedTrace'
import LapStory, { type LapStoryDriver } from '@/components/telemetry/LapStory'
import { C, InlineMessage, Panel, PanelHeader } from '@/components/telemetry/telemetry-ui'
import {
  CHARTS, PAD, chartCoords, drawCrosshair, drawDots, drawGrid, drawLine, drawSpeedGapFill, type DriverRenderData,
} from '@/components/telemetry/chart-draw'
import { GapToLeaderChart, PerformanceMatrix, SectorHeroCards, TelemetryDecisionHero } from '@/components/telemetry/ComparisonPanels'
import {
  fetchTelemetryCompare, getErrorMessage, interpolateSamples, isPracticeSession, isRaceSession,
  type DriverSectorTimes, type Interp, type TooltipSnapshot,
} from '@/lib/telemetry-math'
import dynamic from 'next/dynamic'
import type { InsightsData } from '@/components/analysis/BrakingAnalysis'

const LapTimeDistribution = dynamic(() => import('@/components/analysis/LapTimeDistribution'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 20, border: '1px solid #D9E3EF', borderRadius: 18, background: '#FFFFFF' }}>
      <div style={{ fontSize: 12, color: '#7D8BA2', fontFamily: 'inherit' }}>Loading lap data...</div>
    </div>
  ),
})

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

type TabKey = 'pace' | 'driving' | 'inputs' | 'data'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TelemetryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const sessionKey = parseInt(key)

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [isMobile, setIsMobile] = useState(false)
  const [telData, setTelData] = useState<Map<number, Interp>>(new Map())
  const [tooltipNx, setTooltipNx] = useState<number | null>(null)
  const [tooltipData, setTooltipData] = useState<TooltipSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [telemetryError, setTelemetryError] = useState<string | null>(null)
  const [sessionType, setSessionType] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState<string>('')
  const [session, setSession] = useState<import('@/types/f1').Session | null>(null)
  const [sectorTimes, setSectorTimes] = useState<Map<number, DriverSectorTimes>>(new Map())
  const [telLapNumbers, setTelLapNumbers] = useState<Map<number, number>>(new Map())
  const [qualiSegments, setQualiSegments] = useState<QualiSegmentsData | null>(null)
  const [telStats, setTelStats] = useState<import('@/types/f1').DriverTelemetryStats[]>([])
  const [activeSegment, setActiveSegment] = useState<'Q1' | 'Q2' | 'Q3'>('Q1')
  const [selectedSegment, setSelectedSegment] = useState<'Q1' | 'Q2' | 'Q3'>('Q3')
  const [cornerInsights, setCornerInsights] = useState<InsightsData | null>(null)
  const [insightDriverColours, setInsightDriverColours] = useState<Record<string, string>>({})
  const [chartWidth, setChartWidth] = useState(0)
  const [tab, setTab] = useState<TabKey>('pace')

  const chartRefs = useRef<(HTMLCanvasElement | null)[]>([null, null, null, null])
  const deltaRef = useRef<HTMLCanvasElement | null>(null)
  const trackRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartMeasureRef = useRef<HTMLDivElement | null>(null)
  const hoverClearControllerRef = useRef<ReturnType<typeof createHoverClearController> | null>(null)

  const segmentEntries = getSegmentEntries(qualiSegments, selectedSegment)
  const segmentDriverNumbers = getSegmentDriverNumbers(segmentEntries)
  const segmentLapByDriver = getSegmentLapByDriver(segmentEntries)
  const isQualifying = !isRaceSession(sessionType) && !isPracticeSession(sessionType)
  const showTelemetry = isQualifying || isRaceSession(sessionType)
  const selectedKey = selected.join(',')

  // Session + drivers
  useEffect(() => {
    let active = true
    api.sessions.get(sessionKey).then(s => {
      if (!active) return
      setSession(s)
      setSessionType(s.session_type ?? null)
      setSessionName(s.session_name || s.gp_name || 'Session')
    }).catch(() => { })
    api.drivers.list(sessionKey).then(d => {
      if (!active) return
      setDrivers(d)
      if (d.length >= 2) setSelected([d[0].driver_number, d[1].driver_number])
    }).catch(() => { })

    const handleResize = () => setIsMobile(window.innerWidth < 1024)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => {
      active = false
      window.removeEventListener('resize', handleResize)
    }
  }, [sessionKey])

  useEffect(() => {
    const node = chartMeasureRef.current ?? containerRef.current
    if (!node) return

    const updateWidth = () => {
      const measured = Math.max(320, Math.floor(node.clientWidth))
      setChartWidth(prev => prev === measured ? prev : measured)
    }

    updateWidth()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateWidth())
      observer.observe(node)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  // Reconcile selection for qualifying
  useEffect(() => {
    if (!sessionType || !isQualifying || !qualiSegments?.segments) return
    setSelected(prev => {
      const next = reconcileSelectedDrivers(prev, drivers, segmentDriverNumbers)
      return next.length === prev.length && next.every((dn, i) => dn === prev[i]) ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, qualiSegments, selectedSegment, sessionType])

  // Telemetry fetch
  useEffect(() => {
    if (!selected.length || !sessionType || !showTelemetry) {
      setLoading(false)
      setTelemetryError(null)
      setTelData(new Map())
      setTelLapNumbers(new Map())
      return
    }

    const abort = new AbortController()
    let active = true

    const buildLapsParam = () => {
      if (!qualiSegments?.segments) return undefined
      const entries = qualiSegments.segments[selectedSegment]
      if (!entries?.length) return undefined
      const pairs = selected.map(dn => {
        const e = entries.find(x => x.driver_number === dn)
        return e ? `${dn}:${e.lap_number}` : null
      }).filter(Boolean)
      return pairs.length ? pairs.join(',') : undefined
    }
    setLoading(true)
    setTelemetryError(null)
    setTelData(new Map())
    setTelLapNumbers(new Map())
    setSectorTimes(new Map())
    fetchTelemetryCompare(sessionKey, selected, buildLapsParam(), abort.signal)
      .then(({ samples, lapNumbers }) => {
        if (!active) return
        setTelLapNumbers(lapNumbers)
        const byDriver = new Map<number, TelemetrySample[]>()
        samples.forEach(s => {
          if (s.driver_number != null) {
            if (!byDriver.has(s.driver_number)) byDriver.set(s.driver_number, [])
            byDriver.get(s.driver_number)!.push(s)
          }
        })
        const interped = new Map<number, Interp>()
        byDriver.forEach((rows, dn) => interped.set(dn, interpolateSamples(rows)))
        setTelData(interped)
        if (!interped.size) setTelemetryError('No telemetry samples were returned for the selected comparison.')
      })
      .catch(err => {
        if (!active || abort.signal.aborted) return
        setTelemetryError(getErrorMessage(err, 'Failed to load telemetry comparison'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      abort.abort()
    }
  }, [sessionKey, selected, selectedKey, sessionType, selectedSegment, qualiSegments, showTelemetry])

  // Sector times
  useEffect(() => {
    if (!selected.length || !telLapNumbers.size) {
      setSectorTimes(new Map())
      return
    }
    let active = true
    Promise.all(selected.map(async dn => {
      try {
        const laps = await api.laps.list(sessionKey, dn)
        const telLap = telLapNumbers.get(dn)
        const matched = laps.find(l => l.lap_number === telLap)
          ?? laps.reduce((best, l) => (l.lap_time_ms ?? Infinity) < (best.lap_time_ms ?? Infinity) ? l : best, laps[0])
        if (!matched) return null
        return { driverNum: dn, times: { s1_ms: matched.s1_ms ?? null, s2_ms: matched.s2_ms ?? null, s3_ms: matched.s3_ms ?? null, lap_number: matched.lap_number } as DriverSectorTimes }
      } catch { return null }
    })).then(results => {
      if (!active) return
      const map = new Map<number, DriverSectorTimes>()
      results.forEach(r => { if (r) map.set(r.driverNum, r.times) })
      setSectorTimes(map)
    })
    return () => {
      active = false
    }
  }, [sessionKey, selected, selectedKey, telLapNumbers])

  // Quali segments
  useEffect(() => {
    if (!sessionType || !showTelemetry) {
      setQualiSegments(null)
      return
    }
    const abort = new AbortController()
    let active = true
    fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/quali-segments`, { signal: abort.signal })
      .then(r => {
        if (!r.ok) throw new Error('Failed to load qualifying segments')
        return r.json()
      })
      .then((data: QualiSegmentsData) => {
        if (!active) return
        setQualiSegments(data)
      })
      .catch(() => { })
    return () => {
      active = false
      abort.abort()
    }
  }, [sessionKey, sessionType, showTelemetry])

  // Tel stats
  useEffect(() => {
    if (!selected.length) {
      setTelStats([])
      return
    }
    let active = true
    telemetryApi.stats(sessionKey, selected).then(stats => {
      if (!active) return
      setTelStats(stats)
    }).catch(() => { })
    return () => {
      active = false
    }
  }, [sessionKey, selected, selectedKey])

  useEffect(() => {
    hoverClearControllerRef.current = createHoverClearController(() => {
      setTooltipNx(null)
      setTooltipData(null)
    })

    return () => {
      hoverClearControllerRef.current?.dispose()
    }
  }, [])

  const driverData: DriverRenderData[] = selected.map(dn => {
    const interp = telData.get(dn)
    const d = drivers.find(x => x.driver_number === dn)
    if (!interp || !d) return null
    return { interp, colour: teamColour(d.team_colour, d.team_name), abbr: d.abbreviation }
  }).filter(Boolean) as DriverRenderData[]
  const usedTraceColours = new Set<string>()
  const comparisonTraceColours = [C.red, '#2563EB', C.green]
  driverData.forEach((driver, index) => {
    const colourKey = driver.colour.toLowerCase()
    if (usedTraceColours.has(colourKey)) {
      const fallback = comparisonTraceColours.find(candidate => !usedTraceColours.has(candidate.toLowerCase()))
      if (fallback) driverData[index] = { ...driver, colour: fallback }
    }
    usedTraceColours.add(driverData[index].colour.toLowerCase())
  })
  const telemetryReady = !loading
    && selected.length > 0
    && selected.every(dn => {
      const interp = telData.get(dn)
      return Boolean(interp && interp.dist.length > 1 && interp.speed.length > 1)
    })
  const hoverActive = Boolean(tooltipData?.values.length)

  const lapStoryDrivers: LapStoryDriver[] = driverData.map(d => {
    const dn = drivers.find(x => x.abbreviation === d.abbr)?.driver_number
    const st = dn !== undefined ? sectorTimes.get(dn) : undefined
    return {
      abbr: d.abbr,
      colour: d.colour,
      speed: d.interp.speed,
      dist: d.interp.dist,
      throttle: d.interp.throttle,
      s1_ms: st?.s1_ms ?? null,
      s2_ms: st?.s2_ms ?? null,
      s3_ms: st?.s3_ms ?? null,
      lapNumber: dn !== undefined ? (telLapNumbers.get(dn) ?? null) : null,
    }
  })

  const comparisonRows = driverData.map(d => {
    const driver = drivers.find(item => item.abbreviation === d.abbr)
    const sectors = driver ? sectorTimes.get(driver.driver_number) : undefined
    const lapMs = sectors?.s1_ms != null && sectors.s2_ms != null && sectors.s3_ms != null
      ? sectors.s1_ms + sectors.s2_ms + sectors.s3_ms
      : null
    const fullThrottle = d.interp.throttle.length
      ? (d.interp.throttle.filter(value => value >= 98).length / d.interp.throttle.length) * 100
      : null
    return {
      ...d,
      driver,
      lapMs,
      minSpeed: d.interp.speed.length ? Math.round(Math.min(...d.interp.speed)) : null,
      maxSpeed: d.interp.speed.length ? Math.round(Math.max(...d.interp.speed)) : null,
      fullThrottle,
    }
  })
  const theoreticalBest = ['s1_ms', 's2_ms', 's3_ms'].reduce((total, key) => {
    const values = comparisonRows.map(row => row.driver ? sectorTimes.get(row.driver.driver_number)?.[key as 's1_ms' | 's2_ms' | 's3_ms'] ?? null : null).filter((value): value is number => value !== null)
    return (total !== null && values.length) ? total + Math.min(...values) : null
  }, 0 as number | null)

  // Canvas render
  useEffect(() => {
    if (!driverData.length || !isQualifying || !chartWidth || !telemetryReady) return
    const raf = window.requestAnimationFrame(() => {
      const W = chartWidth
      const sectorTrackColours = [C.red + '50', C.gold + '50', C.purple + '50']

      CHARTS.forEach((cfg, i) => {
        const canvas = chartRefs.current[i]
        if (!canvas) return
        canvas.width = W
        canvas.height = cfg.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const lapKm = (driverData[0]?.interp.dist.at(-1) ?? 0) / 1000
        drawGrid(ctx, W, cfg.height, cfg.yMin, cfg.yMax, cfg.gridCount, cfg.isRpm, cfg.field === 'speed' ? progress => `${(progress * lapKm).toFixed(1)} km` : undefined)
        if (cfg.field === 'speed') {
          drawSpeedGapFill(ctx, W, cfg.height, driverData, cfg.yMin, cfg.yMax)
          driverData.forEach((d, idx) => drawLine(ctx, d.interp.speed, d.colour, W, cfg.height, cfg.yMin, cfg.yMax, idx === 0 ? 3.8 : 3.2, driverData.length > 2 && idx % 2 !== 0))
        } else if (cfg.field === 'brake') {
          driverData.forEach((d, idx) => {
            drawLine(ctx, d.interp.brake, d.colour, W, cfg.height, 0, 100, 1.8, idx % 2 !== 0, false)
          })
        } else if (cfg.field === 'throttle') {
          driverData.forEach((d, idx) => {
            drawLine(ctx, d.interp.throttle, d.colour, W, cfg.height, 0, 100, 1.8, idx % 2 !== 0)
          })
        } else {
          driverData.forEach((d, idx) => {
            drawLine(ctx, d.interp.rpm, d.colour, W, cfg.height, cfg.yMin, cfg.yMax, 1.8, idx % 2 !== 0)
          })
        }
        if (tooltipNx !== null) {
          drawCrosshair(ctx, tooltipNx, W, cfg.height)
          drawDots(ctx, tooltipNx, W, cfg.height, driverData, cfg.field, cfg.yMin, cfg.yMax)
        }
      })

      if (deltaRef.current && driverData.length >= 2) {
        const H_DELTA = 160
        const canvas = deltaRef.current
        canvas.width = W
        canvas.height = H_DELTA
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const a = driverData[0].interp.speed
        const b = driverData[1].interp.speed
        const n = Math.min(a.length, b.length)
        const deltas = Array.from({ length: n }, (_, i) => a[i] - b[i])
        const maxD = Math.max(...deltas.map(Math.abs), 15)
        const { cW, cH } = chartCoords(W, H_DELTA)
        const midY = PAD.top + cH / 2
        ctx.fillStyle = C.surface
        ctx.fillRect(0, 0, W, H_DELTA)
        ctx.beginPath()
        ctx.strokeStyle = C.borderMid
        ctx.lineWidth = 1
        ctx.moveTo(PAD.left, midY)
        ctx.lineTo(PAD.left + cW, midY)
        ctx.stroke()
        for (const m of [-1, -0.5, 0.5, 1]) {
          const y = midY - m * cH / 2
          ctx.fillStyle = C.textDim
          ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.textAlign = 'right'
          ctx.fillText((m * maxD).toFixed(0), PAD.left - 8, y + 4)
          if (m !== 0) {
            ctx.beginPath()
            ctx.strokeStyle = C.border
            ctx.lineWidth = 1
            ctx.moveTo(PAD.left, y)
            ctx.lineTo(PAD.left + cW, y)
            ctx.stroke()
          }
        }
        ctx.beginPath()
        ctx.moveTo(PAD.left, midY)
        deltas.forEach((d, i) => ctx.lineTo(PAD.left + (i / (n - 1)) * cW, midY - (d / maxD) * (cH / 2)))
        ctx.lineTo(PAD.left + cW, midY)
        ctx.closePath()
        const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH)
        grad.addColorStop(0, driverData[0].colour + '22')
        grad.addColorStop(0.5, 'rgba(0,0,0,0)')
        grad.addColorStop(1, driverData[1].colour + '22')
        ctx.fillStyle = grad
        ctx.fill()
        drawLine(ctx, deltas, C.borderMid, W, H_DELTA, -maxD, maxD, 1.5)
        if (tooltipNx !== null) {
          const cx = PAD.left + tooltipNx * cW
          const idx = Math.round(tooltipNx * (n - 1))
          const d = deltas[idx] ?? 0
          const cy = midY - (d / maxD) * (cH / 2)
          drawCrosshair(ctx, tooltipNx, W, 96)
          ctx.save()
          ctx.shadowColor = d >= 0 ? driverData[0].colour : driverData[1].colour
          ctx.shadowBlur = 6
          ctx.beginPath()
          ctx.arc(cx, cy, 4, 0, Math.PI * 2)
          ctx.fillStyle = d >= 0 ? driverData[0].colour : driverData[1].colour
          ctx.fill()
          ctx.restore()
          ctx.fillStyle = C.textBright
          ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.textAlign = cx > PAD.left + cW / 2 ? 'right' : 'left'
          ctx.fillText(`${d >= 0 ? '+' : ''}${d.toFixed(1)}`, cx + (cx > PAD.left + cW / 2 ? -10 : 10), PAD.top + 20)
        }
      }

      const trackX = driverData[0]?.interp.x ?? []
      const trackY = driverData[0]?.interp.y ?? []
      const hasTrackShape =
        trackX.length > 1
        && trackY.length === trackX.length
        && trackX.every(Number.isFinite)
        && trackY.every(Number.isFinite)

      if (trackRef.current && hasTrackShape && tab === 'inputs') {
        const canvas = trackRef.current
        canvas.width = W
        canvas.height = 300
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = C.surface
        ctx.fillRect(0, 0, W, 300)
        const xs = trackX
        const ys = trackY
        const n = xs.length
        const xMin = Math.min(...xs)
        const xMax = Math.max(...xs)
        const yMin = Math.min(...ys)
        const yMax = Math.max(...ys)
        const mp = 48
        const scale = Math.min((W - mp * 2) / (xMax - xMin || 1), (300 - mp * 2) / (yMax - yMin || 1)) * 0.92
        const offX = (W - (xMax - xMin) * scale) / 2 - xMin * scale
        const offY = (300 - (yMax - yMin) * scale) / 2 - yMin * scale
        const tx = (x: number) => x * scale + offX
        const ty = (y: number) => y * scale + offY
        ctx.beginPath()
        xs.forEach((x, i) => i === 0 ? ctx.moveTo(tx(x), ty(ys[i])) : ctx.lineTo(tx(x), ty(ys[i])))
        ctx.closePath()
        ctx.strokeStyle = C.borderMid
        ctx.lineWidth = 20
        ctx.lineJoin = 'round'
        ctx.stroke()
        sectorTrackColours.forEach((col, si) => {
          const s = Math.floor(si * n / 3)
          const e = Math.floor((si + 1) * n / 3)
          ctx.beginPath()
          for (let i = s; i <= e; i++) {
            if (i === s) ctx.moveTo(tx(xs[i]), ty(ys[i]))
            else ctx.lineTo(tx(xs[i]), ty(ys[i]))
          }
          ctx.strokeStyle = col
          ctx.lineWidth = 14
          ctx.lineJoin = 'round'
          ctx.stroke()
        })
        ctx.beginPath()
        xs.forEach((x, i) => i === 0 ? ctx.moveTo(tx(x), ty(ys[i])) : ctx.lineTo(tx(x), ty(ys[i])))
        ctx.closePath()
        ctx.strokeStyle = 'rgba(148,163,184,0.15)'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(tx(xs[0]), ty(ys[0]), 7, 0, Math.PI * 2)
        ctx.fillStyle = C.textBright
        ctx.fill()
        ctx.strokeStyle = C.surface
        ctx.lineWidth = 2
        ctx.stroke()
        if (tooltipNx !== null) {
          const idx = Math.round(tooltipNx * (n - 1))
          driverData.forEach(({ colour }) => {
            ctx.save()
            ctx.shadowColor = colour
            ctx.shadowBlur = 12
            ctx.beginPath()
            ctx.arc(tx(xs[idx]), ty(ys[idx]), 6, 0, Math.PI * 2)
            ctx.fillStyle = colour
            ctx.fill()
            ctx.restore()
          })
        }
      }
    })

    return () => window.cancelAnimationFrame(raf)
  }, [chartWidth, driverData, isQualifying, tab, telemetryReady, tooltipNx])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!telemetryReady || !driverData.length) return
    hoverClearControllerRef.current?.cancel()
    const rect = e.currentTarget.getBoundingClientRect()
    const cW = rect.width - PAD.left - PAD.right
    if (cW <= 0) return
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / cW))
    setTooltipNx(nx)
    const n = driverData[0].interp.dist.length
    const idx = Math.round(nx * (n - 1))
    const firstSpeed = driverData[0]?.interp.speed[idx]
    const secondSpeed = driverData[1]?.interp.speed[idx]
    const overDelta = e.currentTarget === deltaRef.current
    setTooltipData({
      dist: driverData[0].interp.dist[idx],
      progress: nx,
      verticalProgress: overDelta ? 0.5 : Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      speedDelta: firstSpeed != null && secondSpeed != null ? firstSpeed - secondSpeed : null,
      values: driverData.map(d => ({
        abbr: d.abbr, colour: d.colour,
        speed: d.interp.speed[idx] ?? 0, throttle: d.interp.throttle[idx] ?? 0,
        gear: d.interp.gear[idx] ?? 0, rpm: d.interp.rpm[idx] ?? 0,
        brake: d.interp.brake[idx] ?? false,
      })),
    })
  }, [driverData, telemetryReady])

  const handleMouseLeave = useCallback(() => {
    hoverClearControllerRef.current?.schedule()
  }, [])

  const toggleDriver = (dn: number) => {
    if (showTelemetry && qualiSegments?.segments && !segmentDriverNumbers.has(dn)) return
    setSelected(prev => prev.includes(dn) ? prev.filter(d => d !== dn) : prev.length < 4 ? [...prev, dn] : prev)
  }

  const driverList = drivers.map(d => ({ driver_number: d.driver_number, abbreviation: d.abbreviation, team_name: d.team_name ?? '', team_colour: d.team_colour ?? '666666' }))
  const fmtMs = (ms: number | null) => { if (ms === null) return '—'; const s = ms / 1000; const m = Math.floor(s / 60); const secs = (s % 60).toFixed(3).padStart(6, '0'); return m > 0 ? `${m}:${secs}` : secs }
  const tooltipCardWidth = Math.min(driverData.length > 2 ? 400 : 380, Math.max(260, chartWidth - 24))
  const tooltipCardHeight = driverData.length > 2 ? 350 : 220
  const qualifyingAdvancePosition = getQualifyingAdvancePosition(session?.year ?? null, activeSegment)

  // ── Render ────────────────────────────────────────────────────────────────
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'pace', label: 'Pace' },
    { key: 'driving', label: 'Driving' },
    { key: 'inputs', label: 'Inputs' },
    { key: 'data', label: 'Data' },
  ]
  const sessionLabel = isRaceSession(sessionType)
    ? 'Race'
    : isPracticeSession(sessionType)
      ? sessionName || 'Practice'
      : `${sessionName || 'Qualifying'} · ${selectedSegment}`
  const comparisonReady = driverData.length >= 2 && telemetryReady
  const headerTitle = `${session?.year ? `${session.year} ` : ''}${session?.gp_name ?? (sessionName || 'Telemetry analysis')}`

  const hoverCard = hoverActive && tooltipData ? (
    <div style={{
      position: 'absolute',
      zIndex: 3,
      top: 10 + Math.max(8, Math.min(420 - tooltipCardHeight - 8, tooltipData.verticalProgress < 0.5 ? tooltipData.verticalProgress * 420 + 12 : tooltipData.verticalProgress * 420 - tooltipCardHeight - 12)),
      left: Math.max(8, Math.min(chartWidth - tooltipCardWidth - 8, PAD.left + tooltipData.progress * (chartWidth - PAD.left - PAD.right) + 14)),
      width: tooltipCardWidth,
      border: `1px solid ${C.borderMid}`,
      borderRadius: 12,
      background: 'rgba(255,255,255,0.98)',
      pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12, lineHeight: '16px' }}>
        <span style={{ color: C.textBright, fontWeight: 600 }}>{Math.round(tooltipData.dist).toLocaleString()} m</span>
        <span style={{ color: C.textMid, whiteSpace: 'nowrap' }}>
          {driverData[0]?.abbr} vs {driverData[1]?.abbr}: {tooltipData.speedDelta == null ? '—' : `${tooltipData.speedDelta >= 0 ? '+' : ''}${tooltipData.speedDelta.toFixed(0)} km/h`}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {tooltipData.values.map((value, index) => (
          <div key={value.abbr} style={{ minWidth: 0, padding: '8px 12px', borderRight: index % 2 === 0 ? `1px solid ${C.border}` : undefined, borderBottom: index < 2 && tooltipData.values.length > 2 ? `1px solid ${C.border}` : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, lineHeight: '16px', fontWeight: 600, color: C.textBright }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: value.colour }} />{value.abbr}
            </div>
            <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Math.round(value.speed)}<span style={{ marginLeft: 4, color: C.textMid, fontSize: 12, fontWeight: 500 }}>km/h</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 8px', marginTop: 8, color: C.textSub, fontSize: 12, lineHeight: '16px', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: C.textDim }}>RPM</span><span>{Math.round(value.rpm).toLocaleString()}</span>
              <span style={{ color: C.textDim }}>Throttle</span><span>{Math.round(value.throttle)}%</span>
              <span style={{ color: C.textDim }}>Brake</span><span>{value.brake > 0 ? 'On' : 'Off'}</span>
              <span style={{ color: C.textDim }}>Gear</span><span>{value.gear}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null

  const waiting = (
    <InlineMessage
      title={loading ? 'Loading telemetry' : telemetryError ? 'Telemetry unavailable' : 'Select two drivers to compare'}
      detail={loading
        ? 'Syncing the selected laps. Charts appear as soon as every driver has data.'
        : telemetryError ?? 'Pick at least two drivers in the bar above to build the comparison.'}
    />
  )

  return (
    <div className={`lp ${geist.className} ${geistMono.variable}`} style={{ paddingBottom: 80 }}>
      <div ref={containerRef} style={{ maxWidth: 1120, margin: '0 auto', padding: isMobile ? '0 16px' : '0 24px' }}>

        {/* Header */}
        <header style={{ padding: '32px 0 24px' }}>
          <Link href="/telemetry" className="back body-5">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" /> All sessions
          </Link>
          <h1 className="heading-4" style={{ marginTop: 16 }}>{headerTitle}</h1>
          <p className="body-3 muted" style={{ marginTop: 4 }}>{sessionLabel}</p>
        </header>

        {/* Practice mode */}
        {isPracticeSession(sessionType) && <PracticeAnalysis sessionKey={sessionKey} session={session} drivers={driverList} />}

        {/* Qualifying and race */}
        {showTelemetry && (
          <div ref={chartMeasureRef}>
            {/* Sticky controls: segment and drivers */}
            <div className="tel-bar">
              {!isRaceSession(sessionType) && (
                <ToggleGroup
                  label="Qualifying segment"
                  value={selectedSegment}
                  onChange={setSelectedSegment}
                  items={(['Q1', 'Q2', 'Q3'] as const).map(seg => ({ key: seg, label: seg, disabled: (qualiSegments?.segments?.[seg]?.length ?? 0) === 0 }))}
                />
              )}
              <div className="tel-drivers" role="group" aria-label="Drivers to compare">
                {drivers.map(driver => {
                  const isSelected = selected.includes(driver.driver_number)
                  const unavailable = Boolean(qualiSegments?.segments && !segmentDriverNumbers.has(driver.driver_number))
                  const atLimit = selected.length >= 4 && !isSelected
                  const colour = teamColour(driver.team_colour, driver.team_name)
                  const lap = segmentLapByDriver.get(driver.driver_number)
                  return (
                    <button
                      key={driver.driver_number}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={unavailable || atLimit}
                      onClick={() => toggleDriver(driver.driver_number)}
                      title={unavailable ? `${driver.abbreviation} did not set a lap in ${selectedSegment}` : atLimit ? 'Select up to four drivers' : `${isSelected ? 'Remove' : 'Add'} ${driver.abbreviation}${lap ? `, lap ${lap}` : ''}`}
                      className={`chip ${isSelected ? 'on' : ''}`}
                      style={isSelected ? { borderColor: colour } : undefined}
                    >
                      <span className="dot" style={{ background: unavailable ? C.borderMid : colour }} />
                      {driver.abbreviation}
                    </button>
                  )
                })}
                <span className="caption-4 muted" style={{ marginLeft: 'auto' }}>{selected.length} of 4 selected</span>
              </div>
            </div>

            {comparisonReady ? (
              <TelemetryDecisionHero
                sessionName={sessionName}
                selectedSegment={selectedSegment}
                driverData={driverData}
                drivers={drivers}
                sectorTimes={sectorTimes}
                telLapNumbers={telLapNumbers}
                isMobile={isMobile}
                sessionType={sessionType}
              />
            ) : (
              <div style={{ marginBottom: 24 }}>{waiting}</div>
            )}

            {/* Tabs */}
            <TabList
              id="analysis"
              label="Analysis view"
              value={tab}
              onChange={setTab}
              items={tabs.map(t => ({ key: t.key, label: t.label }))}
              style={{ marginBottom: 24 }}
            />

            <div role="tabpanel" id="analysis-panel" aria-labelledby={`analysis-tab-${tab}`}>
            {/* Pace */}
            {tab === 'pace' && (
              comparisonReady ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Apex minimum speed', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.minSpeed != null ? `${row.minSpeed} km/h` : '—' })) },
                      { label: 'Top speed', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.maxSpeed != null ? `${row.maxSpeed} km/h` : '—' })) },
                      { label: 'Full throttle', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.fullThrottle != null ? `${row.fullThrottle.toFixed(1)}%` : '—' })) },
                      { label: 'Sector sum', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.lapMs != null ? `${(row.lapMs / 1000).toFixed(3)}s` : '—' })) },
                    ].map(metric => (
                      <div key={metric.label} style={{ padding: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16 }}>
                        <div style={{ fontSize: 12, lineHeight: '16px', color: C.textMid, fontWeight: 500 }}>{metric.label}</div>
                        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                          {metric.values.map(value => (
                            <div key={value.abbr} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14, lineHeight: '20px', fontVariantNumeric: 'tabular-nums' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: C.textMid }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: value.colour }} />{value.abbr}</span>
                              <span style={{ color: C.textBright, fontWeight: 600, whiteSpace: 'nowrap' }}>{value.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div style={{ padding: 16, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 16 }}>
                      <div style={{ fontSize: 12, lineHeight: '16px', color: C.textMid, fontWeight: 500 }}>Theoretical best</div>
                      <div style={{ marginTop: 12, fontSize: 20, lineHeight: '28px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{theoreticalBest != null ? formatLapTime(theoreticalBest) : '—'}</div>
                      <div style={{ marginTop: 4, fontSize: 12, lineHeight: '16px', color: C.textMid }}>Best sectors of the selected drivers</div>
                    </div>
                  </div>

                  <Panel>
                    <PanelHeader
                      title="Speed against distance"
                      subtitle={`${Math.round(driverData[0]?.interp.dist.at(-1) ?? 0).toLocaleString()} m lap. Hover to inspect a point.`}
                      right={
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          {driverData.map((driver, index) => (
                            <span key={driver.abbr} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: '16px', color: C.textMid }}>
                              <span style={{ width: 16, height: 0, borderTop: `${index ? 2 : 3}px ${index ? 'dashed' : 'solid'} ${driver.colour}` }} />{driver.abbr}
                            </span>
                          ))}
                        </div>
                      }
                    />
                    <div style={{ position: 'relative', paddingTop: 8 }}>
                      <SvgSpeedTrace driverData={driverData} tooltipNx={tooltipNx} onMouseMove={handleMouseMove as unknown as React.MouseEventHandler<SVGSVGElement>} onMouseLeave={handleMouseLeave} />
                      <canvas ref={deltaRef} height={isMobile ? 110 : 135} style={{ display: 'block', width: '100%', cursor: 'crosshair', borderTop: `1px solid ${C.border}` }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                      {hoverCard}
                    </div>
                  </Panel>

                  <LapStory drivers={lapStoryDrivers} isMobile={isMobile} />
                  <GapToLeaderChart driverData={driverData} width={chartWidth} active />

                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.35fr) minmax(320px, 0.95fr)', gap: 16, alignItems: 'start' }}>
                    {sectorTimes.size > 0 ? <SectorHeroCards driverData={driverData} sectorTimes={sectorTimes} drivers={drivers} /> : <InlineMessage title="Sector times not available" detail="Sector cards appear once lap matched sector times exist for the selected laps." />}
                    <PerformanceMatrix driverData={driverData} sectorTimes={sectorTimes} drivers={drivers} telStats={telStats} />
                  </div>
                </div>
              ) : waiting
            )}

            {/* Driving */}
            {tab === 'driving' && (
              driverData.length >= 2 ? (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.3fr) minmax(320px, 0.9fr)', gap: 16, alignItems: 'start' }}>
                  <div>
                    {cornerInsights ? (
                      <CornerInsights data={cornerInsights} driverColours={insightDriverColours} />
                    ) : (
                      <InlineMessage title="Corner insights loading" detail="The corner by corner story appears when the braking comparison finishes processing." />
                    )}
                  </div>
                  <BrakingAnalysis
                    sessionKey={sessionKey}
                    drivers={selected}
                    trackPath={driverData.length > 0 ? { x: driverData[0].interp.x, y: driverData[0].interp.y } : undefined}
                    onInsightsLoad={(insights, colours) => {
                      setCornerInsights(insights)
                      setInsightDriverColours(colours)
                    }}
                  />
                </div>
              ) : (
                <InlineMessage title="Driving analysis needs two drivers" detail="Pick two comparable drivers in the bar above to unlock braking zones and corner insights." />
              )
            )}

            {/* Inputs */}
            {tab === 'inputs' && (
              comparisonReady ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Panel>
                    <PanelHeader title="Braking" subtitle="Brake on or off across the lap" />
                    <canvas ref={el => { chartRefs.current[3] = el }} height={CHARTS[3].height} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                  </Panel>
                  <Panel>
                    <PanelHeader title="Throttle" subtitle="0 to 100 percent" />
                    <canvas ref={el => { chartRefs.current[1] = el }} height={isMobile ? 160 : Math.min(CHARTS[1].height, 220)} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                  </Panel>
                  <Panel>
                    <PanelHeader title="Engine speed" subtitle="6,000 to 13,000 rpm" />
                    <canvas ref={el => { chartRefs.current[2] = el }} height={CHARTS[2].height} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                  </Panel>
                  <Panel>
                    <PanelHeader title="Circuit path" subtitle="Sector placement across the lap" right={
                      <div style={{ display: 'flex', gap: 12 }}>
                        {[{ c: C.red, l: 'S1' }, { c: C.gold, l: 'S2' }, { c: C.purple, l: 'S3' }].map(({ c, l }) => (
                          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, lineHeight: '16px', color: C.textMid }}>
                            <span style={{ width: 12, height: 4, borderRadius: 2, background: c }} />{l}
                          </span>
                        ))}
                      </div>
                    } />
                    <canvas ref={trackRef} height={300} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                  </Panel>
                </div>
              ) : waiting
            )}

            {/* Data */}
            {tab === 'data' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {qualiSegments?.segments && !isRaceSession(sessionType) && (
                  <Panel>
                    <PanelHeader
                      title="Qualifying segments"
                      subtitle="Order and elimination line"
                      right={
                        <ToggleGroup
                          label="Table segment"
                          value={activeSegment}
                          onChange={setActiveSegment}
                          items={(['Q1', 'Q2', 'Q3'] as const).map(seg => ({ key: seg, label: seg }))}
                        />
                      }
                    />
                    <div style={{ padding: '12px 16px', overflowX: 'auto' }}>
                      {(() => {
                        const entries = qualiSegments?.segments?.[activeSegment] ?? []
                        const cutoff = qualifyingAdvancePosition
                        return (
                          <div style={{ minWidth: 600 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '40px 56px 1fr 96px 72px 72px 72px', gap: 4, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
                              {['Pos', 'Driver', 'Team', 'Time', 'S1', 'S2', 'S3'].map(h => (
                                <span key={h} style={{ fontSize: 12, lineHeight: '16px', color: C.textMid, fontWeight: 500, textAlign: ['Time', 'S1', 'S2', 'S3'].includes(h) ? 'right' : 'left' }}>{h}</span>
                              ))}
                            </div>
                            {entries.map((entry, idx) => {
                              const showCut = cutoff !== null && entry.position === cutoff
                              return (
                                <div key={entry.driver_number}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '40px 56px 1fr 96px 72px 72px 72px', gap: 4, alignItems: 'center', padding: '8px 0', opacity: entry.eliminated ? 0.5 : 1, fontSize: 14, lineHeight: '20px', fontVariantNumeric: 'tabular-nums' }}>
                                    <span style={{ color: C.textMid, fontWeight: idx === 0 ? 600 : 400 }}>{entry.position}</span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: idx === 0 ? 600 : 500 }}>
                                      <span style={{ width: 4, height: 16, borderRadius: 2, background: `#${entry.team_colour}` }} />{entry.abbreviation}
                                    </span>
                                    <span style={{ color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.team_name}</span>
                                    <span style={{ textAlign: 'right', fontWeight: idx === 0 ? 600 : 500 }}>
                                      {fmtMs(entry.lap_time_ms)}
                                      {entry.gap_ms > 0 && <span style={{ display: 'block', fontSize: 12, lineHeight: '16px', color: C.textDim, fontWeight: 400 }}>+{(entry.gap_ms / 1000).toFixed(3)}</span>}
                                    </span>
                                    {(['s1_ms', 's2_ms', 's3_ms'] as const).map(sk => (
                                      <span key={sk} style={{ color: C.textMid, textAlign: 'right' }}>{entry[sk] ? (entry[sk]! / 1000).toFixed(3) : '—'}</span>
                                    ))}
                                  </div>
                                  {showCut && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: '16px', color: C.red, margin: '4px 0' }}>
                                      <span style={{ flex: 1, height: 1, background: C.red, opacity: 0.3 }} />Elimination line
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>
                  </Panel>
                )}
                {!isRaceSession(sessionType) && <QualiSpeedPanel sessionKey={sessionKey} />}
                <LapTimeDistribution sessionKey={sessionKey} />
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
