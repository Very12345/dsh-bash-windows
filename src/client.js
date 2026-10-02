window.__ModuleLoader__.load({
  id: '@very12345/dsh-bash-windows',
  factory: (require) => {
    const R = require('react'), h = R.createElement;
        const SETTINGS_ICON_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"m7 9 3 3-3 3M13 15h4\"/></svg>";
    const SettingsIcon = ({size = 20} = {}) => h("svg", {width:size, height:size, ...{"viewBox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "1.8", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": true, "focusable": false}}, h("rect", {"x": "3", "y": "4", "rx": "2"}), h("path", {"d": "m7 9 3 3-3 3M13 15h4"}));

    // DSH 0.2 uses a fixed nav glyph lookup. Limit this compatibility styling
    // to our own exact label in the native settings rail; leave React's SVG
    // node and all navigation/focus handlers intact. Keep SVG with assets/settings-icon.svg.
    function installSettingsNavIcon(ctx) {
      const doc = globalThis.document;
      if (!doc?.body || typeof globalThis.MutationObserver !== 'function' || typeof ctx.effect !== 'function') return;
      ctx.effect(() => {
        const attribute = 'data-dsh-plugin-settings-icon', owner = "git-bash-windows";
        const selector = '[data-shortcut-modal="settings"] nav';
        const style = doc.createElement('style');
        const mask = 'url("data:image/svg+xml,' + encodeURIComponent(SETTINGS_ICON_SVG) + '")';
        const own = selector + ' button[' + attribute + '="' + owner + '"]';
        style.textContent = own + '>svg{display:none!important}' + own + '::before{content:"";display:block;width:16px;height:16px;flex:none;background:currentColor;-webkit-mask:' + mask + ' center/contain no-repeat;mask:' + mask + ' center/contain no-repeat}';
        doc.head.appendChild(style);
        const marked = new Set();
        let nav = null;
        const decorate = () => {
          for (const button of marked) if (!button.isConnected || button.textContent.trim() !== "Git Bash") {
            if (button.getAttribute(attribute) === owner) button.removeAttribute(attribute);
            marked.delete(button);
          }
          for (const button of Array.from(nav?.querySelectorAll('button') || [])) {
            if (button.textContent.trim() !== "Git Bash" || button.firstElementChild?.tagName.toLowerCase() !== 'svg') continue;
            button.setAttribute(attribute, owner);
            marked.add(button);
          }
        };
        const rail = new MutationObserver(decorate);
        const mount = () => {
          const next = doc.querySelector(selector);
          if (next !== nav) {
            rail.disconnect(); nav = next;
            if (nav) rail.observe(nav, {childList:true, subtree:true, characterData:true});
          }
          decorate();
        };
        const root = new MutationObserver(mount);
        root.observe(doc.body, {childList:true});
        mount();
        return () => {
          root.disconnect(); rail.disconnect(); style.remove();
          for (const button of marked) if (button.getAttribute(attribute) === owner) button.removeAttribute(attribute);
          marked.clear();
        };
      });
    }

const SETTINGS_CSS = "\n.dshp-page{--sp-text:var(--dsw-alias-label-primary,#20242c);--sp-muted:var(--dsw-alias-label-secondary,#69717f);--sp-border:var(--dsw-alias-border-l3,#e4e7ec);--sp-bg:var(--dsw-alias-bg-layer-2,#fff);--sp-soft:var(--dsw-alias-bg-layer-3,#f7f8fa);--sp-accent:#3d64df;color:var(--sp-text);width:100%;max-width:680px;padding:4px 0 24px;font-family:inherit;font-size:14px;line-height:1.5}\n.dshp-page *{box-sizing:border-box}.dshp-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.dshp-title{display:flex;align-items:center;gap:10px;min-width:0}.dshp-symbol{display:grid;place-items:center;flex:none;width:36px;height:36px;border:1px solid var(--sp-border);border-radius:10px;background:var(--sp-soft);font-size:20px}.dshp-page h2{font-size:18px;font-weight:600;line-height:1.5;letter-spacing:normal;margin:0}.dshp-subtitle{color:var(--sp-muted);font-size:13px;margin:4px 0 0}.dshp-status{display:inline-flex;align-items:center;gap:7px;color:var(--sp-muted);font-size:12px;white-space:nowrap;border:1px solid var(--sp-border);border-radius:20px;padding:4px 8px}.dshp-dot{width:6px;height:6px;flex:none;border-radius:50%;background:#969eab}.dshp-status[data-ok=true] .dshp-dot{background:#21936a}.dshp-status[data-warn=true] .dshp-dot{background:#c58c2e}\n.dshp-section{margin-top:18px}.dshp-heading{color:var(--sp-muted);font-weight:600;font-size:13px;margin:0 0 8px}.dshp-panel{background:var(--sp-bg);border:1px solid var(--sp-border);border-radius:10px;overflow:hidden}.dshp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px}.dshp-row+.dshp-row{border-top:1px solid var(--sp-border)}.dshp-label{font-weight:550;font-size:14px;margin:0}.dshp-help{font-size:12px;color:var(--sp-muted);line-height:1.55;margin:3px 0 0}.dshp-page button,.dshp-page input,.dshp-page select{font:inherit}.dshp-page button{cursor:pointer}.dshp-page button:disabled{cursor:default;opacity:.45}.dshp-page button:focus-visible,.dshp-page input:focus-visible,.dshp-page select:focus-visible{outline:3px solid #8ba9ff;outline-offset:3px}.dshp-switch{position:relative;flex:none;width:40px;height:24px;border:0;border-radius:20px;padding:3px;background:#a0a7b2}.dshp-switch[aria-checked=true]{background:var(--sp-accent)}.dshp-knob{display:block;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transform:translateX(0);transition:transform .15s}.dshp-switch[aria-checked=true] .dshp-knob{transform:translateX(16px)}\n.dshp-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;border:1px solid var(--sp-border);background:var(--sp-bg);color:var(--sp-text);border-radius:7px;padding:6px 10px;font-size:12px!important}.dshp-button:hover{background:var(--sp-soft)}.dshp-primary{background:var(--sp-accent)!important;border-color:var(--sp-accent)!important;color:white!important}.dshp-danger{color:var(--dsw-alias-label-error,#c73f38)}.dshp-footnote{color:var(--sp-muted);font-size:12px;line-height:1.55;margin:8px 2px 0}.dshp-error{color:var(--dsw-alias-label-error,#c73f38);background:var(--sp-soft);border:1px solid var(--sp-border);padding:12px 14px;border-radius:8px;font-size:12px;margin-top:14px}.dshp-footer{font-size:11px;color:var(--sp-muted);margin-top:14px}.dshp-empty{font-size:12px;color:var(--sp-muted);padding:14px 16px}.dshp-option{width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 12px;border:1px solid transparent;background:transparent;color:var(--sp-text);border-radius:8px}.dshp-option[aria-checked=true]{background:var(--sp-soft);border-color:var(--sp-border)}.dshp-option-copy{flex:1}.dshp-radio{width:16px;height:16px;border:1.5px solid #9ca5b3;border-radius:50%;display:grid;place-items:center;flex:none}.dshp-option[aria-checked=true] .dshp-radio{border-color:var(--sp-accent)}.dshp-option[aria-checked=true] .dshp-radio:after{content:'';width:8px;height:8px;border-radius:50%;background:var(--sp-accent)}.dshp-options{padding:6px}.dshp-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.dshp-tags{display:flex;gap:7px;flex-wrap:wrap}.dshp-tag{font-size:12px;color:var(--sp-muted);background:var(--sp-soft);border:1px solid var(--sp-border);padding:3px 8px;border-radius:6px}.dshp-form{padding:14px 16px;border-top:1px solid var(--sp-border);display:grid;gap:10px}.dshp-page input:not([type=checkbox]),.dshp-page select{min-height:32px;border:1px solid var(--sp-border)!important;border-radius:7px!important;background:var(--sp-bg)!important;color:var(--sp-text)!important;padding:6px 9px!important;font:inherit!important}.dshp-page input[type=checkbox]{accent-color:var(--sp-accent);width:15px;height:15px;flex:none}.dshp-disclosure{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;background:transparent;border:0;color:var(--sp-text);padding:12px 16px;font-size:14px;font-weight:550}.dshp-disclosure span:last-child{color:var(--sp-muted)}.dshp-user{padding:10px 16px}.dshp-user+.dshp-user{border-top:1px solid var(--sp-border)}.dshp-user summary{cursor:pointer;list-style:none}.dshp-user summary::-webkit-details-marker{display:none}.dshp-user summary:after{content:'›';float:right;color:var(--sp-muted)}.dshp-user[open] summary:after{content:'⌄'}.dshp-user-meta{color:var(--sp-muted);font-size:12px;overflow-wrap:anywhere;margin-top:6px}\n@media(max-width:520px){.dshp-page h2{font-size:18px}.dshp-header{align-items:flex-start;gap:12px;margin-bottom:18px}.dshp-subtitle{max-width:220px;margin:4px 0 0}.dshp-symbol{width:36px;height:36px;border-radius:10px}.dshp-row,.dshp-form,.dshp-disclosure{padding:12px}.dshp-row{gap:12px;padding:12px 16px}.dshp-status{font-size:11px;padding:4px 8px}}\n@media(prefers-reduced-motion:reduce){.dshp-knob{transition:none}}\n";
    function apply(ctx) {
      installSettingsNavIcon(ctx);
      function GitBashSettings() {
        const [state, setState] = R.useState(null), [busy, setBusy] = R.useState(false), [error, setError] = R.useState('');
        R.useEffect(() => { let live = true; fetch('/plugins/git-bash-windows').then((r) => r.json()).then((s) => { if (live) setState(s); }).catch((e) => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
        const toggle = async () => {
          setBusy(true); setError('');
          try { const r = await fetch('/plugins/git-bash-windows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !state.enabled }) }); const next = await r.json(); if (!r.ok || !next.ok) throw new Error(next.error || '切换失败'); setState(next); }
          catch (e) { setError(e.message); } finally { setBusy(false); }
        };
        return h('section',{className:'dshp-page'},h('style',null,SETTINGS_CSS),
          h('header',{className:'dshp-header'},h('div',{className:'dshp-title'},h('span',{className:'dshp-symbol'},h(SettingsIcon)),h('div',null,h('h2',null,'Git Bash'),h('p',{className:'dshp-subtitle'},'为 Windows 切换更熟悉的终端。'))),h('span',{className:'dshp-status','data-ok':state?.enabled},h('span',{className:'dshp-dot'}),!state?'加载中':!state.supported?'需要 Windows':state.enabled?'已开启':'未开启')),
          h('div',{className:'dshp-panel'},h('div',{className:'dshp-row'},h('div',null,h('p',{className:'dshp-label'},'使用 Git Bash'),h('p',{className:'dshp-help'},'开启后，内置模式的 PowerShell 工具改用 Git Bash。')),h('button',{type:'button',className:'dshp-switch',role:'switch','aria-label':'使用 Git Bash','aria-checked':Boolean(state?.enabled),disabled:busy||!state?.supported,onClick:toggle},h('span',{className:'dshp-knob'})))),
          h('section',{className:'dshp-section'},h('h3',{className:'dshp-heading'},'生效范围'),h('div',{className:'dshp-panel'},h('div',{className:'dshp-row'},h('div',null,h('p',{className:'dshp-label'},'四种内置模式'),h('p',{className:'dshp-help'},'极简模式继续使用持久终端。')),h('div',{className:'dshp-tags'},...['标准','Code / PTC','极简','Cordis'].map(name=>h('span',{className:'dshp-tag',key:name},name))))),h('p',{className:'dshp-footnote'},'关闭后恢复 PowerShell；已经开始的命令会继续执行。')),
          h('p',{className:'dshp-footnote'},'Git Bash 使用当前用户权限执行，不使用 Windows ACL 文件沙箱。'),
          (error||state?.error)?h('div',{className:'dshp-error',role:'alert'},error||state.error):null,
          h('div',{className:'dshp-footer',role:'status'},busy?'正在保存…':'设置自动保存'));

      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'git-bash-windows', label: 'Git Bash', order: 46 }, GitBashSettings));
    }
    return { name: 'git-bash-windows-client', inject: ['slots'], apply };
  }
});
