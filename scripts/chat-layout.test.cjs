const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');

test('short inverted chats fill the viewport and align to the visual top, below the fixed header', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/chat/[id].tsx'), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  let list;
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ObjectProperty' && node.key?.name === 'list' && node.value?.type === 'ObjectExpression') list = node.value;
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  };
  walk(ast);
  assert.ok(list);
  const style = vm.runInNewContext('(' + source.slice(list.start, list.end) + ')', { spacing: { lg: 24, md: 16 }, HEADER_EXPANDED_HEIGHT: 112 });
  assert.equal(style.flexGrow, 1);
  assert.equal(style.justifyContent, 'flex-end'); // Inverted Y axis: visual top.
  assert.equal(style.paddingBottom, 128); // Inverted bottom inset clears the header.
  assert.match(source, /data=\{\[\.\.\.displayRows\]\.reverse\(\)\} inverted/);
  assert.match(source, /projectChatMessages\(messages, running, stream\)/);
});
