import { describe, expect, it } from 'vitest'
import { driversPageEnabled } from './features'

describe('driversPageEnabled', () => {
  it('is on in development and tests', () => {
    expect(driversPageEnabled({ NODE_ENV: 'development' })).toBe(true)
    expect(driversPageEnabled({ NODE_ENV: 'test' })).toBe(true)
  })
  it('is off in production by default', () => {
    expect(driversPageEnabled({ NODE_ENV: 'production' })).toBe(false)
  })
  it('can be switched on in production', () => {
    expect(driversPageEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_SHOW_DRIVERS: 'true' })).toBe(true)
    expect(driversPageEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_SHOW_DRIVERS: 'false' })).toBe(false)
  })
})
