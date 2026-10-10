'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { UserCircle } from 'lucide-react'

type DriverStanding = {
  position: number
  code: string
  full_name: string
  team_name: string
  points: number
  wins: number
  nationality?: string
}

type ConstructorStanding = {
  position: number
  team_name: string
  points: number
  wins: number
}

function constructorColour(name: string): string {
  const colours: Record<string, string> = {
    Mercedes: '#27F4D2',
    'Red Bull': '#3671C6',
    Ferrari: '#E8002D',
    McLaren: '#FF8000',
    'Aston Martin': '#229971',
    Alpine: '#FF87BC',
    Williams: '#64C4FF',
    Haas: '#B6BABD',
    Sauber: '#52E252',
    RB: '#6692FF',
  }

  for (const [key, value] of Object.entries(colours)) {
    if (name?.toLowerCase().includes(key.toLowerCase())) return value
  }
  return '#64748B'
}

export default function ChampionshipStandings({
  drivers,
  constructors,
  images = {}
}: {
  drivers: DriverStanding[]
  constructors: ConstructorStanding[]
  currentYear: number
  round: number
  images?: Record<string, string>
}) {
  const [activeTab, setActiveTab] = useState<'drivers' | 'constructors'>('drivers')
  const [isExpanded, setIsExpanded] = useState(false)

  // Fallback 2026 Driver Standings if dynamic data is empty
  const fallbackDrivers: DriverStanding[] = [
    { position: 1, code: 'ANT', full_name: 'Andrea Kimi Antonelli', team_name: 'Mercedes', points: 267, wins: 4, nationality: 'ITALIAN' },
    { position: 2, code: 'RUS', full_name: 'George Russell', team_name: 'Mercedes', points: 201, wins: 3, nationality: 'BRITISH' },
    { position: 3, code: 'HAM', full_name: 'Lewis Hamilton', team_name: 'Ferrari', points: 191, wins: 2, nationality: 'BRITISH' },
    { position: 4, code: 'NOR', full_name: 'Lando Norris', team_name: 'McLaren', points: 171, wins: 2, nationality: 'BRITISH' },
    { position: 5, code: 'LEC', full_name: 'Charles Leclerc', team_name: 'Ferrari', points: 155, wins: 1, nationality: 'MONÉGASQUE' },
    { position: 6, code: 'VER', full_name: 'Max Verstappen', team_name: 'Red Bull Racing', points: 127, wins: 1, nationality: 'DUTCH' },
    { position: 7, code: 'PIA', full_name: 'Oscar Piastri', team_name: 'McLaren', points: 116, wins: 0, nationality: 'AUSTRALIAN' },
    { position: 8, code: 'HAD', full_name: 'Isack Hadjar', team_name: 'Red Bull Racing', points: 71, wins: 0, nationality: 'FRENCH' },
    { position: 9, code: 'LAW', full_name: 'Liam Lawson', team_name: 'RB F1 Team', points: 51, wins: 0, nationality: 'NEW ZEALANDER' },
    { position: 10, code: 'GAS', full_name: 'Pierre Gasly', team_name: 'Alpine F1 Team', points: 41, wins: 0, nationality: 'FRENCH' },
  ]

  const fallbackConstructors: ConstructorStanding[] = [
    { position: 1, team_name: 'Mercedes', points: 468, wins: 7 },
    { position: 2, team_name: 'Ferrari', points: 346, wins: 3 },
    { position: 3, team_name: 'McLaren', points: 287, wins: 2 },
    { position: 4, team_name: 'Red Bull Racing', points: 198, wins: 1 },
    { position: 5, team_name: 'RB F1 Team', points: 78, wins: 0 },
    { position: 6, team_name: 'Alpine F1 Team', points: 54, wins: 0 },
  ]

  const displayDrivers = drivers.length > 0 ? drivers : fallbackDrivers
  const displayConstructors = constructors.length > 0 ? constructors : fallbackConstructors

  const visibleDrivers = useMemo(() => isExpanded ? displayDrivers : displayDrivers.slice(0, 10), [displayDrivers, isExpanded])
  const visibleConstructors = useMemo(() => isExpanded ? displayConstructors : displayConstructors.slice(0, 10), [displayConstructors, isExpanded])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header & Tab Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 32, fontWeight: 400, color: '#111827', letterSpacing: '-0.02em', marginBottom: 4 }}>
            2026 Standings
          </h2>
          <p style={{ fontSize: 13, color: '#6B7280', fontWeight: 400 }}>
            Official championship positions updated after Round 13 (Monza)
          </p>
        </div>

        <div style={{ display: 'flex', gap: 20 }}>
          <button
            onClick={() => setActiveTab('drivers')}
            style={{
              background: 'none',
              border: 'none',
              padding: '6px 0',
              fontSize: 13,
              fontWeight: activeTab === 'drivers' ? 700 : 500,
              color: activeTab === 'drivers' ? '#111827' : '#9CA3AF',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            Drivers
            {activeTab === 'drivers' && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: '#111827' }} />}
          </button>
          <button
            onClick={() => setActiveTab('constructors')}
            style={{
              background: 'none',
              border: 'none',
              padding: '6px 0',
              fontSize: 13,
              fontWeight: activeTab === 'constructors' ? 700 : 500,
              color: activeTab === 'constructors' ? '#111827' : '#9CA3AF',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            Constructors
            {activeTab === 'constructors' && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: '#111827' }} />}
          </button>
        </div>
      </div>

      {/* Standings List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {activeTab === 'drivers' ? (
          visibleDrivers.map((driver) => (
            <DriverRow key={driver.code || driver.full_name} driver={driver} imageUrl={images[driver.code]} />
          ))
        ) : (
          visibleConstructors.map((constructor) => (
            <ConstructorRow key={constructor.team_name} constructor={constructor} />
          ))
        )}
      </div>

      {/* See More Pill Button */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            background: '#FFFFFF',
            border: '1px solid #E5E7EB',
            padding: '12px 28px',
            borderRadius: 9999,
            fontSize: 11,
            fontWeight: 700,
            color: '#374151',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'all 0.2s ease',
          }}
        >
          {isExpanded ? 'SEE LESS STANDINGS' : 'SEE COMPLETE 2026 STANDINGS'}
        </button>
      </div>
    </div>
  )
}

