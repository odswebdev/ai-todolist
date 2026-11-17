const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

async function addTask(page, value) {
  await page.getByRole('textbox', { name: 'Название новой задачи' }).fill(value);
  await page.getByRole('button', { name: /Добавить/ }).click();
}

test('add, complete, filter, progress and persistence survive reload', async ({ page }) => {
  await addTask(page, 'Подготовить портфолио');
  await addTask(page, 'Отправить тестовое');
  await expect(page.getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Отметить выполненной: Подготовить портфолио' }).click();
  await expect(page.locator('#progress-label')).toHaveText('1 из 2 · 50%');
  await page.getByRole('button', { name: /Готово/ }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('Подготовить портфолио')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Вернуть в работу: Подготовить портфолио' }))
    .toHaveAttribute('aria-pressed', 'true');
});

test('edit validates empty text, supports Escape and saves updates', async ({ page }) => {
  await addTask(page, 'Черновик');
  await page.getByRole('button', { name: 'Редактировать задачу: Черновик' }).click();
  const editor = page.getByRole('textbox', { name: 'Изменить название задачи' });
  await editor.fill('');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(editor).toHaveJSProperty('validationMessage', 'Введите название задачи.');

  await editor.fill('Обновлённая задача');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Обновлённая задача', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Редактировать задачу: Обновлённая задача' }).click();
  await page.getByRole('textbox', { name: 'Изменить название задачи' }).fill('Не сохранять');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Обновлённая задача', { exact: true })).toBeVisible();
  await expect(page.getByText('Не сохранять')).toHaveCount(0);
});

