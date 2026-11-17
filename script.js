'use strict';

const STORAGE_KEY = 'my-tasks-v1';
const MAX_TASK_LENGTH = 120;
const MAX_TASKS = 500;

const form = document.querySelector('#task-form');
const input = document.querySelector('#task-input');
const list = document.querySelector('#task-list');
const taskStatus = document.querySelector('#task-status');
const inputError = document.querySelector('#input-error');
const emptyState = document.querySelector('#empty-state');
const emptyTitle = document.querySelector('#empty-title');
const emptyCopy = document.querySelector('#empty-copy');
const clearCompleted = document.querySelector('#clear-completed');
const undoToast = document.querySelector('#undo-toast');
const undoButton = document.querySelector('#undo-delete');
const undoMessage = document.querySelector('#undo-message');
const storageStatus = document.querySelector('#storage-status');
const progressPanel = document.querySelector('#progress-panel');
const progressLabel = document.querySelector('#progress-label');
const progressTrack = document.querySelector('#progress-track');
const progressFill = document.querySelector('#progress-fill');
const filters = document.querySelectorAll('.filter');
const counts = {
  all: document.querySelector('#all-count'),
  active: document.querySelector('#active-count'),
  completed: document.querySelector('#completed-count'),
};

const privacyNote = document.querySelector('.privacy-note');
const drafts = new Map();
input.maxLength = MAX_TASK_LENGTH;

function updateStorageStatus(message, available) {
  storageStatus.textContent = message;
  storageStatus.dataset.state = available ? 'saved' : 'error';
  privacyNote.dataset.state = available ? 'saved' : 'error';
  privacyNote.textContent = available
    ? 'Задачи не теряются после обновления страницы.'
    : 'Сохранение недоступно. Не закрывайте страницу: изменения могут потеряться.';
}

let tasks = loadTasks();
let currentFilter = 'all';
let lastDeleted = null;
let undoTimer = null;

function createId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Match HTML maxlength (UTF-16 units), without leaving a trailing half-emoji.
function normalizeText(value) {
  const text = value.trim().slice(0, MAX_TASK_LENGTH);
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(saved)) throw new Error('Invalid storage format');

    const result = [];
    const seenIds = new Set();
    for (const value of saved) {
      if (result.length >= MAX_TASKS) break;
      if (!value || typeof value.text !== 'string') continue;
      const text = normalizeText(value.text);
      if (!text) continue;
      let id = typeof value.id === 'string' && value.id.trim() && value.id.length <= 100
        ? value.id : '';
      // Repair malformed or duplicate identifiers without dropping valid tasks.
      while (!id || seenIds.has(id)) id = createId();
      seenIds.add(id);
      result.push({ id, text, completed: value.completed === true });
    }
    updateStorageStatus('Хранение в этом браузере', true);
    return result;
  } catch {
    updateStorageStatus('Не удалось загрузить данные', false);
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    updateStorageStatus('Сохранено в этом браузере', true);
  } catch {
    updateStorageStatus('Не сохранено — изменения могут исчезнуть после обновления', false);
  }
}

function visibleTasks() {
  return tasks.filter((task) => currentFilter === 'all'
    || (currentFilter === 'completed' ? task.completed : !task.completed));
}

function createTaskElement(task) {
  const item = document.createElement('li');
  item.className = `task-item${task.completed ? ' is-complete' : ''}`;

  const checkButton = document.createElement('button');
  checkButton.className = 'check-button';
  checkButton.type = 'button';
  checkButton.setAttribute('aria-label', `${task.completed ? 'Вернуть в работу' : 'Отметить выполненной'}: ${task.text}`);
  checkButton.setAttribute('aria-pressed', String(task.completed));
  checkButton.dataset.action = 'toggle';
  checkButton.dataset.id = task.id;
  const check = document.createElement('span');
  check.className = 'check-mark';
  check.setAttribute('aria-hidden', 'true');
  check.textContent = task.completed ? '✓' : '';
  checkButton.append(check);

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text;

  const deleteButton = document.createElement('button');
  deleteButton.className = 'delete-button';
  deleteButton.type = 'button';
  deleteButton.setAttribute('aria-label', `Удалить задачу: ${task.text}`);
  deleteButton.dataset.action = 'delete';
  deleteButton.dataset.id = task.id;
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '×';
  deleteButton.append(icon);

  const editButton = document.createElement('button');
  editButton.className = 'edit-button';
  editButton.type = 'button';
  editButton.setAttribute('aria-label', `Редактировать задачу: ${task.text}`);
  editButton.dataset.action = 'edit';
  editButton.dataset.id = task.id;
  editButton.textContent = '✎';

  if (drafts.has(task.id)) {
    item.append(createEditor(task));
  } else {
    item.append(checkButton, text, editButton, deleteButton);
  }
  return item;
}

