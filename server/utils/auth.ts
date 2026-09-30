import type { H3Event } from 'h3'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { useDatabase } from '../database/client'
import { accounts, sessions, users, verifications } from '../database/schema'
import { DomainError } from './errors'

let authInstance: ReturnType<typeof createAuth> | undefined

function createAuth() {
  const config = useRuntimeConfig()

  if (!config.betterAuthSecret) {
    throw new Error('BETTER_AUTH_SECRET is not configured.')
  }

  return betterAuth({
    appName: 'Coolify Billing Platform',
    baseURL: config.betterAuthUrl,
    // `nuxt dev --host` can be opened through any local interface, while the
    // configured base URL usually remains localhost. Trust the actual dev
    // server origin so Better Auth's CSRF check also works through a LAN IP.
    // Deriving this from the request URL (not its Origin header) keeps
    // cross-origin requests rejected. Production still only trusts configured
    // origins/baseURL.
    trustedOrigins:
      process.env.NODE_ENV === 'production'
        ? undefined
        : (request) => {
            if (!request) return []

            try {
              const origin = new URL(request.url).origin
              return origin === 'null' ? [] : [origin]
            } catch {
              return []
            }
          },
    secret: config.betterAuthSecret,
    database: drizzleAdapter(useDatabase(), {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
    },
    user: {
      additionalFields: {
        role: {
          type: ['super_admin', 'admin', 'customer'],
          required: true,
          defaultValue: 'customer',
          input: false,
        },
        customerId: {
          type: 'string',
          required: false,
          input: false,
        },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: process.env.NODE_ENV === 'production',
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip'],
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/forget-password': { window: 300, max: 5 },
      },
    },
  })
}

export function useAuth() {
  authInstance ??= createAuth()
  return authInstance
}

export async function requireSession(event: H3Event) {
  const session = await useAuth().api.getSession({ headers: event.headers })

  if (!session) {
    throw DomainError.authentication()
  }

  return session
}

export async function requireAdmin(event: H3Event) {
  const session = await requireSession(event)
  const role = session.user.role

  if (role !== 'super_admin' && role !== 'admin') {
    throw DomainError.forbidden()
  }

  return session
}
