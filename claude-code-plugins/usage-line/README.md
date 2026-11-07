# usage-line

Claude Code 插件（mod）：在输入框上方用两行显示当前号和其他号的 5h / 7d 用量与重置倒计时、离自动压缩还有多远、登录还剩多久。

来源：自制，源码就在本目录。在 Claude Code 2.1.319 上开发和测试。

```
  Max       5h 7%  7d 30%  ctx 53%  |  Pro  5h -  7d 4%
登录剩3d    3h43m  3d18h   剩280K   |       未用  3d14h
```

## 显示什么

- 第一行：当前号的色块；5h、7d 用量；`ctx` 是到自动压缩点的进度（压缩点为 100%，没开自动压缩时按整个窗口算）；竖线右边是其他号。
- 第二行（灰色，对齐在对应项正下方）：登录还剩多久、窗口还有多久重置、还剩多少 token 压缩。窗口已重置、之后这个号还没用过时写「未用」。
- 70% 变黄，90% 变红；登录 3 天内变黄、1 天内变红。颜色用 Claude Code 主题色名，跟随浅色 / 深色主题。
- 多账号：几个 `CLAUDE_CONFIG_DIR` 共用同一份 mod 目录时，各号把最新额度写进 mod 目录下的 `data/accounts.json`，互相读取。
- 终端变窄时依次去掉：其他号 → 上下文 → 7d → 5h → 登录状态。

## 安装

1. 把本目录复制到 `~/.claude/mods/usage-line`（`tests/` 可以不带）。
2. 在 `~/.claude/settings.json` 的 `env` 里加：
   ```json
   "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/usage-line"
   ```
   已有别的目录就用 `:` 接在后面。这个变量需要 Claude Code v2.1.280 或更高。
3. 重启 Claude Code（`/restart`）。这个变量只在启动时读，`/reload-plugins` 不够。

## 验证

```sh
claude plugin validate ~/.claude/mods/usage-line
claude plugin test ~/.claude/mods/usage-line
```
