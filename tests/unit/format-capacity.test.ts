import { describe, expect, it } from 'vitest'
import { formatBytes, formatCpuCores } from '../../app/lib/format'

describe('Coolify capacity formatting', () => {
  it('shows zero limits as unlimited', () => {
    expect(formatCpuCores('0')).toBe('Unlimited')
    expect(formatBytes('0')).toBe('Unlimited')
  })
})
