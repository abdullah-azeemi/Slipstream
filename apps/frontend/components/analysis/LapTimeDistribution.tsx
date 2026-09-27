'use client'

import React, { useEffect, useState, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { COMPOUND_COLOURS } from '@/lib/utils'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const C = {
  surface: '#FFFFFF',
  surfaceAlt: '#F5F7FB',
  border: '#D9E3EF',
  textDim: '#7D8BA2',
  textMid: '#56657C',
  textBright: '#13233D',
} as const

type LapEntry = {
  lap_number: number
  lap_time_ms: number
  compound: string
  position: number
  stint: number
  is_personal_best: boolean
  deleted: boolean
  s1_ms: number | null
  s2_ms: number | null
  s3_ms: number | null
}

type DriverLaps = {
  driver_number: number
  abbreviation: string
  team_colour: string
  team_name: string
  laps: LapEntry[]
}

type LapEvolutionResponse = {
  drivers: Record<string, DriverLaps>
}

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export default function LapTimeDistribution({ sessionKey }: { sessionKey: number }) {
  const [data, setData] = useState<LapEvolutionResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  const seededRef = React.useRef(false)

  useEffect(() => {
    seededRef.current = false
    const abort = new AbortController()
    let active = true
    setLoading(true)
    setError(null)
    fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/lap-evolution`, { signal: abort.signal })
      .then(r => { if (!r.ok) throw new Error('Failed to load')
        return r.json() as Promise<LapEvolutionResponse>
      })
      .then(d => {
        if (!active) return
        setData(d)
        if (!seededRef.current) {
          seededRef.current = true
          const keys = Object.keys(d.drivers)
          if (keys.length > 0) setSelected(keys.slice(0, Math.min(4, keys.length)))
        }
      })
      .catch(err => { if (active && err?.name !== 'AbortError') setError(err instanceof Error ? err.message : 'Error') })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false; abort.abort() }
  }, [sessionKey])

  const allDrivers = useMemo(() => {
    if (!data) return []
    return Object.entries(data.drivers).map(([dn, d]) => ({
      key: dn,
      number: d.driver_number,
      abbr: d.abbreviation,
      colour: d.team_colour,
    }))
  }, [data])

  const chartOption = useMemo(() => {
    if (!data || selected.length === 0) return null

    const drivers = selected.map((dn, i) => ({
      dn,
      abbr: data.drivers[dn]?.abbreviation ?? dn,
      colour: data.drivers[dn]?.team_colour?.startsWith('#')
        ? data.drivers[dn].team_colour
        : `#${data.drivers[dn]?.team_colour ?? '666'}`,
      x: i,
    }))

    // One box per driver — value is [x, min, Q1, median, Q3, max]
    const boxData = drivers.map(({ dn, x, colour }) => {
      const d = data.drivers[dn]
      if (!d) return null
      const times = d.laps
        .filter(l => !l.deleted && l.lap_time_ms != null)
        .map(l => l.lap_time_ms / 1000)
      if (times.length < 2) return null
      const s = [...times].sort((a, b) => a - b)
      return {
        value: [x, s[0], s[Math.floor(s.length * 0.25)], median(s), s[Math.floor(s.length * 0.75)], s[s.length - 1]],
        itemStyle: { color: `${colour}33`, borderColor: colour, borderWidth: 1.5 },
      }
    }).filter(Boolean)

    // Scatter — each point at [x + small jitter, time], coloured by compound
    const scatterData = drivers.flatMap(({ dn, x }) => {
      const d = data.drivers[dn]
      if (!d) return []
      return d.laps
        .filter(l => !l.deleted && l.lap_time_ms != null)
        .map(l => {
          const cmpd = (l.compound ?? '').toUpperCase()
          const cColour = COMPOUND_COLOURS[cmpd] ?? '#9CA3AF'
          return {
            value: [x + (Math.random() - 0.5) * 0.28, l.lap_time_ms / 1000],
            itemStyle: {
              color: cColour,
              opacity: 0.85,
              borderColor: cmpd === 'HARD' ? '#9CA3AF' : 'rgba(255,255,255,0.6)',
              borderWidth: cmpd === 'HARD' ? 1 : 0.5,
            },
            name: `Lap ${l.lap_number}`,
            stint: l.stint,
            compound: l.compound,
          }
        })
    })

    const xMin = -0.5
    const xMax = drivers.length - 0.5

    return {
      grid: { left: 64, right: 18, top: 20, bottom: 40 },
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string, data: { value: number[], compound: string, stint: number }, seriesType: string, value: number[] }) => {
          if (p.seriesType === 'scatter') {
            const time = p.value[1]
            const mins = Math.floor(time / 60)
            const secs = (time % 60).toFixed(3).padStart(6, '0')
            return `${p.name}<br/>Time: ${mins}:${secs}<br/>Compound: ${p.data.compound}<br/>Stint: ${p.data.stint}`
          }
          if (p.seriesType === 'boxplot') {
            const v = p.data.value as number[]
            const fmt = (n: number) => { const m = Math.floor(n / 60); return `${m}:${(n % 60).toFixed(3).padStart(6, '0')}` }
            return `Min: ${fmt(v[1])}<br/>Q1: ${fmt(v[2])}<br/>Median: ${fmt(v[3])}<br/>Q3: ${fmt(v[4])}<br/>Max: ${fmt(v[5])}`
          }
          return null
        },
      },
      xAxis: {
        type: 'value',
        min: xMin,
        max: xMax,
        interval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: C.textBright,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12,
          fontWeight: 700,
          formatter: (v: number) => {
            const d = drivers.find(dr => dr.x === Math.round(v))
            return d ? d.abbr : ''
          },
        },
      },
      yAxis: {
        type: 'value',
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#EEF1F6', type: 'dashed' } },
        axisLabel: {
          color: C.textDim,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          formatter: (v: number) => {
            const mins = Math.floor(v / 60)
            const secs = (v % 60).toFixed(3).padStart(6, '0')
            return `${mins}:${secs}`
          },
        },
        scale: true,
      },
      series: [
        {
          type: 'boxplot',
          name: 'Distribution',
          data: boxData,
          // Tell ECharts that value[0] is the x position
          encode: { x: 0, y: [1, 2, 3, 4, 5] },
          boxWidth: ['18%', '28%'],
          z: 5,
        },
        {
          type: 'scatter',
          name: 'Laps',
          data: scatterData,
          symbolSize: 6,
          itemStyle: { borderColor: 'rgba(255,255,255,0.8)', borderWidth: 0.5 },
          encode: { x: 0, y: 1 },
          z: 10,
        },
      ],
    }
  }, [data, selected])


  const stats = useMemo(() => {
    if (!data) return []
    return selected.flatMap(dn => {
      const d = data.drivers[dn]
      if (!d) return []
      const laps = d.laps.filter(l => !l.deleted && l.lap_time_ms != null)
      const times = laps.map(l => l.lap_time_ms)
      if (times.length === 0) return []
      const sorted = [...times].sort((a, b) => a - b)
      return [{
        dn,
        abbr: d.abbreviation,
        colour: d.team_colour,
        count: times.length,
        best: sorted[0],
        median: median(times),
        avg: times.reduce((a, b) => a + b, 0) / times.length,
        worst: sorted[sorted.length - 1],
        iqr: sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)],
      }]
    })
  }, [data, selected])

  if (loading) {
    return (
      <div style={{ padding: 20, border: `1px solid ${C.border}`, borderRadius: 18, background: C.surface }}>
        <div style={{ fontSize: 11, color: C.textDim, fontFamily: 'Inter, sans-serif' }}>Loading lap data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 20, border: '1px solid #FECACA', borderRadius: 18, background: '#FEF2F2', color: '#B91C1C', fontFamily: 'Inter, sans-serif', fontSize: 11 }}>
        {error}
      </div>
    )
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 8px 24px rgba(19,35,61,0.04)' }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontFamily: 'Inter, sans-serif', fontWeight: 800, color: C.textBright }}>
            Lap Time Distribution
          </div>
          <div style={{ fontSize: 11, fontFamily: 'Inter, sans-serif', color: C.textMid, marginTop: 2, lineHeight: 1.5, maxWidth: 420 }}>
            All race laps grouped by driver. Hover for details.
          </div>
        </div>
      </div>

      <div style={{ padding: 18 }}>
        {allDrivers.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={{ fontSize: 9, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, letterSpacing: '0.08em', color: C.textDim, textTransform: 'uppercase', alignSelf: 'center', marginRight: 4 }}>
              Drivers
            </span>
            {allDrivers.map(d => {
              const active = selected.includes(d.key)
              const colour = d.colour?.startsWith('#') ? d.colour : `#${d.colour ?? '666'}`
              return (
                <button
                  key={d.key}
                  onClick={() => {
                    setSelected(prev =>
                      active ? prev.filter(x => x !== d.key) : prev.length < 4 ? [...prev, d.key] : prev
                    )
                  }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 8,
                    border: `1px solid ${active ? colour : C.border}`,
                    background: active ? colour + '15' : C.surfaceAlt,
                    color: active ? colour : C.textMid,
                    fontSize: 10,
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {d.abbr}
                </button>
              )
            })}
          </div>
        )}

        {chartOption ? (
          <ReactECharts
            option={chartOption}
            style={{ height: 400, width: '100%' }}
            opts={{ renderer: 'svg' }}
          />
        ) : (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 11, color: C.textDim, fontFamily: 'Inter, sans-serif' }}>
            {allDrivers.length === 0 ? 'No lap data available' : 'Select up to 4 drivers above'}
          </div>
        )}

        {stats.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {stats.map(s => {
              const colour = s.colour?.startsWith('#') ? s.colour : `#${s.colour ?? '666'}`
              return (
                <div key={s.dn} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 12px', background: C.surfaceAlt, minWidth: 140 }}>
                  <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: colour, marginBottom: 4 }}>
                    {s.abbr}
                    <span style={{ fontWeight: 400, color: C.textDim, fontSize: 9, marginLeft: 4 }}>
                      ({s.count} laps)
                    </span>
                  </div>
                  <StatRow label="Best" value={`${(s.best / 1000).toFixed(3)}s`} />
                  <StatRow label="Median" value={`${(s.median / 1000).toFixed(3)}s`} />
                  <StatRow label="Avg" value={`${(s.avg / 1000).toFixed(3)}s`} />
                  <StatRow label="IQR" value={`${(s.iqr / 1000).toFixed(3)}s`} />
                </div>
              )
            })}
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 9, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, letterSpacing: '0.08em', color: C.textDim, textTransform: 'uppercase' }}>
            Compound
          </span>
          {Object.entries(COMPOUND_COLOURS).filter(([k]) => ['SOFT', 'MEDIUM', 'HARD', 'INTER', 'WET'].includes(k)).map(([compound, colour]) => (
            <div key={compound} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: colour, border: compound === 'HARD' ? '1px solid #CCC' : 'none' }} />
              <span style={{ fontSize: 10, fontFamily: 'Inter, sans-serif', color: C.textMid }}>
                {compound.charAt(0) + compound.slice(1).toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: C.textMid, lineHeight: 1.6 }}>
      <span style={{ color: C.textDim }}>{label}</span>
      <span style={{ fontWeight: 600, color: C.textBright }}>{value}</span>
    </div>
  )
}
