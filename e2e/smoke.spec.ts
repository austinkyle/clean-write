import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

async function resetDocuments(page: Page) {
  const response = await page.request.get('/api/documents');
  const data = await response.json() as { documents: { id: string }[] };
  for (const document of data.documents) await page.request.delete(`/api/documents/${document.id}`);
}

test('creates, edits, formats, renames, and persists a document', async ({ page }) => {
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();

  await expect(page.getByText('ClearWrite', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create document', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();

  const editor = page.locator('.tiptap-content');
  await expect(editor).toBeVisible();
  await editor.fill('A clear beginning.');
  await editor.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await editor.press('End');
  await editor.press('Enter');
  await page.getByLabel('Text style').selectOption('2');
  await editor.fill('A clear beginning.\nA second thought.');

  const title = page.getByLabel('Document title');
  await title.fill('Morning notes');
  await title.press('Enter');
  await expect(page.getByText('Morning notes', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved locally', { exact: true }).last()).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Document title')).toHaveValue('Morning notes');
  await expect(editor).toContainText('A second thought.');
});

test('switches documents, duplicates independently, deletes with confirmation, and changes modes', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false }) }));
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();

  const editor = page.locator('.tiptap-content');
  await editor.fill('Original content');
  await page.getByLabel('Document title').fill('Original');
  await page.getByLabel('Document title').press('Enter');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Duplicate document' }).click();
  await expect(page.getByLabel('Document title')).toHaveValue(/Copy$/);
  await editor.fill('Changed copy');
  await page.waitForTimeout(800);

  await page.locator('.document-title').filter({ hasText: 'Original' }).last().click();
  await expect(editor).toContainText('Original content');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByText('READABILITY', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await expect(page.getByText('AI feedback is unavailable.')).toBeVisible();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.getByText('READABILITY', { exact: true })).not.toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.document-title').filter({ hasText: 'Original' }).last().locator('..').locator('..').locator('..').locator('.document-menu').click();
  await expect(page.getByLabel('Document title')).toHaveValue(/Copy$/);
});

test('analyzes the live draft in Edit mode and keeps findings ephemeral', async ({ page }) => {
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  const editor = page.locator('.tiptap-content');
  await editor.fill('The committee will utilize numerous resources very quickly. The report was written.');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByText('READABILITY', { exact: true })).toBeVisible();
  await expect(page.locator('.analysis-complex-word').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.analysis-adverb').first()).toBeVisible();
  await expect(page.locator('.analysis-passive').first()).toBeVisible();
  await page.getByRole('button', { name: 'Complex words 2' }).click();
  await expect(page.locator('.analysis-complex-word').first()).not.toBeVisible();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.locator('.analysis-adverb').first()).not.toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.analysis-adverb').first()).toBeVisible();
});

test('applies a local simpler-word replacement through editor history', async ({ page }) => {
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  const editor = page.locator('.tiptap-content');
  await editor.fill('We utilize this method.');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.analysis-complex-word').first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(700);
  await page.locator('.analysis-complex-word').first().click();
  await expect(page.getByText('use', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'use', exact: true }).click();
  await expect(editor).toContainText('We use this method.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(editor).toContainText('We utilize this method.');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(editor).toContainText('We use this method.');
});

test('imports Markdown and downloads clean Markdown from File menu', async ({ page }) => {
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  await page.locator('.tiptap-content').fill('Export me.');
  await page.getByRole('button', { name: 'File' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/u);
  expect((await download.path())).toBeTruthy();
});

test('imports a Markdown file into a new canonical document', async ({ page }) => {
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Import…' }).click();
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), 'e2e/fixtures/sample.md'));
  await expect(page.getByLabel('Document title')).toHaveValue('Sample');
  await expect(page.locator('.tiptap-content')).toContainText('Imported Notes');
  await expect(page.locator('.tiptap-content strong')).toContainText('bold');
});

test('shows selection AI actions and keeps the no-key path local', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false }) }));
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();

  const editor = page.locator('.tiptap-content');
  await editor.fill('A sentence ready for a rewrite.');
  await editor.press('ControlOrMeta+a');
  const aiToolbar = page.getByRole('toolbar', { name: 'AI writing actions' });
  await expect(aiToolbar).toBeVisible();
  await expect(aiToolbar.getByRole('button', { name: 'Simplify' })).toBeVisible();
  await expect(aiToolbar.getByRole('button', { name: 'Polish' })).toBeVisible();
  await expect(aiToolbar.getByRole('button', { name: 'Rephrase' })).toBeVisible();
  await expect(aiToolbar.getByRole('button', { name: 'Synonyms' })).toBeVisible();
  await editor.press('ArrowRight');
  await expect(aiToolbar).not.toBeVisible();
  await editor.press('ControlOrMeta+a');
  await expect(aiToolbar).toBeVisible();
  await aiToolbar.getByRole('button', { name: 'More' }).click();
  await expect(aiToolbar.getByRole('button', { name: 'Shorten' })).toBeVisible();
  await expect(aiToolbar.getByRole('button', { name: 'Ask AI to change this…' })).toBeVisible();
  await aiToolbar.getByRole('button', { name: 'Simplify' }).click();
  await expect(page.getByText('Add your OpenAI API key to enable AI tools.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByText('AI grammar is unavailable. Add your OpenAI API key in Settings.')).toBeVisible();
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await expect(page.getByText('AI feedback is unavailable.')).toBeVisible();
});