function createEditor(task) {
  const editForm = document.createElement('form');
  editForm.className = 'edit-form';
  editForm.dataset.id = task.id;
  const editInput = document.createElement('input');
  editInput.className = 'edit-input';
  editInput.value = drafts.get(task.id);
  editInput.maxLength = MAX_TASK_LENGTH;
  editInput.setAttribute('aria-label', 'Изменить название задачи');
  const save = document.createElement('button');
  save.type = 'submit'; save.className = 'save-edit-button'; save.textContent = 'Сохранить';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'cancel-edit-button';
  cancel.dataset.action = 'cancel-edit'; cancel.dataset.id = task.id; cancel.textContent = 'Отмена';
  editForm.append(editInput, save, cancel);
  return editForm;
}

function render() {
  const activeEditor = document.activeElement?.matches?.('.edit-input')
    ? document.activeElement : null;
  const editingId = activeEditor?.closest('.edit-form')?.dataset.id;
  const selection = activeEditor ? [activeEditor.selectionStart, activeEditor.selectionEnd] : null;
  const visible = visibleTasks();
  const fragment = document.createDocumentFragment();
  visible.forEach((task) => fragment.append(createTaskElement(task)));
  list.replaceChildren(fragment);
  if (editingId) {
    const editor = [...list.querySelectorAll('.edit-form')]
      .find((candidate) => candidate.dataset.id === editingId)?.querySelector('.edit-input');
    if (editor) {
      editor.focus();
      editor.setSelectionRange(...selection);
    } else input.focus();
  }

  const completed = tasks.filter((task) => task.completed).length;
  counts.all.textContent = tasks.length;
  counts.active.textContent = tasks.length - completed;
  counts.completed.textContent = completed;
  clearCompleted.disabled = completed === 0;
  const percent = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  if (progressLabel) progressLabel.textContent = `${completed} из ${tasks.length} · ${percent}%`;
  if (progressPanel) progressPanel.hidden = tasks.length === 0;
  progressTrack?.setAttribute('aria-valuemax', '100');
  progressTrack?.setAttribute('aria-valuenow', String(percent));
  progressTrack?.setAttribute('aria-valuetext', `${completed} из ${tasks.length} задач выполнено, ${percent}%`);
  if (progressFill?.style) progressFill.style.width = `${percent}%`;
  emptyState.hidden = visible.length > 0;
  list.hidden = visible.length === 0;

  if (!tasks.length) {
    emptyTitle.textContent = 'Начните с одной задачи';
    emptyCopy.textContent = 'Запишите её в поле выше и нажмите «Добавить».';
  } else if (currentFilter === 'completed') {
    emptyTitle.textContent = 'Пока ничего не выполнено';
    emptyCopy.textContent = 'Отмечайте задачи кнопкой слева от названия.';
  } else {
    emptyTitle.textContent = 'Всё выполнено';
    emptyCopy.textContent = 'Активных задач нет. Новую можно добавить выше.';
  }
}

function setInputError(message = '') {
  inputError.textContent = message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = normalizeText(input.value);
  if (!text || tasks.length >= MAX_TASKS) {
    setInputError(!text ? 'Введите название задачи.' : `Лимит — ${MAX_TASKS} задач. Удалите ненужные, чтобы добавить новую.`);
    input.focus();
    return;
  }
  setInputError();
  tasks.unshift({ id: createId(), text, completed: false });
  // A newly added active task should not disappear behind the completed filter.
  if (currentFilter === 'completed') setFilter('all');
  saveTasks();
  render();
  input.value = '';
  input.focus();
  taskStatus.textContent = `Добавлено: ${text}`;
});

input.addEventListener('input', () => setInputError());

list.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !(event.target instanceof Element)
    || !event.target.matches('.edit-input')) return;
  const taskId = event.target.closest('.edit-form')?.dataset.id;
  drafts.delete(taskId);
  render();
  const editButton = [...list.querySelectorAll('[data-action="edit"]')]
    .find((button) => button.dataset.id === taskId);
  (editButton || input).focus();
});

list.addEventListener('input', (event) => {
  if (event.target instanceof Element && event.target.matches('.edit-input')) {
    event.target.setCustomValidity('');
    drafts.set(event.target.closest('.edit-form').dataset.id, event.target.value);
  }
});

list.addEventListener('submit', (event) => {
  const editForm = event.target.closest('.edit-form');
  if (!editForm) return;
  event.preventDefault();
  const task = tasks.find((candidate) => candidate.id === editForm.dataset.id);
  const input = editForm.querySelector('.edit-input');
  const text = normalizeText(input.value);
  if (!task) return;
  if (!text) { input.setCustomValidity('Введите название задачи.'); input.reportValidity(); return; }
  task.text = text;
  drafts.delete(task.id);
  saveTasks();
  render();
  const editButton = [...list.querySelectorAll('[data-action="edit"]')]
    .find((button) => button.dataset.id === task.id);
  (editButton || input).focus();
  taskStatus.textContent = `Обновлено: ${text}`;
});

