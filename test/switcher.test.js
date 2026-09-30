import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

async function peers(t) {
  if (process.platform !== 'win32') { t.skip('Git Bash integration requires Windows'); return null; }
  try {
    const cordis = await import('@deepseek-ai/cordis');
    const scope = await import('@deepseek-ai/dsh-scope');
    const tools = await import('@deepseek-ai/dsh-tools');
    const subprocess = await import('@deepseek-ai/dsh-subprocess-local');
    const env = await import('@deepseek-ai/dsh-shell-env');
    const self = await import('../src/overrides.js');
    const prompt = await import('@deepseek-ai/dsh-system-prompt');
    return { cordis, scope, tools, subprocess, env, self, prompt };
  } catch (error) { t.skip('DSH peers unavailable: ' + error.message); return null; }
}

test('all four built-in modes swap only pwsh and restore it when disabled', async (t) => {
  const modules = await peers(t); if (!modules) return;
  const { cordis, scope, tools, subprocess, env, self, prompt } = modules;
  const root = new cordis.Context();
  root.provide('ptcRuntime', { language: 'python' });
  const agents = new Map();
  root.provide('agents', { get: (id) => agents.get(id) });
  const systemPrompt = root.plugin(prompt.default ?? prompt.SystemPrompt);
  await systemPrompt.await();
  root.provide('sandboxPolicy', { defaultMode: 'danger-full-access', resolve: () => ({ mode: 'danger-full-access', workspaceRoot: process.cwd() }) });
  root.provide('sessionProjections', { register: () => () => {}, stateOf: () => undefined });
  const runtime = root.plugin(tools.ToolRuntime ?? tools.default);
  const substrate = root.plugin(subprocess.default ?? subprocess.LocalSubprocessRuntime);
  const shellEnv = root.plugin(env);
  await Promise.all([runtime, substrate, shellEnv]);
  const scopes = [], records = [];
  t.after(async () => { for (const record of records) await record.dispose(); for (const item of scopes.reverse()) await item.dispose(); await shellEnv.dispose(); await substrate.dispose(); await runtime.dispose(); await systemPrompt.dispose(); });
  for (const preset of ['standard', 'ptc', 'minimal', 'cordis']) {
    const baseKey = {}, agent = { id: preset };
    const base = scope.createScope(root, baseKey), own = scope.createScope(root, agent);
    scopes.push(base, own);
    scope.bindScopeParent(agent, baseKey);
    const native = tools.defineTool({ name: 'pwsh', description: 'Original PowerShell', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'pwsh' });
    base.ctx.get('tools').register(native);
    if (preset === 'ptc') base.ctx.get('tools').presentAs('ptc');
    if (preset !== 'minimal') base.ctx.get('tools').register(tools.defineTool({ name: 'read_file', description: 'Read', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'read' }));
    const session = { id: preset, header: { cwd: process.cwd() }, append() {} };
    Object.assign(agent, { ctx: own.ctx, session });
    agents.set(preset, agent);
    const record = await self.createShellOverride(agent, preset);
    records.push(record);
    const before = root.get('tools').schemas(agent).map((s) => s.name).sort();
    record.setEnabled(true);
    const after = root.get('tools').schemas(agent).map((s) => s.name).sort();
    assert.deepEqual(after, before.map((name) => name === 'pwsh' ? 'bash' : name).sort(), preset);
    assert.equal(root.get('tools').get('pwsh', agent), undefined);
    const bash = root.get('tools').get('bash', agent);
    assert.ok(bash);
    if (preset === 'ptc') {
      assert.deepEqual(root.get('tools').wireSchemas(agent).schemas.map((s) => s.name), ['run_code']);
      assert.ok(root.get('tools').sdkSchemas(agent).some((s) => s.name === 'bash'));
      assert.ok(!root.get('tools').sdkSchemas(agent).some((s) => s.name === 'pwsh'));
    }
    const exec = { agent, signal: new AbortController().signal, cwd: process.cwd(), callId: 'test-call' };
    const result = await bash.execute({ command: 'printf git_bash_switch_ok', description: 'Verify the selected shell' }, exec);
    assert.match(typeof result === 'string' ? result : JSON.stringify(result), /git_bash_switch_ok/, preset + ' execution');
    if (preset === 'minimal') {
      await bash.execute({ command: 'export DSH_TEST_PERSIST=retained' }, exec);
      const retained = await bash.execute({ command: 'printf "$DSH_TEST_PERSIST"' }, exec);
      assert.match(retained, /retained/, 'minimal keeps its shell state');
    }
    record.setEnabled(false);
    assert.deepEqual(root.get('tools').schemas(agent).map((s) => s.name).sort(), before, preset + ' restore');
    assert.equal(root.get('tools').get('pwsh', agent), native);
  }
});

test('the setting route persists the switch through DSH and can turn it back off', async (t) => {
  const modules = await peers(t); if (!modules) return;
  const { GitBashSwitcher } = await import('../src/switcher.js');
  const ctx = new modules.cordis.Context();
  const routes = new Map(), writes = [];
  let enabled = false;
  let controller;
  ctx.provide('agents', { list: () => [] });
  ctx.provide('agentPresets', { composedPreset: () => 'standard' });
  ctx.provide('settings', {
    configure: () => () => {},
    async update(namespace, values) { writes.push({ namespace, values }); enabled = values.enabled; }
  });
  ctx.provide('webServer', { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } });
  controller = new GitBashSwitcher(ctx, { enabled: { get: () => enabled } });
  await controller.pending;
  t.after(async () => { controller.closed = true; await controller.pending; });
  const route = routes.get('/plugins/git-bash-windows');
  assert.ok(route);
  async function toggle(enabled) {
    const req = Readable.from([JSON.stringify({ enabled })]); req.method = 'POST';
    let status, body;
    await route.handler(req, { writeHead: (value) => { status = value; }, end: (value) => { body = JSON.parse(value); } });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.enabled, enabled);
  }
  await toggle(true); await toggle(false);
  assert.deepEqual(writes.map((entry) => [entry.namespace, entry.values.enabled]), [['git-bash-windows', true], ['git-bash-windows', false]]);
});
