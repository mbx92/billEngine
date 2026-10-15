import { describe, expect, it } from 'vitest'
import {
  assertOperationTransition,
  canTransitionOperation,
  isTerminalOperationStatus,
  retryDelayMilliseconds,
} from '../../server/services/infrastructure/operation-state'

describe('infrastructure operation state', () => {
  it('allows the normal dispatch lifecycle', () => {
    expect(canTransitionOperation('queued', 'dispatched')).toBe(true)
    expect(canTransitionOperation('dispatched', 'running')).toBe(true)
    expect(canTransitionOperation('running', 'succeeded')).toBe(true)
  })

  it('rejects mutation of terminal operations', () => {
    expect(isTerminalOperationStatus('succeeded')).toBe(true)
    expect(() => assertOperationTransition('succeeded', 'running')).toThrow(
      'Invalid infrastructure operation transition',
    )
  })

  it('calculates bounded exponential backoff with jitter', () => {
    expect(retryDelayMilliseconds(1, () => 0)).toBe(1_000)
    expect(retryDelayMilliseconds(3, () => 0.5)).toBe(4_400)
    expect(retryDelayMilliseconds(100, () => 1)).toBe(360_000)
  })
})
