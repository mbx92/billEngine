import { expect, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Exercise the real component without credentials or mutations to billing data.
test.describe('global custom select', () => {
  test.describe.configure({ mode: 'serial' })
  let server: ViteDevServer
  let url: string

  test.beforeAll(async () => {
    server = await createServer({
      configFile: false,
      plugins: [vue(), tailwindcss()],
      server: { host: '127.0.0.1', port: 0 },
    })
    await server.listen()
    url = `${server.resolvedUrls!.local[0]}tests/fixtures/select.html`
  })
  test.afterAll(async () => {
    await server?.close()
  })
  test.beforeEach(async ({ page }) => {
    await page.goto(url)
  })

  test('validates required fields, selects with keyboard and submits the value', async ({
    page,
  }) => {
    const select = page.getByRole('combobox')
    await page.getByRole('button', { name: 'Simpan' }).click()
    await expect(select).toBeFocused()
    await expect(select).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('submitted')).toHaveText('0')
    await select.press('ArrowDown')
    await select.press('ArrowDown') // Skip disabled Blocked.
    await select.press('Enter')
    await expect(select).toHaveText('Beta')
    await expect(page.getByTestId('changes')).toHaveText('1')
    await page.getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByTestId('submitted')).toHaveText('1')
    expect(
      await page
        .locator('form')
        .evaluate((form) => new FormData(form as HTMLFormElement).get('customer')),
    ).toBe('beta')
  })

  test('supports pointer selection, null values, external changes and outside dismissal', async ({
    page,
  }) => {
    const select = page.getByRole('combobox')
    await select.click()
    await page.getByRole('option', { name: 'Tanpa customer' }).click()
    await expect(select).toHaveText('Tanpa customer')
    await expect(page.getByTestId('value')).toHaveText('null')
    await page.getByRole('button', { name: 'Set externally' }).click()
    await expect(select).toHaveText('Alpha')
    await select.click()
    await page.getByTestId('changes').click()
    await expect(page.getByRole('listbox')).toHaveCount(0)
  })

  test('supports type-ahead, disabled and empty states', async ({ page }) => {
    const select = page.getByRole('combobox')
    await select.focus()
    await select.press('b')
    await select.press('Enter')
    await expect(select).toHaveText('Beta')
    await page.getByRole('button', { name: 'Toggle disabled' }).click()
    await expect(select).toBeDisabled()
    await page.getByRole('button', { name: 'Toggle disabled' }).click()
    await page.getByRole('button', { name: 'Kosongkan' }).click()
    await select.click()
    await expect(page.getByText('Tidak ada pilihan')).toBeVisible()
    await select.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
  })

  test('keeps dialog focus and handles Escape one layer at a time', async ({ page }) => {
    await page.getByRole('button', { name: 'Buka dialog' }).click()
    const dialog = page.getByRole('dialog')
    const select = dialog.getByRole('combobox')
    await expect(select).toBeFocused()
    await select.click()
    await expect(dialog.getByRole('listbox')).toBeVisible()
    await dialog.getByRole('option', { name: 'Beta', exact: true }).click()
    await expect(select).toBeFocused()
    await expect(select).toHaveText('Beta')
    await select.click()
    await select.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await select.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Sesudah select' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('keeps the popup inside a narrow viewport and opens above when needed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 640 })
    await page.locator('form').evaluate((form) => {
      form.style.marginTop = '400px'
    })
    const select = page.getByRole('combobox')
    await select.click()
    const triggerBounds = await select.boundingBox()
    const popupBounds = await page.getByRole('listbox').boundingBox()
    expect(popupBounds!.x).toBeGreaterThanOrEqual(0)
    expect(popupBounds!.x + popupBounds!.width).toBeLessThanOrEqual(390)
    expect(popupBounds!.y).toBeGreaterThanOrEqual(0)
    expect(popupBounds!.y + popupBounds!.height).toBeLessThanOrEqual(triggerBounds!.y)
    await page.getByRole('option', { name: 'Alpha', exact: true }).click()
    await expect(select).toHaveText('Alpha')
  })
})