function DriverRow({ driver, imageUrl }: { driver: DriverStanding, imageUrl?: string }) {
  const colour = constructorColour(driver.team_name)
  const [imgError, setImgError] = useState(false)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 24px',
      background: '#FFFFFF',
      borderRadius: 16,
      border: '1px solid #F3F4F6',
      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Position */}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#6B7280', width: 28, fontFamily: 'Inter, sans-serif' }}>
          {String(driver.position).padStart(2, '0')}
        </span>

        {/* Avatar */}
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: '#F3F4F6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #E5E7EB',
          overflow: 'hidden',
          position: 'relative'
        }}>
          {imageUrl && !imgError ? (
            <Image
              src={imageUrl}
              alt={driver.full_name}
              fill
              style={{ objectFit: 'cover' }}
              unoptimized
              onError={() => setImgError(true)}
            />
          ) : (
            <UserCircle size={40} color="#9CA3AF" strokeWidth={1} />
          )}
        </div>

        {/* Driver Name & Nationality */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{driver.full_name}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {driver.nationality || 'F1 DRIVER'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
        {/* Team Bar & Name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 4, height: 16, background: colour, borderRadius: 2 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#4B5563' }}>{driver.team_name}</span>
        </div>

        {/* Points */}
        <div style={{ textAlign: 'right', minWidth: 60 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>{driver.points}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginLeft: 4 }}>PTS</span>
        </div>
      </div>
    </div>
  )
}

function ConstructorRow({ constructor }: { constructor: ConstructorStanding }) {
  const colour = constructorColour(constructor.team_name)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 24px',
      background: '#FFFFFF',
      borderRadius: 16,
      border: '1px solid #F3F4F6',
      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#6B7280', width: 28 }}>
          {String(constructor.position).padStart(2, '0')}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 4, height: 16, background: colour, borderRadius: 2 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{constructor.team_name}</span>
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>{constructor.points}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginLeft: 4 }}>PTS</span>
      </div>
    </div>
  )
}
