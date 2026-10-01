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
    public: {
      appUrl: developmentEnv.APP_URL || 'http://localhost:3000',
      billingTimezone: developmentEnv.BILLING_TIMEZONE || 'Asia/Makassar',
      companyName: developmentEnv.COMPANY_NAME || 'Billing Infra',
      companyEmail: developmentEnv.COMPANY_EMAIL || '',
    },
  },
  nitro: {
    preset: 'node-server',
    // PDFKit and Better Auth currently depend on different major versions of
    // @noble packages. Keeping both dependency trees inside the server bundle
    // avoids Node resolving PDFKit's self-imports against Better Auth's newer
    // top-level version in Nitro's standalone output.
    externals: {
      inline: ['pdfkit', '@noble/hashes', '@noble/ciphers'],
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
