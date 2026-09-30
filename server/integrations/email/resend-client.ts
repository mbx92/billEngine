export interface SendEmailInput {
  from: string
  to: string
  subject: string
  html: string
  idempotencyKey: string
  attachment?: { filename: string; content: string }
}

export class ResendEmailClient {
  constructor(private readonly apiKey: string) {}

  async send(input: SendEmailInput): Promise<{ id: string }> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        attachments: input.attachment ? [input.attachment] : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      throw new Error(`Email provider rejected the request (${response.status}).`)
    }

    const body = (await response.json()) as { id?: unknown }
    if (typeof body.id !== 'string') throw new Error('Email provider returned an invalid response.')
    return { id: body.id }
  }
}