test('opens the top AI Tools menu and runs an action on the captured selection', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }));
  await page.route('**/api/ai/rewrite', async (route) => {
    const body = await route.request().postDataJSON() as { action: string; source: { text: string } };
    expect(body.action).toBe('simplify');
    expect(body.source.text).toBe('A sentence ready for a rewrite.');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alternatives: [{ id: 'simplified', text: 'A sentence ready to revise.', rationale: 'Uses simpler wording.' }] }) });
  });
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();

  const editor = page.locator('.tiptap-content');
  await editor.fill('A sentence ready for a rewrite.');
  await editor.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'AI Tools', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'AI tools' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Simplify' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Simplify' }).click();
  await expect(page.getByRole('dialog', { name: 'Review the change' })).toBeVisible();
  await expect(page.getByText('A sentence ready to revise.')).toBeVisible();
});

test('explains that text must be selected before top AI Tools can run', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }));
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  await page.getByRole('button', { name: 'AI Tools', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'AI tools' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Select text in your draft to enable AI tools.')).toBeVisible();
});

test('checks grammar after an Edit-mode pause and applies an exact correction', async ({ page }) => {
  let grammarCalls = 0;
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }));
  await page.route('**/api/ai/grammar', async (route) => {
    grammarCalls += 1;
    const body = await route.request().postDataJSON() as { sources: Array<{ sourceId: string; text: string }> };
    const source = body.sources[0];
    const start = source.text.indexOf('runs');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ issues: [{ sourceId: source.sourceId, start, end: start + 4, original: 'runs', category: 'grammar', subtype: 'agreement', explanation: 'The singular subject takes “runs.”', replacement: 'run', confidence: 'high' }] }) });
  });
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  const editor = page.locator('.tiptap-content');
  await editor.fill('The cats runs.');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.analysis-grammar').first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Grammar 1' })).toBeVisible();
  expect(grammarCalls).toBeGreaterThanOrEqual(1);
  await page.locator('.analysis-grammar').first().click();
  await expect(page.getByText('The singular subject takes “runs.”')).toBeVisible();
  await page.getByRole('button', { name: 'run', exact: true }).click();
  await expect(editor).toContainText('The cats run.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(editor).toContainText('The cats runs.');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(editor).toContainText('The cats run.');
});

test('applies a punctuation insertion through the same replacement path', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }));
  await page.route('**/api/ai/grammar', async (route) => {
    const body = await route.request().postDataJSON() as { sources: Array<{ sourceId: string; text: string }> };
    const source = body.sources[0];
    const end = source.text.length;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ issues: source.text.endsWith('.') ? [] : [{ sourceId: source.sourceId, start: end, end, original: '', category: 'punctuation', subtype: 'missing_period', explanation: 'Add a period to finish the sentence.', replacement: '.', confidence: 'high' }] }) });
  });
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  const editor = page.locator('.tiptap-content');
  await editor.fill('Hello world');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const punctuation = page.locator('.analysis-punctuation').first();
  await expect(punctuation).toBeVisible({ timeout: 5000 });
  await punctuation.click();
  await expect(page.getByText('Add a period to finish the sentence.')).toBeVisible();
  await page.getByRole('button', { name: '.', exact: true }).click();
  await expect(editor).toContainText('Hello world.');
});

test('generates structured Feedback, marks it stale after edits, and regenerates', async ({ page }) => {
  let feedbackCalls = 0;
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }));
  await page.route('**/api/ai/feedback', async (route) => {
    feedbackCalls += 1;
    const body = await route.request().postDataJSON() as { text: string; dialect: string };
    expect(body.text).toContain('clear point');
    expect(body.dialect).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ overallSummary: feedbackCalls === 1 ? 'The draft has a clear point.' : 'The revised draft has a clearer point.', strengths: [{ title: 'Focused opening', detail: 'The opening gives the reader a concrete direction.' }], priorityImprovements: [{ rank: 1, category: 'clarity', title: 'Name the audience', detail: 'The intended reader is implied but not explicit.', recommendation: 'Add one phrase that names who this is for.' }], areas: [{ category: 'clarity', assessment: 'Mostly clear and easy to follow.' }, { category: 'tone', assessment: 'Calm and direct.' }] }) });
  });
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  const editor = page.locator('.tiptap-content');
  await editor.fill('This draft has a clear point.');
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Get Feedback', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Get Feedback', exact: true }).click();
  await expect(page.getByText('Generating Feedback…')).toBeVisible();
  await expect(page.getByText('The draft has a clear point.')).toBeVisible();
  await expect(page.getByText('TOP IMPROVEMENTS')).toBeVisible();
  await expect(page.getByText('Focused opening')).toBeVisible();
  await expect(editor).toContainText('This draft has a clear point.');
  await editor.fill('This draft has a clear point. It now names its reader.');
  await expect(page.getByText('This Feedback is out of date because the document changed.')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('The revised draft has a clearer point.')).toBeVisible();
  expect(feedbackCalls).toBe(2);
});

