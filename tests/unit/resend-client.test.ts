import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResendEmailClient } from '../../server/integrations/email/resend-client'

describe('Resend email client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends an idempotent email request with an attachment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new ResendEmailClient('test-key').send({
        from: 'Billing <billing@example.test>',
        to: 'customer@example.test',
        subject: 'Invoice INV-1',
        html: '<p>Invoice</p>',
        idempotencyKey: 'invoice:1',
        attachment: { filename: 'invoice.pdf', content: 'cGRm' },
      }),
    ).resolves.toEqual({ id: 'email-123' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer test-key',
          'idempotency-key': 'invoice:1',
        }),
      }),
    )
  })

  it('rejects provider errors without exposing the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret error', { status: 422 })))
    await expect(
      new ResendEmailClient('test-key').send({
        from: 'billing@example.test',
        to: 'customer@example.test',
        subject: 'Invoice',
        html: '<p>Invoice</p>',
        idempotencyKey: 'invoice:2',
      }),
    ).rejects.toThrow('Email provider rejected the request (422).')
  })
})
