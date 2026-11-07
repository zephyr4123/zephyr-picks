/** 一个额度窗口（5h / 7d / 限额），取自某次 API 响应。 */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** 当前会话自己的数据；引擎还没给出的项为 null。 */
export type Snapshot = {
  /** 上一次响应的输入 token 数；本窗口收到第一次响应前为 null。 */
  tokens: number | null
  /** 模型的上下文窗口大小（token）。 */
  window: number
  /** 自动压缩触发点（token）；关闭了或还没测出来时为 null。 */
  threshold: number | null
  limits: Limit[]
}

/** 一个已登录的账号，取自 `claude auth status`。 */
export type Account = {
  /** 这个登录所在的配置目录，用来区分不同的号。 */
  key: string
  /** Pro、Max……：行里显示的名字。 */
  plan: string
  email: string | null
  loginExpiresAt: string | null
}

/** 另一个号最近一次留下的额度，读自共享文件。 */
export type Peer = Account & {
  limits: Limit[]
  /** 那个号的会话最后一次写入的时间（毫秒）。 */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-line': {
      snapshot: Snapshot | null
      now: number
      self: Account | null
      peers: Peer[]
    }
  }
}
