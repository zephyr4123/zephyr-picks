# zephyr-picks

我在用、觉得好用的工具、字体和配置。按需取用，不需要全装。

## 目录约定

- 一级目录是类别（`terminals/`、`fonts/`、`claude-code-plugins/`……），有条目时才建。
- 每个条目一个目录：`<类别>/<条目>/README.md`，配置文件放在同一目录。
- 条目之间的依赖写在条目 README 的「依赖」里，用相对链接指过去。装一个条目前，先装它的依赖。
- 能单独安装、可能被多个条目共用的（如字体）单独成条目；只是某个条目的一项设置的（如 Ghostty 自带的配色）写进那个条目的配置。

## 清单

| 类别 | 条目 | 说明 |
|---|---|---|
| 终端 | [Ghostty](terminals/ghostty/) | 快、原生 macOS 界面、开箱即用 |
| 字体 | [Maple Mono NF CN](fonts/maple-mono-nf-cn/) | 中英文等宽对齐的编程字体，中文正好两格宽 |
| Claude Code 插件 | [usage-line](claude-code-plugins/usage-line/) | 自制 mod：输入框上方两行显示多账号用量、重置倒计时、离自动压缩还有多远 |
