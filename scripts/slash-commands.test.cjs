const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/slash-commands.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: api });

test('only a leading slash token opens suggestions', () => {
  for (const text of ['/', '/help', '/plugin:run']) assert.equal(api.isSlashQuery(text), true);
  for (const text of ['hello /help', '/help argument', '/help\n', 'https://example.test', '']) assert.equal(api.isSlashQuery(text), false);
});
test('selection preserves existing arguments and drafts', () => {
  assert.equal(api.insertCommand('/he', 'help'), '/help ');
  assert.equal(api.insertCommand('/old my file', 'new'), '/new my file');
  assert.equal(api.insertCommand('检查这个文件\n保留换行', 'review'), '/review 检查这个文件\n保留换行');
});
test('catalog normalization rejects malformed entries and duplicates', () => {
  const commands = api.parseCommands([null, {}, { name: '/help', description: '帮助' }, { name: 'help' }, { name: 'bad name' }, { name: 'review', inputHint: '/review <path>' }]);
  assert.equal(commands.length, 2); assert.equal(commands[0].name, 'help');
  assert.equal(commands[1].inputHint, '/review <path>');
  assert.equal(api.parseCommands({}).length, 0);
});
