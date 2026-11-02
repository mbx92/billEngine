import { expect, test } from '@playwright/test'

test('shows the login boundary', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Masuk', exact: true })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeVisible()
})

test('switches and persists the color theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/login')

  const toggle = page.getByRole('button', { name: 'Aktifkan dark mode' })
  await expect(toggle).toBeVisible()
  await toggle.click()

  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('billing-theme'))).toBe('dark')

  await page.reload()
  await expect(page.getByRole('button', { name: 'Aktifkan light mode' })).toBeVisible()
})

test('uses compact card spacing on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')

  const card = page.getByRole('heading', { name: 'Masuk', exact: true }).locator('..')
  const padding = await card.evaluate((element) => getComputedStyle(element).padding)
  expect(padding).toBe('16px')
})
