import { expect, test, type Page } from '@playwright/test';
import { tokenFor, type STAFF } from './staff';

async function signIn(page: Page, role: keyof typeof STAFF) {
  await page.goto('/');
  await page.getByLabel('Development token').fill(await tokenFor(role));
  await page.getByRole('button', { name: 'Use development token' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

test('editor drafts, another reviewer approves, administrator publishes', async ({ browser }) => {
  const stem = `How many sides does a hexagon have? ${Date.now()}`;

  // Editor creates and submits a draft.
  const editor = await (await browser.newContext()).newPage();
  await signIn(editor, 'editor');
  await editor.getByRole('link', { name: 'New question' }).click();
  await editor.getByLabel('Topic').selectOption('geometry');
  await editor.getByLabel('Question text 1').fill(stem);
  for (const [id, text] of [
    ['a', '5'],
    ['b', '6'],
    ['c', '7'],
    ['d', '8'],
  ] as const) {
    await editor.getByLabel(id.toUpperCase(), { exact: true }).fill(text);
  }
  await editor.getByLabel('Choice B is correct').check();
  await editor.getByLabel('Explanation text 1').fill('A hexagon has six sides.');
  // Preview mirrors the draft.
  await expect(editor.getByLabel('Mobile preview')).toContainText(stem);
  await editor.getByRole('button', { name: 'Create draft' }).click();
  await expect(editor.getByText('draft', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Submit for review' }).click();
  await expect(editor.getByText('in_review', { exact: true })).toBeVisible();
  const versionUrl = editor.url();
  // The author has no approve control.
  await expect(editor.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // Reviewer approves from the review queue.
  const reviewer = await (await browser.newContext()).newPage();
  await signIn(reviewer, 'reviewer');
  await reviewer.getByRole('link', { name: 'Review queue' }).click();
  await reviewer.getByRole('link', { name: stem }).click();
  await reviewer.getByLabel('Review comments').fill('Clear and correct.');
  await reviewer.getByRole('button', { name: 'Approve' }).click();
  await expect(reviewer.getByText('approved', { exact: true })).toBeVisible();

  // Administrator publishes after confirming.
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'administrator');
  await admin.goto(versionUrl);
  admin.once('dialog', (d) => void d.accept());
  await admin.getByRole('button', { name: 'Publish' }).click();
  await expect(admin.getByText('published', { exact: true })).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Audit history' })).toBeVisible();
  await expect(admin.getByText(/version\.published/)).toBeVisible();

  // Published versions are read-only in the editor.
  await editor.goto(versionUrl);
  await expect(editor.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Create correction draft' })).toBeVisible();
});

test('invalid content is rejected with a readable error', async ({ page }) => {
  await signIn(page, 'editor');
  await page.getByRole('link', { name: 'New question' }).click();
  await page.getByLabel('Question text 1').fill('Incomplete');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('alert')).toContainText(/block schema|invalid/i);
});
