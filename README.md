# dsh-bash-windows

在 DSH 设置页提供一个 Git Bash 开关。开启后，标准、Code、极简和 Cordis 四种内置模式中的 `pwsh` 工具由 `bash` 替代；关闭后恢复 PowerShell。插件不再新增独立模式。

## 安装与使用

```sh
dsh plugin --profile desktop add github:Very12345/dsh-bash-windows
```

也可执行 `npm pack` 后通过 DSH 插件管理器安装本地包。npm 公共仓库尚未发布此 scoped 包。需要 Windows、Git for Windows 和 DSH 0.2.0-rc.2 或兼容版本；开发环境 Node.js >= 22。

更新后重启 DSH，在「设置 → Git Bash」点击开关。开关默认关闭。状态按当前 profile 独立保存到 `$DSH_HOME/git-bash-windows/profile-<hash>.json`；切换仅原位更新已有 Agent 的终端工具，不通过宿主 ConfigEditor 重载整个 profile。旧版 `cordis.patch.yml` 中的 `enabled` 保留，尚无独立状态文件时作为初始值。已有四种模式会话和后续创建的会话都使用该设置。

## 行为

| 模式 | 开启后的终端 |
| --- | --- |
| 标准 | Git Bash，逐次执行 |
| Code | 原有 `run_code` 与 PTC SDK 保留，SDK 中的 `pwsh` 换为 `bash` |
| 极简 | 单个持久 Bash 终端，工作目录及环境变量可跨调用保留 |
| Cordis | Git Bash，其他 Cordis 配置与工具保留 |

只替换终端工具，其他工具不变。关闭开关只移除 Bash 工具并恢复 PowerShell，不取消已经派发的命令；执行资源在会话结束时清理。极简模式中的 PowerShell 和 Bash 分别保留自己的终端状态，切换时不迁移变量或目录。

Git Bash 不能在 Windows ACL 受限 token 下启动，因此启用后该终端使用当前用户权限执行，不提供 Windows ACL 文件沙箱；设置页会明确提示这一行为。其他工具的权限、审批和执行仍由 DSH 管理。

从旧版独立「Bash 模式」迁移时，请在四种内置模式中使用新开关；插件不改写旧对话的历史和模式记录。

## 0.2.5 切换修复

在 DSH 0.2.0-rc.2 同时启用 SSH 插件时，旧版开关调用 settings.update，触发 ConfigEditor 的整套 profile 协调。会话服务重建时可能重复注册文件上传 Agent resolver，随后 sessionController 不可用，出现 command directory warmup failed / session/follow 错误并阻断后续发送。

新版开关独立持久化，原位更换工具，不触发这条重载链。保存失败会恢复原开关和工具；正在执行的命令继续保留原执行环境。已进入失效状态的宿主需完整退出重启，插件更新不会修复已失效的旧服务实例。

## 在 Bash 中调用 Windows 命令

工具里的命令是 Bash 源码。Bash 双引号会展开 `$变量`、`$_` 和命令替换；PowerShell 的 `$_` 必须保护好再传入。例如：

```bash
MSYS2_ARG_CONV_EXCL='*' powershell.exe -NoProfile -Command 'Get-Process | Where-Object { $_.ProcessName -match "Wei" }'
```

复杂引号或多行脚本可使用带单引号分隔符的 here-doc；非 ASCII 脚本也可用 UTF-16LE base64 的 `-EncodedCommand`，避免 Windows PowerShell 的输入编码差异。

```bash
powershell.exe -NoProfile -NonInteractive -Command - <<'PWSH'
1,2,3 | ForEach-Object { $_ * 2 }
PWSH
```

MSYS2 还会把 Windows 原生命令的 `/FI`、`/c` 等参数识别成 POSIX 路径。只对需要的那条原生命令关闭转换，保留其他命令的正常路径适配：

```bash
MSYS2_ARG_CONV_EXCL='*' tasklist.exe /FI "IMAGENAME eq Weixin.exe" /FO CSV /NH
MSYS2_ARG_CONV_EXCL='*' cmd.exe /d /c "echo ok"
```

0.2.2 将这些边界和安全示例直接加入四种模式的 Bash 工具描述，包含 PTC SDK 和极简持久终端。执行器继续原样传递命令，不猜测或改写用户的 `$` 表达式。

## 实现与维护

- `src/switcher.js`：开关、设置路由和已有／新建会话同步。
- `src/preferences.js`：按 profile 独立保存开关，原子写入、启动恢复和失败回滚。
- `src/overrides.js`：会话层工具覆盖，关闭时撤销限制并恢复原工具。
- `src/executor.js`：继承官方 Bash 执行器的超时、输出保留及后台进程能力。
- `src/guidance.js`：四种模式通用的 Bash / PowerShell 引号与 MSYS 参数转换说明。
- `src/client.js`：DSH 原生设置页中的开关。
- `cordis.patch.yml`：官方 bundle 安装入口，默认关闭。
- `test/`：路径解析、真实命令执行、工具注册与四种模式的恢复测试。

```sh
npm test
npm pack --dry-run
```

集成测试使用 DSH SDK、真实 Git Bash 和持久终端，未安装 SDK 或非 Windows 时相应测试跳过。`node_modules` 中的 SDK 链接是本地测试资源，不进入 Git 或分发包。

`test/host-smoke.mjs` 在独立临时 profile 安装本插件和指定 SSH tarball，通过完整官方 Web 界面检查开关、命令菜单、模型目录 RPC 及配置文件不变。需要 Playwright 和 Edge；可用 `DSH_BASH_PLAYWRIGHT_MODULE` 指向现有 Playwright 的 `index.mjs`，`DSH_BASH_TEST_APP` / `DSH_BASH_TEST_CLI` 指定官方运行入口。

```sh
npm pack --pack-destination .tmp --ignore-scripts
node test/host-smoke.mjs --ssh-package /path/to/dsh-ssh-workspace.tgz
```

0.2.5 在 Windows 的 32 项测试中 31 项通过；一项仅用于未安装 Git Bash 环境的错误路径测试，因本机已安装 Git Bash 跳过。Bash＋SSH 的隔离官方宿主中，连续四次开关切换后命令预加载与模型目录仍可用，profile patch 保持不变。

## 许可证

MIT，见 [LICENSE](./LICENSE)。

## 设置页面

设置页与 Windows 电脑操作页使用一致的分区、开关、状态和主题样式，支持窄屏。可即时生效的开关与选项会自动保存。

设置页采用紧凑的行间距与分区留白，保持原生正文字号。侧栏及页面标题使用独立 SVG 图标，并随深浅色主题显示。当前宿主的固定齿轮通过插件内、仅限自身导航项的样式适配替换；卸载时恢复，不修改宿主文件。
