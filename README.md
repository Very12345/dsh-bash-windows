# dsh-bash-windows

在 DSH 设置页提供一个 Git Bash 开关。开启后，标准、Code、极简和 Cordis 四种内置模式中的 `pwsh` 工具由 `bash` 替代；关闭后恢复 PowerShell。插件不再新增独立模式。

## 安装与使用

```sh
dsh plugin --profile desktop add github:Very12345/dsh-bash-windows
```

也可执行 `npm pack` 后通过 DSH 插件管理器安装本地包。npm 公共仓库尚未发布此 scoped 包。需要 Windows、Git for Windows 和 DSH 0.2.0-rc.2 或兼容版本；开发环境 Node.js >= 22。

更新后重启 DSH，在「设置 → Git Bash」点击开关。开关默认关闭，状态由 DSH 配置服务持久化到当前 profile。已有四种模式会话和后续创建的会话都使用该设置。

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

- `src/switcher.js`：持久开关、设置路由和已有／新建会话同步。
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

## 许可证

MIT，见 [LICENSE](./LICENSE)。

## 设置页面

设置页与 Windows 电脑操作页使用一致的分区、开关、状态和主题样式，支持窄屏。可即时生效的开关与选项会自动保存。

设置页采用紧凑的行间距与分区留白，保持原生正文字号。侧栏及页面标题使用独立 SVG 图标，并随深浅色主题显示。当前宿主的固定齿轮通过插件内、仅限自身导航项的样式适配替换；卸载时恢复，不修改宿主文件。
