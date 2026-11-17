const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Small DOM double for logic tests; these do not replace real browser tests.
function boot(saved = null, storageBlocked = false) {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.handlers = {}; this.style = {}; this.classList = { toggle() {} }; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    querySelectorAll() { return []; }
    contains() { return true; }
    focus() { this.focused = true; }
  }
  const nodes = new Map();
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  let stored = saved;
  const context = vm.createContext({
    Element, console,
    document: {
      querySelector: get, querySelectorAll: () => [],
      createElement: () => new Element(), createDocumentFragment: () => new Element(),
    },
    localStorage: {
      getItem() { if (storageBlocked) throw new Error('blocked'); return stored; },
      setItem(key, value) { if (storageBlocked) throw new Error('blocked'); stored = value; },
    },
    queueMicrotask,
    window: { confirm: () => true },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8'), context);
  return { run: (code) => vm.runInContext(code, context), get, stored: () => stored };
}

test('empty storage starts with no tasks', () => assert.equal(boot().run('tasks.length'), 0));

test('input length is configured from the shared limit', () => {
  const app = boot();
  assert.equal(app.get('#task-input').maxLength, app.run('MAX_TASK_LENGTH'));
});

test('storage failure removes the unconditional persistence promise', () => {
  const app = boot(null, true);
  assert.match(app.get('.privacy-note').textContent, /Сохранение недоступно/);
  app.run('saveTasks()');
  assert.doesNotMatch(app.get('.privacy-note').textContent, /не теряются/);
});

test('undo refuses overflow and remains retryable after space is freed', () => {
  const app = boot();
  app.run(`tasks = Array.from({length:500}, (_,i)=>({id:String(i),text:'task',completed:false}));
    lastDeleted = {task:{id:'deleted',text:'restore',completed:false},index:0};`);
  app.get('#undo-delete').handlers.click();
  assert.equal(app.run('tasks.length'), 500);
  assert.equal(app.run('lastDeleted.task.id'), 'deleted');
  assert.match(app.get('#undo-message').textContent, /Лимит/);
  app.run('tasks.pop()');
  app.get('#undo-delete').handlers.click();
  assert.equal(app.run('tasks.length'), 500);
  assert.equal(boot(app.stored()).run('tasks.some(t=>t.id === "deleted")'), true);
});

test('undo restores relative to surviving neighbours rather than stale index', () => {
  const app = boot();
  app.run(`tasks = ['X','A','C'].map(id=>({id,text:id,completed:false}));
    lastDeleted = {task:{id:'B',text:'B',completed:false},index:1,previousId:'A',nextId:'C'};`);
  app.get('#undo-delete').handlers.click();
  assert.equal(app.run('tasks.map(t=>t.id).join(",")'), 'X,A,B,C');
});

test('undo falls back to previous neighbour when next neighbour was removed', () => {
  const app = boot();
  app.run(`tasks = ['X','A'].map(id=>({id,text:id,completed:false}));
    lastDeleted = {task:{id:'B',text:'B',completed:false},index:0,previousId:'A',nextId:'C'};`);
  app.get('#undo-delete').handlers.click();
  assert.equal(app.run('tasks.map(t=>t.id).join(",")'), 'X,A,B');
});
test('undo uses a bounded fallback when both neighbours are gone', () => {
  const app = boot();
  app.run(`tasks = [{id:'X',text:'X',completed:false}];
    lastDeleted = {task:{id:'B',text:'B',completed:false},index:10,previousId:'A',nextId:'C'};`);
  app.get('#undo-delete').handlers.click();
  assert.equal(app.run('tasks.map(t=>t.id).join(",")'), 'X,B');
});

test('invalid JSON does not crash startup', () => assert.equal(boot('{oops').run('tasks.length'), 0));
test('non-array storage is rejected', () => assert.equal(boot('{}').run('tasks.length'), 0));
test('malformed records ignored and boolean is strict', () => {
  const app = boot(JSON.stringify([null, {}, { text: '  ' }, { text: ' task ', completed: 'true' }]));
  assert.equal(app.run('tasks.length'), 1);
  assert.equal(app.run('tasks[0].text'), 'task');
  assert.equal(app.run('tasks[0].completed'), false);
});
test('duplicate IDs repaired without discarding tasks', () => {
  const app = boot(JSON.stringify([{ id: 'x', text: 'a' }, { id: 'x', text: 'b' }]));
  assert.equal(app.run('tasks.length'), 2);
  assert.equal(app.run('new Set(tasks.map(t => t.id)).size'), 2);
});
test('loading caps records at 500', () => {
  const app = boot(JSON.stringify(Array.from({ length: 510 }, (_, i) => ({ id: String(i), text: 'task' }))));
  assert.equal(app.run('tasks.length'), 500);
});
test('empty input rejected and remains editable', () => {
  const app = boot(); app.get('#task-input').value = '   ';
  app.get('#task-form').handlers.submit({ preventDefault() {} });
  assert.equal(app.run('tasks.length'), 0);
  assert.equal(app.get('#task-input').attributes['aria-invalid'], 'true');
});
test('adding trims text, saves and survives reload', () => {
  const app = boot(); app.get('#task-input').value = '  купить хлеб  ';
  app.get('#task-form').handlers.submit({ preventDefault() {} });
  assert.equal(app.run('tasks[0].text'), 'купить хлеб');
  assert.equal(boot(app.stored()).run('tasks[0].text'), 'купить хлеб');
});
test('blocked storage remains usable and reports failure', () => {
  const app = boot(null, true); app.run("tasks.push({id:'1',text:'task',completed:false}); saveTasks()");
  assert.match(app.get('#storage-status').textContent, /Не сохранено/);
});
test('limit does not clear unsaved input', () => {
  const app = boot(); app.run("tasks = Array.from({length:500}, (_,i)=>({id:String(i),text:'x',completed:false}))");
  app.get('#task-input').value = 'keep me';
  app.get('#task-form').handlers.submit({ preventDefault() {} });
  assert.equal(app.get('#task-input').value, 'keep me');
  assert.equal(app.run('tasks.length'), 500);
});
test('filters return expected tasks', () => {
  const app = boot(); app.run("tasks=[{id:'1',text:'a',completed:false},{id:'2',text:'b',completed:true}]");
  assert.equal(app.run("setFilter('active'); visibleTasks()[0].text"), 'a');
  assert.equal(app.run("setFilter('completed'); visibleTasks()[0].text"), 'b');
});
test('HTML-looking text remains plain text', () => {
  const app = boot();
  assert.equal(app.run("createTaskElement({id:'x',text:'<img src=x onerror=alert(1)>',completed:false}).children[1].textContent"), '<img src=x onerror=alert(1)>');
});
test('UTF-16 truncation does not leave half an emoji', () => {
  assert.equal(boot().run("normalizeText('a'.repeat(119) + '😀').length"), 119);
});
test('deleting a task offers undo and restores the task in its original list', () => {
  const app = boot(JSON.stringify([{ id: 'restore-me', text: 'keep this', completed: false }]));
  app.run(`
    const listNode = document.querySelector('#task-list');
    const deleteAction = new Element();
    deleteAction.dataset = { action: 'delete', id: 'restore-me' };
    deleteAction.closest = () => deleteAction;
    listNode.handlers.click({ target: deleteAction });
  `);
  assert.equal(app.run('tasks.length'), 0);
  assert.equal(app.get('#undo-toast').hidden, false);
  app.get('#undo-delete').handlers.click();
  assert.equal(app.run('tasks.length'), 1);
  assert.equal(app.run('tasks[0].text'), 'keep this');
  assert.equal(app.get('#undo-toast').hidden, true);
});

test('progress uses a valid 0–100 range and updates on render', () => {
  const app = boot(JSON.stringify([
    { id: 'a', text: 'first', completed: true },
    { id: 'b', text: 'second', completed: false },
  ]));
  assert.equal(app.get('#progress-track').attributes['aria-valuemax'], '100');
  assert.equal(app.get('#progress-track').attributes['aria-valuenow'], '50');
  assert.equal(app.get('#progress-fill').style.width, '50%');
  assert.equal(app.get('#progress-label').textContent, '1 из 2 · 50%');
  assert.equal(app.get('#progress-panel').hidden, false);
  assert.equal(boot().get('#progress-panel').hidden, true);
});
