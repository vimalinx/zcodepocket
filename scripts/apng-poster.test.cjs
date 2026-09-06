const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/../src/lib/apng-poster.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObject });
const { apngPoster } = exportsObject;
// Chunk routing fixtures: native decoding separately validates CRC and IDAT.
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, size = 0) { const b = Buffer.alloc(size + 12); b.writeUInt32BE(size); b.write(type, 4); return b; }
const core = [chunk('IHDR', 13), chunk('tRNS', 1), chunk('IDAT', 3), chunk('IEND')];
test('single-frame APNG is reduced to exactly the default PNG without altering pixels or retained CRC bytes', () => {
  const apng = Buffer.concat([signature, core[0], chunk('acTL', 8), chunk('fcTL', 26), ...core.slice(1)]);
  assert.deepEqual(Buffer.from(apngPoster(apng)), Buffer.concat([signature, ...core]));
});
test('animated frame chunks are excluded while default IDAT is retained', () => {
  const apng = Buffer.concat([signature, core[0], chunk('acTL', 8), core[1], core[2], chunk('fcTL', 26), chunk('fdAT', 30), core[3]]);
  assert.deepEqual(Buffer.from(apngPoster(apng)), Buffer.concat([signature, ...core]));
});
test('JPEG and static PNG are left to their existing decoder', () => {
  assert.equal(apngPoster(Buffer.from([255, 216, 255, 224])), null);
  assert.equal(apngPoster(Buffer.concat([signature, ...core])), null);
});
test('truncated or oversized chunks fail closed without an unbounded allocation', () => {
  const oversized = chunk('acTL'); oversized.writeUInt32BE(0xffffffff);
  for (const input of [Buffer.concat([signature, core[0], oversized]), Buffer.concat([signature, core[0], chunk('acTL', 8)]), Buffer.concat([signature, core[0], chunk('IDAT', 3)]).subarray(0, -1)]) assert.throws(() => apngPoster(input));
});