test('cancels a delayed Feedback request without changing the document', async ({ page }) => {
  let releaseFeedback: (() => void) | null = null;
  const delayed = new Promise<void>((resolve) => { releaseFeedback = resolve; });
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }));
  await page.route('**/api/ai/feedback', async (route) => {
    await delayed;
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ overallSummary: 'Late result.', strengths: [{ title: 'One strength', detail: 'A specific strength.' }], priorityImprovements: [{ rank: 1, category: 'clarity', title: 'One fix', detail: 'A specific fix.', recommendation: 'Make the change.' }], areas: [{ category: 'clarity', assessment: 'Clear enough.' }] }) }); } catch { /* the browser cancelled the request */ }
  });
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  const editor = page.locator('.tiptap-content');
  await editor.fill('Keep this text unchanged.');
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Get Feedback', exact: true }).click();
  await expect(page.getByText('Generating Feedback…')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Get Feedback', exact: true })).toBeVisible();
  await expect(editor).toContainText('Keep this text unchanged.');
  releaseFeedback?.();
  await expect(page.getByText('Late result.')).not.toBeVisible();
});

test('persists the selected English dialect in Settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('English dialect').selectOption('british');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByLabel('English dialect')).toHaveValue('british');
});

test('reviews a mocked rewrite, accepts it through history, and supports custom instructions', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }));
  await page.route('**/api/ai/rewrite', async (route) => {
    const body = await route.request().postDataJSON() as { action: string; customInstruction?: string };
    expect(body.action).toBeTruthy();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alternatives: [{ id: 'mock-1', text: body.customInstruction ? 'A custom rewrite.' : 'A clearer rewrite.', rationale: 'Mocked candidate.' }, { id: 'mock-2', text: 'Another rewrite.', rationale: null }] }) });
  });
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  const editor = page.locator('.tiptap-content');
  await editor.fill('A difficult sentence for review.');
  await editor.press('ControlOrMeta+a');
  const toolbar = page.getByRole('toolbar', { name: 'AI writing actions' });
  await toolbar.getByRole('button', { name: 'Simplify' }).click();
  const review = page.getByRole('dialog', { name: 'Review the change' });
  await expect(review).toBeVisible();
  await expect(review.getByText('A clearer rewrite.')).toBeVisible();
  await expect(editor).toContainText('A difficult sentence for review.');
  await review.getByRole('button', { name: 'Next' }).click();
  await expect(review.getByText('Another rewrite.')).toBeVisible();
  await review.getByRole('button', { name: 'Use Suggestion' }).click();
  await expect(editor).toContainText('Another rewrite.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(editor).toContainText('A difficult sentence for review.');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(editor).toContainText('Another rewrite.');

  await editor.press('ControlOrMeta+a');
  await toolbar.getByRole('button', { name: 'More' }).click();
  await toolbar.getByRole('button', { name: 'Ask AI to change this…' }).click();
  const custom = page.getByLabel('Ask AI to change this');
  await expect(custom).toBeVisible();
  await custom.fill('make it warmer');
  await review.getByRole('button', { name: 'Generate' }).click();
  await expect(review.getByText('A custom rewrite.')).toBeVisible();
});

test('previews and replaces complete blocks with mocked Make Skimmable output', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }));
  await page.route('**/api/ai/skimmable', async (route) => {
    const body = await route.request().postDataJSON() as { source: { text: string }; dialect: string };
    expect(body.source.text).toContain('First dense paragraph.');
    expect(body.dialect).toBeTruthy();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fragment: [
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Key idea' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'A clearer structure.' }] },
      { type: 'bulletList', items: [{ content: [{ type: 'text', text: 'First point' }] }, { content: [{ type: 'text', text: 'Second point' }] }] },
    ] }) });
  });
  await page.goto('/');
  await resetDocuments(page);
  await page.reload();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  const editor = page.locator('.tiptap-content');
  await editor.fill('First dense paragraph.');
  await editor.press('End');
  await editor.press('Enter');
  await editor.pressSequentially('Second dense paragraph.');
  await editor.press('ControlOrMeta+a');
  const toolbar = page.getByRole('toolbar', { name: 'AI writing actions' });
  await expect(toolbar.getByRole('button', { name: 'Make Skimmable' })).toBeVisible();
  await toolbar.getByRole('button', { name: 'Make Skimmable' }).click();
  const review = page.getByRole('dialog', { name: 'Review the structure' });
  await expect(review).toBeVisible();
  await expect(review.getByText('First dense paragraph.')).toBeVisible();
  await expect(review.getByText('Key idea')).toBeVisible();
  await review.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toContainText('First dense paragraph.');
  await toolbar.getByRole('button', { name: 'Make Skimmable' }).click();
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Replace 2 blocks' }).click();
  await expect(editor).toContainText('Key idea');
  await expect(editor.locator('ul')).toContainText('First point');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(editor).toContainText('First dense paragraph.');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(editor).toContainText('Key idea');
});
