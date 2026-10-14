import { test, expect } from '@playwright/test';

test('load demo, filter and compare, explain excluded runs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /query-clustering eval viewer/i })).toBeVisible();
  await page.getByRole('button', { name: /load synthetic demo/i }).first().click();
  await expect(page.getByText(/synthetic demo loaded/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/support-queries/i).first()).toBeVisible();
  const compatSelect = page.getByLabel(/compatibility/i).first();
  await compatSelect.selectOption('unverified');
  await expect(page.getByRole('heading', { name: /raw run table/i })).toBeVisible();
  await compatSelect.selectOption('all');
  await page.getByRole('button', { name: /clear filters/i }).click();
  await expect(page.getByRole('heading', { name: /controlled comparison table/i })).toBeVisible();
});

test('inspect validation issues, drill into examples, handle absent examples', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /load synthetic demo/i }).first().click();
  await expect(page.getByText(/synthetic demo loaded/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('heading', { name: /example drill-down/i })).toBeVisible();
  await page.getByText('demo-aurora-r1 — 3 supplied examples').click();
  await expect(page.getByText('reset my password').first()).toBeVisible();
});

test('export and re-import round trip', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /load synthetic demo/i }).first().click();
  await expect(page.getByText(/synthetic demo loaded/i)).toBeVisible({ timeout: 10000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export canonical json/i }).click();
  const dl = await downloadPromise;
  expect(await dl.suggestedFilename()).toMatch(/workspace-canonical/);
});

test('keyboard navigation reaches main controls', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /load synthetic demo/i }).first()).toBeFocused();
});

test('no imported-data network transmission during core workflows', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (
      url.startsWith('http://localhost:5174') ||
      url.startsWith('http://127.0.0.1:5174') ||
      url.startsWith('http://localhost:5173') ||
      url.startsWith('http://127.0.0.1:5173') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.includes('local.adguard.org')
    ) {
      return;
    }
    external.push(url);
  });
  await page.goto('/');
  await page.getByRole('button', { name: /load synthetic demo/i }).first().click();
  await expect(page.getByText(/synthetic demo loaded/i)).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /export raw metrics csv/i }).click();
  expect(external.filter((u) => !u.includes('favicon'))).toEqual([]);
});
