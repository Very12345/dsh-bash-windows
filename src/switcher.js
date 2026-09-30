import z from '@deepseek-ai/schemastery';
import { resolveGitBashPath } from './bash.js';
import { createShellOverride, SUPPORTED_PRESETS } from './overrides.js';

const valueOf = (value) => value?.get ? value.get() : value;
const ROUTE = '/plugins/git-bash-windows';

export class GitBashSwitcher {
  static inject = ['agents', 'agentPresets', 'settings'];
  static Config = z.object({ enabled: z.boolean().default(false).volatile(), bashPath: z.string(), loginShell: z.boolean().default(false) });
  constructor(ctx, config) {
    this.ctx = ctx; this.config = config; this.records = new Map(); this.creating = new Map(); this.pending = Promise.resolve(); this.closed = false; this.error = '';
    ctx.effect(() => ctx.settings.configure({ auto: false }));
    ctx.provide('gitBashSwitch', this);
    ctx.on('agent/created', ({ agent }) => this.synchronizeAgent(agent));
    ctx.on('agent/disposed', async ({ agent }) => { const record = this.records.get(agent); this.records.delete(agent); await record?.dispose(); });
    ctx.on('app-boot/config-reload', () => this.synchronize());
    ctx.on('settings/document-updated', (namespace) => { if (namespace === 'git-bash-windows') void this.synchronize().catch(error => { this.error = error.message; }); });
    ctx.on('agent-preset/selected', (id) => { const agent = ctx.agents.get(id); if (agent) void this.synchronizeAgent(agent).catch(error => { this.error = error.message; }); });
    ctx.inject(['webServer'], (webCtx) => this.routes(webCtx));
    ctx.effect(() => async () => { this.closed = true; await this.pending.catch(() => {}); await Promise.all([...this.records.values()].map((record) => record.dispose())); this.records.clear(); });
    void this.synchronize().catch((error) => { this.error = error.message; ctx.logger.warn(error); });
  }
  get enabled() { return valueOf(this.config.enabled) === true; }
  options() { return { bashPath: valueOf(this.config.bashPath), loginShell: valueOf(this.config.loginShell) === true }; }
  async synchronizeAgent(agent) {
    if (this.closed) return;
    const preset = this.ctx.agentPresets.composedPreset(agent.ctx);
    let record = this.records.get(agent);
    if (!SUPPORTED_PRESETS.has(preset)) { if (record) { this.records.delete(agent); await record.dispose(); } return; }
    if (record && record.preset !== preset) { this.records.delete(agent); await record.dispose(); record = null; }
    if (!record && this.enabled && agent.ctx.get('tools').get('pwsh', agent) === undefined) return;
    if (!record && this.enabled) {
      let creating = this.creating.get(agent);
      if (!creating) {
        creating = createShellOverride(agent, preset, this.options());
        this.creating.set(agent, creating);
        void creating.finally(() => this.creating.delete(agent)).catch(() => {});
      }
      record = await creating;
      if (this.closed) { await record.dispose(); return; }
      this.records.set(agent, record);
    }
    // Keep the execution world until agent disposal. Disabling only removes
    // its advertised tool, so a command already dispatched is not killed.
    record?.setEnabled(this.enabled);
  }
  synchronize() {
    const run = this.pending.catch(() => {}).then(async () => {
      if (this.closed) return;
      for (const agent of this.ctx.agents.list()) await this.synchronizeAgent(agent);
    });
    this.pending = run; return run;
  }
  status() { return { ok: true, enabled: this.enabled, supported: process.platform === 'win32', error: this.error }; }
  routes(ctx) {
    const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler: async (req, res) => {
      if (req.method === 'GET') return send(res, 200, this.status());
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('Request too large'); }
        const input = JSON.parse(body || '{}'); if (typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean');
        if (input.enabled) resolveGitBashPath(this.options());
        const previous = this.enabled;
        await this.ctx.settings.update('git-bash-windows', { enabled: input.enabled });
        try { await this.synchronize(); this.error = ''; }
        catch (error) { await this.ctx.settings.update('git-bash-windows', { enabled: previous }); await this.synchronize(); throw error; }
        send(res, 200, this.status());
      } catch (error) { this.error = error.message; send(res, 400, { ...this.status(), ok: false }); }
    } }));
  }
}

export default GitBashSwitcher;
