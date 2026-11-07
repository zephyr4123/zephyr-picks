# Ghostty

终端。快、原生 macOS 界面、开箱即用；Claude Code 的 Shift+Enter 换行和完成通知都不用另配。

## 安装

```sh
brew install --cask ghostty
```

## 依赖

- [Maple Mono NF CN](../../fonts/maple-mono-nf-cn/)：配置里用的字体

## 配置

把同目录的 [`config.ghostty`](config.ghostty) 复制到 `~/Library/Application Support/com.mitchellh.ghostty/config.ghostty`（已有文件先备份），然后在 Ghostty 里按 `Cmd + Shift + ,` 重新加载；字体没变就新开一个窗口。

- 配色：浅色用 GitHub Light Default，深色用 GitHub Dark Default，跟随系统切换。Ghostty 自带，不用另装。
- 字体：Maple Mono NF CN，15 号。

## 验证

```sh
/Applications/Ghostty.app/Contents/MacOS/ghostty +validate-config
```
