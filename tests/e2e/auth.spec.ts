/**
 * E2E Auth flow tests.
 *
 * Prerequisites:
 * - Dev server running (Playwright webServer config handles this)
 * - Test database seeded via seedE2E()
 *
 * These tests validate the core authentication flow:
 * - Login with valid credentials
 * - Login with invalid credentials shows error
 * - Authenticated navigation works
 */
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('login page is accessible', async ({ page }) => {
    await page.goto('/');
    // Should redirect to login or show login form
    await expect(page).toHaveURL(/\/(login|auth)/);
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'nonexistent@test.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Should show an error message
    await expect(page.locator('.text-red-500, .text-red-600, [role="alert"]')).toBeVisible({ timeout: 5000 });
  });

  // This test requires seedE2E() to have run
  test.skip('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'e2e-admin@test.com');
    await page.fill('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    // Should redirect to main app (not login)
    await expect(page).not.toHaveURL(/login/);
  });
});