test('delete can be undone and restore retains order', async ({ page }) => {
  await addTask(page, 'Первый');
  await addTask(page, 'Второй');
  await page.getByRole('button', { name: 'Удалить задачу: Первый' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Удалена задача: Первый' })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('listitem').nth(1)).toContainText('Первый');
});

test('completed tasks can be removed after confirmation', async ({ page }) => {
  await addTask(page, 'Готовое дело');
  await page.getByRole('button', { name: 'Отметить выполненной: Готовое дело' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Удалить готовые' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.locator('#progress-panel')).toBeHidden();
});

test('another tab receives changes from localStorage', async ({ page, context }) => {
  const secondTab = await context.newPage();
  await secondTab.goto('/');
  await addTask(page, 'Общая задача');
  await expect(secondTab.getByText('Общая задача')).toBeVisible();
  await secondTab.close();
});

test('keyboard interaction and mobile width do not cause horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const input = page.getByRole('textbox', { name: 'Название новой задачи' });
  await input.fill('Проверка с клавиатуры');
  await input.press('Enter');
  await expect(page.getByText('Проверка с клавиатуры', { exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
});

test('keyboard focus order and accessible names are exposed', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Название новой задачи' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Добавить' })).toBeFocused();
  await addTask(page, 'Задача дерева доступности');
  const tree = await page.locator('body').ariaSnapshot();
  expect(tree).toContain('heading "Планы на день" [level=1]');
  expect(tree).toContain('group "Показать задачи"');
  expect(tree).toContain('progressbar "Выполненные задачи"');
});

test('empty input gives an accessible validation message', async ({ page }) => {
  await page.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByRole('alert')).toHaveText('Введите название задачи.');
  await expect(page.getByRole('textbox', { name: 'Название новой задачи' }))
    .toHaveAttribute('aria-invalid', 'true');
});

test('axe reports no WCAG 2.2 A/AA accessibility violations', async ({ page }) => {
  await addTask(page, 'Задача для проверки доступности');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test('500-task delete replacement undo stays bounded and restores after reload', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => localStorage.setItem('my-tasks-v1', JSON.stringify(
    Array.from({ length: 500 }, (_, i) => ({ id: `seed-${i}`, text: `Seed ${i}`, completed: false })),
  )));
  await page.reload();
  await page.getByRole('button', { name: 'Удалить задачу: Seed 0' }).click();
  await addTask(page, 'Replacement');
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.getByText(/Лимит — 500 задач/)).toBeVisible();
  await expect(page.locator('#undo-toast')).not.toBeHidden();
  await page.getByRole('button', { name: 'Отметить выполненной: Replacement' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Удалить готовые' }).click();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(500);
  await expect(page.getByText('Seed 0', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(500);
  await expect(page.getByText('Seed 0', { exact: true })).toBeVisible();
});

test('undo restores deleted middle task relative to replacement order', async ({ page }) => {
  await addTask(page, 'A'); await addTask(page, 'B'); await addTask(page, 'C');
  await page.getByRole('button', { name: 'Удалить задачу: B' }).click();
  await addTask(page, 'X');
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.locator('.task-text')).toHaveText(['X', 'C', 'B', 'A']);
});

test('multiple edit drafts survive rerenders and cancel only its own draft', async ({ page }) => {
  await addTask(page, 'A'); await addTask(page, 'B'); await addTask(page, 'C');
  await page.getByRole('button', { name: 'Редактировать задачу: A' }).click();
  await page.getByRole('textbox', { name: 'Изменить название задачи' }).fill('A draft');
  await page.getByRole('button', { name: 'Редактировать задачу: B' }).click();
  await page.getByRole('textbox', { name: 'Изменить название задачи' }).nth(0).fill('B draft');
  await page.getByRole('button', { name: 'Отметить выполненной: C' }).click();
  await page.getByRole('button', { name: 'В работе' }).click();
  await page.getByRole('button', { name: 'Все' }).click();
  await addTask(page, 'D');
  await expect(page.getByRole('textbox', { name: 'Изменить название задачи' }).nth(0)).toHaveValue('B draft');
  await expect(page.getByRole('textbox', { name: 'Изменить название задачи' }).nth(1)).toHaveValue('A draft');
  await page.getByRole('textbox', { name: 'Изменить название задачи' }).nth(0).press('Enter');
  await page.getByRole('textbox', { name: 'Изменить название задачи' }).nth(0).press('Escape');
  await expect(page.getByText('A', { exact: true })).toBeVisible();
  await expect(page.getByText('A draft')).toHaveCount(0);
  await expect(page.getByText('B draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать задачу: A' }).click();
  await page.getByRole('textbox', { name: 'Изменить название задачи' }).fill('Cancel by button');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByText('A', { exact: true })).toBeVisible();
  await expect(page.locator('.edit-input')).toHaveCount(0);
});

test('undo expiry pauses on focus and hover then resumes after exit', async ({ page }) => {
  await page.clock.install();
  await addTask(page, 'Expiring');
  await page.getByRole('button', { name: 'Удалить задачу: Expiring' }).click();
  await page.clock.fastForward(5001);
  await expect(page.locator('#undo-toast')).toBeHidden();
  await page.reload();
  await addTask(page, 'Focused');
  await page.getByRole('button', { name: 'Удалить задачу: Focused' }).click();
  const toast = page.locator('#undo-toast');
  await page.locator('#undo-delete').focus();
  await expect(page.locator('#undo-delete')).toBeFocused();
  await page.clock.fastForward(6000);
  await expect(toast).not.toBeHidden();
  await page.locator('#task-input').focus();
  await page.evaluate(() => Promise.resolve());
  await page.clock.fastForward(5001);
  await expect(toast).toBeHidden();
  await page.reload();
  await addTask(page, 'Hovered');
  await page.getByRole('button', { name: 'Удалить задачу: Hovered' }).click();
  await toast.hover();
  await page.clock.fastForward(6000);
  await expect(toast).not.toBeHidden();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(5001);
  await expect(toast).toBeHidden();
  await expect(page.locator('body')).not.toBeFocused();
});

test('blocked storage warns without persistence promise and recovers when restored', async ({ page }) => {
  await page.addInitScript(() => {
    window.__originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error('blocked'); };
  });
  await page.reload();
  await addTask(page, 'Blocked');
  await expect(page.locator('#storage-status')).toContainText('Не сохранено');
  await expect(page.locator('.privacy-note')).toContainText('изменения могут потеряться');
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
  await addTask(page, 'Saved');
  await expect(page.locator('#storage-status')).toContainText('Сохранено');
});

test('storage sync preserves draft for an existing task', async ({ page }) => {
  await addTask(page, 'Shared');
  await page.getByRole('button', { name: 'Редактировать задачу: Shared' }).click();
  await page.getByRole('textbox', { name: 'Изменить название задачи' }).fill('Draft shared');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('my-tasks-v1'));
    window.localStorage.setItem('my-tasks-v1', JSON.stringify(data));
    window.dispatchEvent(new StorageEvent('storage', { key: 'my-tasks-v1', newValue: JSON.stringify(data) }));
  });
  await expect(page.getByRole('textbox', { name: 'Изменить название задачи' })).toHaveValue('Draft shared');
  await expect(page.getByRole('textbox', { name: 'Изменить название задачи' })).toBeFocused();
});

test('storage update moves focus away from an invalidated undo notification', async ({ page }) => {
  await addTask(page, 'Deleted elsewhere');
  await page.getByRole('button', { name: 'Удалить задачу: Deleted elsewhere' }).click();
  await page.locator('#undo-delete').focus();
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'my-tasks-v1' })));
  await expect(page.locator('#undo-toast')).toBeHidden();
  await expect(page.locator('#task-input')).toBeFocused();
});

test('long task and editing fit narrow and wide viewports', async ({ page }) => {
  await addTask(page, 'Я'.repeat(120));
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: /Редактировать задачу:/ }).click();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  }
});
