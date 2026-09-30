window.__ModuleLoader__.load({
  id: '@very12345/dsh-bash-windows',
  factory: (require) => {
    const R = require('react'), h = R.createElement;
    function apply(ctx) {
      function GitBashSettings() {
        const [state, setState] = R.useState(null), [busy, setBusy] = R.useState(false), [error, setError] = R.useState('');
        R.useEffect(() => { let live = true; fetch('/plugins/git-bash-windows').then((r) => r.json()).then((s) => { if (live) setState(s); }).catch((e) => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
        const toggle = async () => {
          setBusy(true); setError('');
          try { const r = await fetch('/plugins/git-bash-windows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !state.enabled }) }); const next = await r.json(); if (!r.ok || !next.ok) throw new Error(next.error || '切换失败'); setState(next); }
          catch (e) { setError(e.message); } finally { setBusy(false); }
        };
        return h('section', { style: { color: 'var(--dsw-alias-label-primary, #1f2937)', maxWidth: 760, padding: '16px 0' } },
          h('h3', null, 'Git Bash'),
          h('p', null, '开启后，标准、Code、极简和 Cordis 模式中的 PowerShell 工具改用 Git Bash；关闭后恢复。极简模式保留持久终端。'),
          h('button', { type: 'button', role: 'switch', 'aria-checked': Boolean(state?.enabled), disabled: busy || !state?.supported, onClick: toggle,
            style: { background: state?.enabled ? '#2455db' : 'var(--dsw-alias-bg-module-platform, #eef1f6)', color: state?.enabled ? '#fff' : 'var(--dsw-alias-label-primary, #1f2937)', border: '1px solid var(--dsw-alias-border-l3, #c8cdd8)', borderRadius: 8, padding: '8px 16px', font: 'inherit', cursor: 'pointer' } }, busy ? '切换中…' : state?.enabled ? '已开启 · 点击关闭' : '已关闭 · 点击开启'),
          h('p', { style: { color: 'var(--dsw-alias-label-secondary, #525b6a)', fontSize: 12 } }, 'Git Bash 使用当前用户权限执行，不使用 Windows ACL 文件沙箱。开关只影响后续工具调用，不终止已经开始的命令。'),
          (error || state?.error) ? h('p', { role: 'alert' }, error || state.error) : null);
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'git-bash-windows', label: 'Git Bash', order: 46 }, GitBashSettings));
    }
    return { name: 'git-bash-windows-client', inject: ['slots'], apply };
  }
});
