import { expect, test } from '@playwright/test'

test('configures gate per node and verifies a Compose resource through the proxy', async ({
  page,
}) => {
  const nodeId = '22222222-2222-4222-8222-222222222222'
  const resourceId = '33333333-3333-4333-8333-333333333333'
  const node = {
    id: nodeId,
    coolifyUuid: 'remote-node',
    name: 'App Node',
    address: '10.0.0.5',
    isReachable: true,
    isUsable: true,
    status: 'ready',
    resourceCount: 1,
  }
  const user = {
    id: 'fixture',
    name: 'Fixture Admin',
    role: 'super_admin',
    email: 'fixture@example.test',
  }
  const url = 'http://host.docker.internal:8010/api/billing-gate/check'
  const writes: Array<{ path: string; body: Record<string, unknown> }> = []
  let saved = false
  let verificationAttempts = 0
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const input = request.method() !== 'GET' ? request.postDataJSON() : null
    if (input) writes.push({ path, body: input })
    let body: unknown
    if (path === '/api/auth/sign-in/email') body = { user, token: 'fixture', redirect: false }
    else if (path === '/api/auth/get-session')
      body = { user, session: { id: 'fixture', expiresAt: '2099-01-01T00:00:00Z' } }
    else if (path === '/api/me') body = { data: user }
    else if (path === '/api/settings')
      body = { data: { companyName: 'Fixture', billingTimezone: 'UTC', billingCurrency: 'IDR' } }
    else if (path === '/api/resources/servers')
      body = {
        data: [
          {
            id: 'connection',
            name: 'Coolify Fixture',
            baseUrl: 'https://coolify.example.test',
            status: 'connected',
            credentialSource: 'stored',
            resourceCount: 1,
            nodes: [node],
          },
        ],
      }
    else if (path === `/api/resources/nodes/${nodeId}/gateway`) {
      if (request.method() === 'POST') {
        saved = true
        body = {
          data: { message: 'Konfigurasi tersimpan. Restart proxy secara manual di Coolify.' },
        }
      } else
        body = {
          data: {
            nodeName: node.name,
            checkUrl: url,
            selected: ['http', 'https'],
            savedAt: saved ? '2026-11-02T00:00:00Z' : null,
            entrypoints: [
              {
                name: 'http',
                address: ':80',
                middlewares: saved ? 'billing-gate@file' : '',
                recommended: true,
              },
              {
                name: 'https',
                address: ':443',
                middlewares: saved ? 'compress@file,billing-gate@file' : 'compress@file',
                recommended: true,
              },
            ],
          },
        }
    } else if (path === `/api/resources/nodes/${nodeId}/gateway-preview`) {
      if (String(input.checkUrl).startsWith('https:')) {
        await route.fulfill({
          status: 400,
          json: {
            error: { code: 'VALIDATION_ERROR', message: 'Gunakan alamat internal langsung.' },
          },
        })
        return
      }
      body = {
        data: {
          revision: 'b'.repeat(64),
          changed: true,
          healthcheck: {
            before: 'wget -qO- http://localhost:80/ping || exit 1',
            after: 'wget -qO- http://127.0.0.1:9082/ping || exit 1',
            address: '127.0.0.1:9082',
          },
          changes: [
            {
              entrypoint: 'https',
              before: 'compress@file',
              after: 'compress@file,billing-gate@file',
            },
          ],
        },
      }
    } else if (path === '/api/resources')
      body = {
        data: [
          {
            id: resourceId,
            name: 'Compose Trial',
            coolifyUuid: 'compose-app',
            resourceType: 'application',
            status: 'running',
            classification: 'billable',
            services: [],
            serverName: node.name,
            limitsCpus: null,
            limitsMemoryBytes: null,
            lastSeenAt: null,
          },
        ],
        meta: { page: 1, total: 1, perPage: 25, totalPages: 1 },
      }
    else if (path === `/api/resources/${resourceId}/gateway`)
      body = {
        data: {
          mode: 'proxy',
          nodeUuid: 'remote-node',
          configured: false,
          changes: [],
          urls: ['https://app.example.test/'],
          revision: 'c'.repeat(64),
          verifiedAt: null,
        },
      }
    else if (path === `/api/resources/${resourceId}/gateway-verify`) {
      verificationAttempts++
      const verified = verificationAttempts > 1
      body = {
        data: {
          reachable: verified,
          enabled: true,
          results: [
            {
              url: 'https://app.example.test/',
              verified,
              state: 'grace',
              status: verified ? 418 : 200,
              reason: verified ? 'verified' : 'missing_proof',
              message: verified
                ? 'Bukti valid.'
                : 'Cloudflare Tunnel harus menuju Traefik, bukan port aplikasi.',
            },
          ],
        },
      }
    } else body = { data: [] }
    await route.fulfill({ json: body })
  })
  await page.goto('/login?redirect=/servers')
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as HTMLElement & {
      __vue_app__?: { config: { globalProperties: { $nuxt?: { isHydrating: boolean } } } }
    }
    return root?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false
  })
  await page.getByLabel('Email').fill('fixture@example.test')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('button', { name: 'Gate proxy', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const save = dialog.getByRole('button', { name: 'Simpan konfigurasi proxy' })
  await expect(save).toBeDisabled()
  await dialog
    .getByLabel('URL internal gate pada file middleware')
    .fill('https://billing.example.test/api/billing-gate/check')
  await dialog.getByRole('button', { name: 'Pratinjau', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Gunakan alamat internal langsung.')
  await expect(save).toBeDisabled()
  await dialog.getByLabel('URL internal gate pada file middleware').fill(url)
  await dialog.getByRole('button', { name: 'Pratinjau', exact: true }).click()
  await expect(dialog.getByText('Sesudah: compress@file,billing-gate@file')).toBeVisible()
  await expect(dialog.getByText('Pisahkan healthcheck proxy dari billing gate')).toBeVisible()
  await expect(
    dialog.getByText('Sesudah: wget -qO- http://127.0.0.1:9082/ping || exit 1'),
  ).toBeVisible()
  await dialog.getByRole('checkbox', { name: /^billing-gate.yaml sudah/ }).check()
  await dialog.getByRole('checkbox', { name: /^Alamat gate dapat/ }).check()
  await save.click()
  await expect(dialog.getByRole('status')).toContainText('Restart proxy secara manual')
  const write = writes.find((item) => item.path === `/api/resources/nodes/${nodeId}/gateway`)
  expect(write?.body).toMatchObject({
    revision: 'b'.repeat(64),
    entrypoints: ['http', 'https'],
    middlewareReady: true,
    internalRouteConfirmed: true,
  })
  await dialog.getByRole('button', { name: 'Tutup dialog' }).click()
  await page.getByRole('link', { name: 'Resources', exact: true }).click()
  await page.getByRole('button', { name: 'Konfigurasi gate' }).click()
  await expect(dialog.getByRole('link', { name: 'Servers → Gate proxy' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Simpan ke Coolify' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Periksa gate' }).click()
  await expect(dialog.getByText(/HTTP 200/)).toBeVisible()
  await expect(
    dialog.getByText('Cloudflare Tunnel harus menuju Traefik, bukan port aplikasi.'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Periksa gate' }).click()
  await expect(dialog.getByText('Proxy berhasil mencapai gate BillEngine.')).toBeVisible()
  expect(writes.some((item) => /deploy|restart/.test(item.path))).toBe(false)
})

test('previews, saves and verifies gateway configuration with isolated API fixtures', async ({
  page,
}) => {
  const id = '11111111-1111-4111-8111-111111111111'
  let configured = false
  let verified = false
  let checkUrl = 'https://billing.example.test/api/billing-gate/check'
  const writes: Array<{ path: string; body: unknown }> = []
  const settings = {
    companyName: 'Test Billing',
    companyEmail: null,
    companyAddress: null,
    companyTaxId: null,
    billingTimezone: 'Asia/Makassar',
    billingCurrency: 'IDR',
    defaultTaxRate: null,
    billingAutomationEnabled: false,
    billingAccessControlEnabled: true,
    overdueGraceDays: 7,
    graceNoticeIntervalHours: 24,
    source: 'database',
    updatedAt: null,
  }
  const user = {
    id,
    email: 'fixture@example.test',
    name: 'Fixture Admin',
    role: 'super_admin',
    emailVerified: true,
  }
  // Every API request is intercepted: this test cannot modify local or Coolify data.
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') writes.push({ path, body: request.postDataJSON() })
    let body: unknown
    if (path === '/api/auth/sign-in/email') body = { user, token: 'fixture', redirect: false }
    else if (path === '/api/auth/get-session')
      body = { user, session: { id, userId: id, expiresAt: '2099-01-01T00:00:00Z' } }
    else if (path === '/api/me') body = { data: user }
    else if (path === '/api/settings') body = { data: settings }
    else if (path === '/api/settings/gateway-yaml') {
      body = {
        data: {
          yaml: `http:\n  middlewares:\n    billing-gate-forward:\n      forwardAuth:\n        address: ${request.postDataJSON().checkUrl}\n    billing-gate-key:\n      headers:\n        customRequestHeaders:\n          X-Billing-Gate-Key: fixture-shared-key`,
        },
      }
    } else if (path === '/api/settings/gateway') {
      if (request.method() === 'PUT') checkUrl = request.postDataJSON().checkUrl
      body = { data: { checkUrl, secretsConfigured: true } }
    } else if (path === '/api/resources')
      body = {
        data: [
          {
            id,
            name: 'Trial App',
            coolifyUuid: 'coolify-app',
            resourceType: 'application',
            status: 'running',
            classification: 'billable',
            fqdn: 'https://app.example.test',
            services: [],
            serverName: 'Test Server',
            limitsCpus: null,
            limitsMemoryBytes: null,
            lastSeenAt: null,
          },
        ],
        meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
      }
    else if (path === `/api/resources/${id}/gateway`) {
      if (request.method() === 'POST') configured = true
      body = {
        data: {
          revision: 'a'.repeat(64),
          configured,
          urls: ['https://app.example.test/'],
          verifiedAt: verified ? '2026-11-02T00:00:00Z' : null,
          changes: [
            {
              router: 'https-app',
              before: configured ? 'gzip,billing-gate@file' : 'gzip',
              after: 'gzip,billing-gate@file',
            },
          ],
        },
      }
    } else if (path === `/api/resources/${id}/gateway-verify`) {
      verified = true
      body = {
        data: {
          reachable: true,
          enabled: true,
          results: [{ url: 'https://app.example.test/', verified: true, state: 'grace' }],
        },
      }
    } else body = { data: [] }
    await route.fulfill({ json: body })
  })
  await page.goto('/login?redirect=/resources')
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as HTMLElement & {
      __vue_app__?: { config: { globalProperties: { $nuxt?: { isHydrating: boolean } } } }
    }
    return root?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false
  })
  await page.getByLabel('Email').fill('fixture@example.test')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('button', { name: 'Konfigurasi gate' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Sesudah: gzip,billing-gate@file')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Simpan ke Coolify' })).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Simpan ke Coolify' }).click()
  await expect(dialog.getByText('Tersimpan di Coolify.', { exact: false })).toBeVisible()
  expect(writes.find((write) => write.path.endsWith('/gateway'))?.body).toEqual({
    revision: 'a'.repeat(64),
    middlewareReady: true,
  })
  await dialog.getByRole('button', { name: 'Periksa gate' }).click()
  await expect(dialog.getByText('Proxy berhasil mencapai gate BillEngine.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Tutup dialog' }).click()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page
    .getByLabel('URL pemeriksaan gate dari proxy')
    .fill('https://new-billing.example.test/api/billing-gate/check')
  await page.getByRole('button', { name: 'Simpan URL gateway' }).click()
  await expect(page.getByText('URL tersimpan.', { exact: false })).toBeVisible()
  await page.getByText('Konfigurasi manual billing-gate.yaml', { exact: true }).click()
  await expect(page.locator('details pre')).toHaveCount(0)
  await page.getByRole('button', { name: 'Generate YAML dari env' }).click()
  await expect(page.locator('details pre')).toContainText(
    'https://new-billing.example.test/api/billing-gate/check',
  )
  await expect(page.locator('details pre')).toContainText('fixture-shared-key')
  await page.getByRole('button', { name: 'Sembunyikan', exact: true }).click()
  await expect(page.locator('details pre')).toHaveCount(0)
  expect(writes.some((write) => /deploy|restart/.test(write.path))).toBe(false)
})
