import { expect, test } from '@playwright/test'

test('confirms connection deletion, displays dependency errors, and refreshes the list', async ({
  page,
}) => {
  const user = { id: 'fixture', name: 'Admin', role: 'super_admin', email: 'fixture@example.test' }
  const id = '11111111-1111-4111-8111-111111111111'
  let deleted = false
  let attempts = 0
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body: unknown = { data: [] }
    if (path === '/api/auth/sign-in/email') body = { user, token: 'fixture', redirect: false }
    else if (path === '/api/auth/get-session')
      body = { user, session: { id: 'fixture', expiresAt: '2099-01-01T00:00:00Z' } }
    else if (path === '/api/me') body = { data: user }
    else if (path === '/api/settings')
      body = { data: { companyName: 'Fixture', billingTimezone: 'UTC', billingCurrency: 'IDR' } }
    else if (path === '/api/resources/servers')
      body = {
        data: deleted
          ? []
          : [
              {
                id,
                name: 'Coolify Fixture',
                baseUrl: 'https://coolify.example.test',
                status: 'connected',
                credentialSource: 'stored',
                resourceCount: 1,
                nodes: [],
              },
            ],
      }
    else if (path === `/api/resources/servers/${id}` && request.method() === 'DELETE') {
      attempts++
      if (attempts === 1) {
        await route.fulfill({
          status: 409,
          json: {
            error: { code: 'CONFLICT', message: 'Resource masih terhubung ke layanan billing.' },
          },
        })
        return
      }
      deleted = true
      body = { data: { id } }
    }
    await route.fulfill({ json: body })
  })
  await page.goto('/login?redirect=/servers')
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as HTMLElement & {
      __vue_app__?: { config: { globalProperties: { $nuxt?: { isHydrating: boolean } } } }
    }
    return root?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false
  })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('button', { name: 'Hapus server', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('https://coolify.example.test')
  await dialog.getByRole('button', { name: 'Batal', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(attempts).toBe(0)
  await page.getByRole('button', { name: 'Hapus server', exact: true }).click()
  await dialog.getByRole('button', { name: 'Hapus koneksi', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Resource masih terhubung ke layanan billing.')
  await expect(page.getByRole('button', { name: 'Hapus server', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Hapus koneksi', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('status')).toContainText('Koneksi server dihapus')
  await expect(page.getByRole('button', { name: 'Hapus server', exact: true })).toHaveCount(0)
  expect(attempts).toBe(2)
})
