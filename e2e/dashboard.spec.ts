import { expect, test } from '@playwright/test';

test('reads never sync; explicit imports stream progress, deduplicate, and preserve records on failure', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Every run starts somewhere.' })).toBeVisible();
  await expect(page.getByText('Your first entry is waiting')).toBeVisible();
  await page.getByRole('link', { name: 'Health', exact: false }).first().click();
  await expect(page.getByText('No health records yet')).toBeVisible();
  await page.reload();
  expect((await (await request.get('/api/test/calls')).json()).count).toBe(0);
  await page.getByRole('link', { name: 'Synchronization' }).click();
  await page.getByRole('button', { name: 'Sync recent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import in progress' })).toBeVisible();
  await expect(page.locator('.badge.completed')).toHaveCount(1);
  expect((await (await request.get('/api/test/calls')).json()).count).toBe(3);
  await page.getByRole('link', { name: 'Runs', exact: false }).first().click();
  await expect(page.getByRole('link', { name: 'Morning in the park' })).toHaveCount(1);
  await page.getByRole('link', { name: 'Morning in the park' }).click();
  await expect(page.getByRole('heading', { name: 'Recorded intervals' })).toBeVisible();
  await expect(page.getByText('Steady run')).toBeVisible();
  await page.getByRole('link', { name: 'Synchronization' }).click();
  await page.getByRole('button', { name: 'Sync recent', exact: true }).click();
  await expect(page.locator('.badge.completed')).toHaveCount(2);
  await request.post('/api/test/fail', { data: {} });
  await page.getByRole('button', { name: 'Sync recent', exact: true }).click();
  await expect(page.locator('.badge.failed')).toHaveCount(1);
  await page.getByRole('link', { name: 'Runs', exact: false }).first().click();
  await expect(page.getByRole('link', { name: 'Morning in the park' })).toHaveCount(1);
  await page.goto('/');
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
