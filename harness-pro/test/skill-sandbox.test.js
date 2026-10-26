'use strict';
// Unit-Tests der Skill-VM (ohne Netz).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolRunner } = require('../lib/tool-runner');
const {
  validateManifest,
  loadSkillModule,
  writeSkillFiles,
  loadSkillFromDisk,
  skillDir,
} = require('../lib/skill-sandbox');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astra-skill-'));
}

test('validateManifest akzeptiert gueltiges Manifest und lehnt shell-Permission ab', () => {
  const ok = validateManifest({
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    entry: 'index.js',
    tools: [{ name: 'do_thing' }],
    permissions: ['workspace_read'],
  });
  assert.strictEqual(ok.id, 'demo');
  assert.throws(
    () =>
      validateManifest({
        id: 'bad',
        tools: [{ name: 'x' }],
        permissions: ['shell'],
      }),
    /Permission nicht erlaubt/,
  );
});

test('loadSkillModule: Tool laeuft in VM und schreibt nur ueber ctx', async () => {
  const ws = workspace();
  const runner = new ToolRunner(ws, { loadSkills: false });
  const manifest = validateManifest({
    id: 'local',
    tools: [{ name: 'greet' }],
    permissions: ['workspace_write'],
  });
  const source =
    'module.exports = { tools: { greet: function (args, ctx) {' +
    ' ctx.writeFile("hi.txt", "Hallo " + (args.name || ""));' +
    ' return { ok: true };' +
    '} } };';
  const tools = loadSkillModule(source, runner, manifest);
  const result = await tools.greet({ name: 'Doctor' });
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(fs.readFileSync(path.join(ws, 'hi.txt'), 'utf8'), 'Hallo Doctor');
});

test('Skill ohne require/process: require wirft zur Laufzeit in der VM', async () => {
  const ws = workspace();
  const runner = new ToolRunner(ws, { loadSkills: false });
  const manifest = validateManifest({
    id: 'evil',
    tools: [{ name: 'boom' }],
    permissions: ['workspace_read'],
  });
  const source =
    'module.exports = { tools: { boom: function () { return require("fs"); } } };';
  const tools = loadSkillModule(source, runner, manifest);
  await assert.rejects(tools.boom({}), /require is not defined|require/);
});

test('writeSkillFiles + loadSkillFromDisk + ToolRunner Registry', async () => {
  const ws = workspace();
  const runner = new ToolRunner(ws, { loadSkills: false });
  const manifest = validateManifest({
    id: 'disk-skill',
    name: 'Disk',
    version: '0.1.0',
    tools: [{ name: 'add_one' }],
    permissions: ['workspace_read'],
  });
  writeSkillFiles(skillDir(ws, 'disk-skill'), manifest, {
    'index.js':
      'module.exports = { tools: { add_one: function (args) { return { n: Number(args.n) + 1 }; } } };',
  });
  const loaded = loadSkillFromDisk(runner, skillDir(ws, 'disk-skill'));
  runner._registerSkill(loaded);
  const out = await runner.execute('add_one', { n: 41 });
  assert.deepStrictEqual(out, { n: 42 });
  const listed = runner.list_skills();
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].id, 'disk-skill');
});
