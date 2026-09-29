import tailwindcss from '@tailwindcss/vite'

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
    databaseUrl: process.env.DATABASE_URL,
    betterAuthSecret: process.env.BETTER_AUTH_SECRET,
    betterAuthUrl: process.env.BETTER_AUTH_URL,
    coolifyApiUrl: process.env.COOLIFY_API_URL,
    coolifyApiToken: process.env.COOLIFY_API_TOKEN,
    coolifyCredentialsKey: process.env.COOLIFY_CREDENTIALS_KEY,
    companyName: process.env.COMPANY_NAME || 'Billing Infra',
    companyEmail: process.env.COMPANY_EMAIL || '',
    companyAddress: process.env.COMPANY_ADDRESS || '',
    companyTaxId: process.env.COMPANY_TAX_ID || '',
    billingTimezone: process.env.BILLING_TIMEZONE || 'Asia/Makassar',
    billingCurrency: process.env.BILLING_CURRENCY || 'IDR',
    // numeric(7,4) fraction, e.g. 0.11 for 11% VAT. Empty means no tax.
    billingDefaultTaxRate: process.env.BILLING_DEFAULT_TAX_RATE || '',
    billingAutomationEnabled: process.env.BILLING_AUTOMATION_ENABLED === 'true',
    public: {
      appUrl: process.env.APP_URL || 'http://localhost:3000',
      billingTimezone: process.env.BILLING_TIMEZONE || 'Asia/Makassar',
      companyName: process.env.COMPANY_NAME || 'Billing Infra',
      companyEmail: process.env.COMPANY_EMAIL || '',
    },
  },
  nitro: {
    preset: 'node-server',
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