list.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button[data-action]');
  if (!button || !list.contains(button)) return;
  const { action, id } = button.dataset;
  const index = visibleTasks().findIndex((task) => task.id === id);
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) return;

  if (action === 'edit') {
    const item = button.closest('.task-item');
    drafts.set(id, task.text);
    const editForm = createEditor(task);
    item.replaceChildren(editForm);
    const editInput = editForm.querySelector('.edit-input');
    editInput.focus(); editInput.select();
    return;
  }
  if (action === 'cancel-edit') {
    drafts.delete(id);
    render();
    const editButton = [...list.querySelectorAll('[data-action="edit"]')]
      .find((candidate) => candidate.dataset.id === id);
    (editButton || input).focus();
    return;
  }
  if (action === 'toggle') {
    task.completed = !task.completed;
  } else if (action === 'delete') {
    const originalIndex = tasks.indexOf(task);
    tasks = tasks.filter((candidate) => candidate.id !== id);
    if (lastDeleted) drafts.delete(lastDeleted.task.id);
    lastDeleted = {
      task, index: originalIndex,
      previousId: tasks[originalIndex - 1]?.id,
      nextId: tasks[originalIndex]?.id,
    };
    if (undoMessage) undoMessage.textContent = `Удалена задача: ${task.text}`;
    if (undoToast) undoToast.hidden = false;
    scheduleUndoExpiry();
  } else return;

  saveTasks();
  render();
  const buttons = [...list.querySelectorAll('[data-action="toggle"]')];
  const same = buttons.find((candidate) => candidate.dataset.id === id);
  (same || buttons[Math.min(index, buttons.length - 1)] || input).focus();
  taskStatus.textContent = action === 'delete'
    ? `Удалено: ${task.text}`
    : `${task.completed ? 'Выполнено' : 'Возвращено в работу'}: ${task.text}`;
});

function pauseUndoExpiry() {
  if (undoTimer !== null) window.clearTimeout?.(undoTimer);
  undoTimer = null;
}

function scheduleUndoExpiry() {
  pauseUndoExpiry();
  if (!lastDeleted || undoToast?.matches?.(':hover, :focus-within')) return;
  undoTimer = window.setTimeout?.(() => {
    undoTimer = null;
    if (undoToast?.matches?.(':hover, :focus-within')) return;
    if (lastDeleted) drafts.delete(lastDeleted.task.id);
    lastDeleted = null;
    if (undoToast) undoToast.hidden = true;
  }, 5000) ?? null;
}

undoToast?.addEventListener('pointerenter', pauseUndoExpiry);
undoToast?.addEventListener('focusin', pauseUndoExpiry);
undoToast?.addEventListener('pointerleave', scheduleUndoExpiry);
undoToast?.addEventListener('focusout', () => queueMicrotask(scheduleUndoExpiry));

undoButton?.addEventListener('click', () => {
  if (!lastDeleted) return;
  if (tasks.length >= MAX_TASKS) {
    undoMessage.textContent = `Лимит — ${MAX_TASKS} задач. Освободите место через «Удалить готовые» и повторите отмену.`;
    scheduleUndoExpiry();
    return;
  }
  pauseUndoExpiry();
  const { task, index, previousId, nextId } = lastDeleted;
  const nextIndex = tasks.findIndex((candidate) => candidate.id === nextId);
  const previousIndex = tasks.findIndex((candidate) => candidate.id === previousId);
  const restoreIndex = nextIndex >= 0 ? nextIndex
    : previousIndex >= 0 ? previousIndex + 1 : Math.min(index, tasks.length);
  tasks.splice(restoreIndex, 0, task);
  lastDeleted = null;
  undoTimer = null;
  if (undoToast) undoToast.hidden = true;
  saveTasks();
  render();
  const restored = [...list.querySelectorAll('[data-action="toggle"]')]
    .find((button) => button.dataset.id === task.id);
  (restored || input).focus();
  taskStatus.textContent = `Восстановлено: ${task.text}`;
});

function setFilter(value) {
  currentFilter = value;
  filters.forEach((filter) => {
    const selected = filter.dataset.filter === value;
    filter.classList.toggle('is-active', selected);
    filter.setAttribute('aria-pressed', String(selected));
  });
}

filters.forEach((filter) => filter.addEventListener('click', () => {
  setFilter(filter.dataset.filter);
  render();
  taskStatus.textContent = `Показано задач: ${visibleTasks().length}`;
}));

clearCompleted.addEventListener('click', () => {
  if (!tasks.some((task) => task.completed)) return;
  if (!window.confirm('Удалить все выполненные задачи? Это действие нельзя отменить.')) return;
  for (const task of tasks) {
    if (task.completed) drafts.delete(task.id);
  }
  tasks = tasks.filter((task) => !task.completed);
  saveTasks();
  render();
  input.focus();
  taskStatus.textContent = 'Выполненные задачи удалены.';
});

window.addEventListener?.('storage', (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  if (undoTimer !== null) window.clearTimeout?.(undoTimer);
  undoTimer = null;
  lastDeleted = null;
  const undoHadFocus = undoToast?.contains?.(document.activeElement);
  if (undoToast) undoToast.hidden = true;
  tasks = loadTasks();
  for (const id of drafts.keys()) {
    if (!tasks.some((task) => task.id === id)) drafts.delete(id);
  }
  render();
  if (undoHadFocus) input.focus();
  taskStatus.textContent = 'Список обновлён из другой вкладки.';
});

render();
