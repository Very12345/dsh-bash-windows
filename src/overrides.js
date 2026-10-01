import {withGitBashGuidance} from './guidance.js';
import * as bashTool from '@deepseek-ai/dsh-tool-bash';
import * as persistentBashTool from '@deepseek-ai/dsh-tool-bash-persistent';
import TerminalService from '@deepseek-ai/dsh-terminal';
import * as terminalBackend from '@deepseek-ai/dsh-terminal-bash';
import { GitBashExecutor } from './executor.js';
import { resolveGitBashPath } from './bash.js';
import { scopeOf } from '@deepseek-ai/dsh-scope';

export const SUPPORTED_PRESETS = new Set(['standard', 'ptc', 'code', 'minimal', 'cordis']);

/** An agent-owned overlay: only inherited pwsh is masked; its other tools survive. */
export async function createShellOverride(agent, preset, options = {}) {
  const tools = agent.ctx.get('tools');
  const record = { agent, preset, enabled: false, definition: null, registration: null, restriction: null, group: null, children: [] };
  const expose = () => {
    record.registration?.();
    record.registration = null;
    if (record.enabled && record.definition) record.registration = tools.register(record.definition);
  };
  const capture = {
    register(definition) {
      const advertised=withGitBashGuidance(definition);
      record.definition = advertised;
      expose();
      return () => { if (record.definition === advertised) { record.definition = null; expose(); } };
    }
  };
  record.group = agent.ctx.plugin({
    name: 'git-bash-agent-shell',
    apply(parent) {
      let ctx = parent.isolate('tools');
      record.children.push(ctx.plugin({ name: 'git-bash-tool-capture', apply(inner) { inner.provide('tools', capture); } }));
      if (preset === 'minimal') {
        ctx = ctx.isolate('terminals').isolate('sandboxPolicy');
        const originalPolicy = agent.ctx.get('sandboxPolicy');
        // Git Bash cannot start under the Windows ACL restricted token. The
        // setting explicitly opts into the same unconfined executor as normal Bash.
        record.children.push(ctx.plugin({ name: 'git-bash-terminal-policy', apply(inner) { inner.provide('sandboxPolicy', {
          defaultMode: 'danger-full-access',
          resolve: (request) => originalPolicy.resolve({ ...request, mode: 'danger-full-access' })
        }); } }));
        const terminals = ctx.plugin(TerminalService);
        record.children.push(terminals);
        record.children.push(ctx.plugin(terminalBackend, { shellPath: resolveGitBashPath(options), shellDialect: 'bash', shellArgs: ['--noprofile', '--norc', '-i'], timeoutMs: 30000 }));
        record.children.push(ctx.plugin(persistentBashTool, { timeoutMs: 300000 }));
      } else {
        ctx = ctx.isolate('shell');
        const executor = ctx.plugin(GitBashExecutor, options);
        record.children.push(executor, ctx.plugin(bashTool));
      }
    }
  });
  try {
    await record.group.await();
    await Promise.all(record.children.map(child => child.await()));
    if (!record.definition) throw new Error('Git Bash tool did not activate: ' + record.children.filter(child => child.state !== 2).map(child => child.name).join(', '));
  }
  catch (error) { await record.group.dispose(); throw error; }
  record.setEnabled = (enabled) => {
    if (record.enabled === enabled) return;
    if (enabled) {
      record.restriction = tools.restrict({ deny: ['pwsh'] });
      record.enabled = true;
      try { expose(); } catch (error) { record.enabled = false; record.restriction(); record.restriction = null; throw error; }
    } else {
      record.enabled = false;
      expose();
      record.restriction?.();
      record.restriction = null;
    }
  };
  const scope = scopeOf(agent.ctx);
  const stopPrompt = agent.ctx.on('system-prompt/assemble', (assembly, context) => {
    if (context.scope !== scope) return assembly;
    const hidden = record.enabled ? 'tool:pwsh' : 'tool:bash';
    return { ...assembly, sections: assembly.sections.filter(section => section.name !== hidden) };
  });
  record.dispose = async () => { record.setEnabled(false); stopPrompt(); await record.group.dispose(); };
  return record;
}
