import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'

// Keep the legacy unprefixed variables convenient for local `nuxt dev`, but
// never serialize them into a production build. Deployed Nitro applications
// receive runtime config through matching NUXT_* variables instead.
const developmentEnv = process.env.NODE_ENV === 'development' ? process.env : {}

const themeBootstrap = `
  (() => {
    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem('billing-theme');
    } catch {}

    const isDark = savedTheme
      ? savedTheme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = isDark ? 'dark' : 'light';
  })();
`

export default defineNuxtConfig({
  compatibilityDate: '2026-09-29',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'Billing Infra',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/favicon.svg' },
      ],
      script: [
        {
          key: 'theme-bootstrap',
          innerHTML: themeBootstrap,
          tagPosition: 'head',
          tagPriority: 'critical',
        },
      ],
    },
  },
  components: [
    { path: '~/components/ui', prefix: 'Ui' },
    { path: '~/components/billing', pathPrefix: false },
    { path: '~/components/infrastructure', pathPrefix: false },
    { path: '~/components', pattern: '*.vue', pathPrefix: false },
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
  runtimeConfig: {
    databaseUrl: developmentEnv.DATABASE_URL || '',
    betterAuthSecret: developmentEnv.BETTER_AUTH_SECRET || '',
    betterAuthUrl: developmentEnv.BETTER_AUTH_URL || '',
    coolifyApiUrl: developmentEnv.COOLIFY_API_URL || '',
    coolifyApiToken: developmentEnv.COOLIFY_API_TOKEN || '',
    coolifyCredentialsKey: developmentEnv.COOLIFY_CREDENTIALS_KEY || '',
    infraCredentialsKey: developmentEnv.INFRA_CREDENTIALS_KEY || '',
    cloudflareApiToken: developmentEnv.CLOUDFLARE_API_TOKEN || '',
    cloudflareZoneId: developmentEnv.CLOUDFLARE_ZONE_ID || '',
    cloudflareAccountId: developmentEnv.CLOUDFLARE_ACCOUNT_ID || '',
    cloudflareSaasCnameTarget:
      developmentEnv.CLOUDFLARE_SAAS_CNAME_TARGET || 'cname.ocnetworks.web.id',
    cloudflareFallbackOrigin:
      developmentEnv.CLOUDFLARE_FALLBACK_ORIGIN || 'origin-apps.ocnetworks.web.id',
    platformDomain: developmentEnv.PLATFORM_DOMAIN || 'ocnetworks.web.id',
    resendApiKey: developmentEnv.RESEND_API_KEY || '',
    emailFrom: developmentEnv.EMAIL_FROM || '',
    metricsToken: developmentEnv.METRICS_TOKEN || '',
    companyName: developmentEnv.COMPANY_NAME || 'Billing Infra',
    companyEmail: developmentEnv.COMPANY_EMAIL || '',
    companyAddress: developmentEnv.COMPANY_ADDRESS || '',
    companyTaxId: developmentEnv.COMPANY_TAX_ID || '',
    billingTimezone: developmentEnv.BILLING_TIMEZONE || 'Asia/Makassar',
    billingCurrency: developmentEnv.BILLING_CURRENCY || 'IDR',
    // numeric(7,4) fraction, e.g. 0.11 for 11% VAT. Empty means no tax.
    billingDefaultTaxRate: developmentEnv.BILLING_DEFAULT_TAX_RATE || '',
    billingAutomationEnabled: developmentEnv.BILLING_AUTOMATION_ENABLED === 'true',
    billingAccessControlEnabled: developmentEnv.BILLING_ACCESS_CONTROL_ENABLED === 'true',
    overdueGraceDays: developmentEnv.OVERDUE_GRACE_DAYS || '7',
    graceNoticeIntervalHours: developmentEnv.GRACE_NOTICE_INTERVAL_HOURS || '24',
    billingGateSecret: developmentEnv.BILLING_GATE_SECRET || '',
    billingGateSharedKey: developmentEnv.BILLING_GATE_SHARED_KEY || '',
    billingGateInternalUrl:
      developmentEnv.BILLING_GATE_INTERNAL_URL ||
      'http://host.docker.internal:8010/api/billing-gate/check',
    public: {
      appUrl: developmentEnv.APP_URL || 'http://localhost:3000',
      billingTimezone: developmentEnv.BILLING_TIMEZONE || 'Asia/Makassar',
      companyName: developmentEnv.COMPANY_NAME || 'Billing Infra',
      companyEmail: developmentEnv.COMPANY_EMAIL || '',
    },
  },
  nitro: {
    preset: 'node-server',
    // PDFKit 0.20 lazy-loads standard fonts via `#standard-fonts/*` from its
    // own package. Inlining it into the Nitro bundle breaks that lookup in
    // production (Helvetica is not registered). Keep pdfkit external so the
    // real package, including font modules, is traced into `.output`.
    // Better Auth still needs its @noble tree bundled separately from PDFKit's.
    externals: {
      inline: ['@noble/hashes', '@noble/ciphers'],
      external: ['pdfkit'],
    },
    hooks: {
      compiled(nitro) {
        const source = join(nitro.options.rootDir, 'node_modules/pdfkit')
        const destination = join(
          nitro.options.output.serverDir ?? join(nitro.options.output.dir, 'server'),
          'node_modules/pdfkit',
        )
        if (!existsSync(source)) return
        mkdirSync(dirname(destination), { recursive: true })
        cpSync(source, destination, { recursive: true })
      },
    },
    // Nuxt hardcodes its own error handler, so the JSON API error envelope has
    // to be wired in explicitly.
    errorHandler: './server/error.ts',
    esbuild: {
      options: { target: 'es2022' },
    },
  },
  routeRules: {
    '/api/auth/**': { cors: false },
  },
})
