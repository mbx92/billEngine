import { expect, test } from '@playwright/test'

test('opens the portal and switches customers without refreshing or retaining previous account data', async ({
  page,
}) => {
  let email: string | null = null
  let anonymousChecks = 0
  let documentRequests = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/sign-in/email') email = request.postDataJSON().email
    if (path === '/api/auth/sign-out') email = null
    const name = email === 'second@example.test' ? 'Customer Kedua' : 'Customer Pertama'
    const user = { id: email, name, email, role: 'customer', customerId: email }
    let body: unknown = { data: [] }
    if (path === '/api/auth/sign-in/email') body = { user, token: 'fixture', redirect: false }
    else if (path === '/api/auth/sign-out') body = { success: true }
    else if (path === '/api/auth/get-session') {
      if (!email) anonymousChecks++
      body = email ? { user, session: { id: 'fixture', expiresAt: '2099-01-01T00:00:00Z' } } : null
    } else if (path === '/api/me') body = { data: user }
    else if (path === '/api/settings')
      body = { data: { companyName: 'Fixture', billingTimezone: 'UTC', billingCurrency: 'IDR' } }
    else if (path === '/api/portal/summary') {
      if (!email) {
        await route.fulfill({
          status: 401,
          json: { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' } },
        })
        return
      }
      body = {
        data: {
          customer: { id: email, customerNumber: 'CUS-TEST', name, email, status: 'active' },
          services: [],
          invoices: [],
          openBalance: [],
        },
      }
    }
    await route.fulfill({ json: body })
  })
  await page.goto('/login')
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as HTMLElement & {
      __vue_app__?: { config: { globalProperties: { $nuxt?: { isHydrating: boolean } } } }
    }
    return root?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false
  })
  // Exercise a failed protected navigation before login in the same SPA session.
  await page.evaluate(async () => {
    const root = document.querySelector('#__nuxt') as HTMLElement & {
      __vue_app__: {
        config: { globalProperties: { $router: { push: (path: string) => Promise<unknown> } } }
      }
    }
    await root.__vue_app__.config.globalProperties.$router.push('/portal')
  })
  await expect(page).toHaveURL(/\/login\?redirect=/)
  expect(anonymousChecks).toBeGreaterThan(0)
  for (const [account, name] of [
    ['first@example.test', 'Customer Pertama'],
    ['second@example.test', 'Customer Kedua'],
  ]) {
    await page.getByLabel('Email').fill(account!)
    await page.getByLabel('Password', { exact: true }).fill('fixture-password')
    await page.getByRole('button', { name: 'Masuk', exact: true }).click()
    await expect(page).toHaveURL(/\/portal$/)
    await expect(page.getByRole('heading', { name: name!, exact: true })).toBeVisible()
    if (account === 'first@example.test') {
      await page.getByRole('button', { name: 'Sign out', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Masuk', exact: true })).toBeVisible()
    } else
      await expect(
        page.getByRole('heading', { name: 'Customer Pertama', exact: true }),
      ).toHaveCount(0)
  }
  expect(documentRequests).toBe(1)
})

for (const role of ['customer', 'admin'] as const) {
  test(`${role} login preserves the requested invoice`, async ({ page }) => {
    const user = {
      id: 'fixture',
      name: 'Fixture',
      email: 'fixture@example.test',
      role,
      customerId: role === 'customer' ? 'customer-1' : null,
    }
    const invoiceId = '11111111-1111-4111-8111-111111111111'
    let signedIn = false
    let rejectLogin = true
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      let body: unknown = { data: [] }
      if (path === '/api/auth/sign-in/email') {
        if (rejectLogin) {
          rejectLogin = false
          await route.fulfill({
            status: 401,
            json: {
              code: 'INVALID_EMAIL_OR_PASSWORD',
              message: 'Email atau password tidak sesuai.',
            },
          })
          return
        }
        signedIn = true
        body = { user, token: 'fixture', redirect: false }
      } else if (path === '/api/auth/get-session')
        body = signedIn
          ? { user, session: { id: 'fixture', expiresAt: '2099-01-01T00:00:00Z' } }
          : null
      else if (path === '/api/me') body = { data: user }
      else if (path === '/api/settings')
        body = { data: { companyName: 'Fixture', billingTimezone: 'UTC', billingCurrency: 'IDR' } }
      else if (path.endsWith(`/invoices/${invoiceId}`))
        body = {
          data: {
            invoice: {
              id: invoiceId,
              invoiceNumber: 'INV-PORTAL-TEST',
              status: 'overdue',
              currency: 'IDR',
              issueDate: '2026-01-01',
              dueDate: '2026-01-02',
              subtotalAmount: '0',
              discountAmount: '0',
              taxAmount: '0',
              totalAmount: '0',
              balanceDue: '0',
              amountPaid: '0',
              creditedAmount: '0',
              sellerName: 'Fixture',
              customerName: 'Customer',
              customerEmail: 'fixture@example.test',
              daysPastDue: 1,
            },
            items: [],
            payments: [],
            creditNotes: [],
          },
        }
      await route.fulfill({ json: body })
    })
    await page.goto(`/login?redirect=${encodeURIComponent(`/portal/invoices/${invoiceId}`)}`)
    await page.waitForFunction(() => {
      const root = document.querySelector('#__nuxt') as HTMLElement & {
        __vue_app__?: { config: { globalProperties: { $nuxt?: { isHydrating: boolean } } } }
      }
      return root?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false
    })
    await expect(
      page.getByText('Email pada invoice belum tentu sudah memiliki akun login.', { exact: false }),
    ).toBeVisible()
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password', { exact: true }).fill('fixture-password')
    const login = page.getByRole('button', { name: 'Masuk', exact: true })
    await login.click()
    await expect(page.getByRole('alert')).toContainText('Email atau password tidak sesuai.')
    await expect(login).toBeEnabled()
    await login.click()
    await expect(page).toHaveURL(
      new RegExp(`${role === 'customer' ? '/portal' : ''}/invoices/${invoiceId}$`),
    )
    await expect(page.getByRole('heading', { name: 'INV-PORTAL-TEST', exact: true })).toBeVisible()
    if (role === 'customer')
      await expect(page.getByRole('link', { name: 'Servers', exact: true })).toHaveCount(0)
  })
}

test('unlinked customer can switch accounts from the access explanation', async ({ page }) => {
  const user = {
    id: 'fixture',
    name: 'Fixture',
    email: 'fixture@example.test',
    role: 'customer',
    customerId: null,
  }
  let signedIn = false
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { data: [] }
    if (path === '/api/auth/sign-in/email') {
      signedIn = true
      body = { user, token: 'fixture', redirect: false }
    } else if (path === '/api/auth/get-session')
      body = signedIn
        ? { user, session: { id: 'fixture', expiresAt: '2099-01-01T00:00:00Z' } }
        : null
    else if (path === '/api/auth/sign-out') {
      signedIn = false
      body = { success: true }
    }
    await route.fulfill({ json: body })
  })
  await page.goto('/login?redirect=%2Fportal')
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as HTMLElement & {
      __vue_app__?: { config: { globalProperties: { $nuxt?: { isHydrating: boolean } } } }
    }
    return root?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false
  })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Akses portal belum tersedia' })).toBeVisible()
  await page.getByRole('button', { name: 'Gunakan akun lain' }).click()
  await expect(page.getByRole('heading', { name: 'Masuk', exact: true })).toBeVisible()
})
