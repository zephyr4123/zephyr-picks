// 多账号：认出当前会话登录的是哪个号，并和其他号互相共享各自最近一次的额度。
// 这里只放纯函数；跑命令、读写文件在 register.tsx，测试可以直接驱动这些函数。

import type { Account, Limit, Peer } from '../types'

/** 共享文件里一个号的记录，以它的配置目录为键。 */
export type Entry = Omit<Peer, 'key'>
export type Shared = { version: 1; accounts: Record<string, Entry> }

export const EMPTY: Shared = { version: 1, accounts: {} }

// 7 天没有任何会话更新过的号：两个窗口都早已重置，旧数字没有意义，按"不再使用"处理
export const STALE_MS = 7 * 24 * 60 * 60 * 1000

/** `claude auth status --json` 的输出 → 当前账号；未登录返回 null。 */
export function parseAuthStatus(stdout: string): Account | null {
  const j: unknown = JSON.parse(stdout)
  if (!isRecord(j) || j.loggedIn !== true || typeof j.configDirectory !== 'string') return null
  return {
    key: j.configDirectory,
    plan: planLabel(j.subscriptionType),
    email: typeof j.email === 'string' ? j.email : null,
    loginExpiresAt: typeof j.loginExpiresAt === 'string' ? j.loginExpiresAt : null,
  }
}

/** pro → Pro，max → Max；没有订阅（API key 登录）显示 API。 */
export function planLabel(subscriptionType: unknown): string {
  if (typeof subscriptionType !== 'string' || subscriptionType === '') return 'API'
  return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1)
}

/**
 * 解析共享文件。整体格式不对时抛错（调用方记日志后当空文件用，下次写入即修正）；
 * 单条记录不对只丢那一条，丢了哪些放进 dropped 交给调用方记日志。
 */
export function parseShared(text: string): { shared: Shared; dropped: string[] } {
  const j: unknown = JSON.parse(text)
  if (!isRecord(j) || j.version !== 1 || !isRecord(j.accounts)) throw new Error('not a version 1 accounts file')
  const accounts: Record<string, Entry> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(j.accounts)) {
    if (isEntry(value)) accounts[key] = value
    else dropped.push(key)
  }
  return { shared: { version: 1, accounts }, dropped }
}

/** 写入自己这一条，同时剔除过期的号，文件不会越积越长。 */
export function withSelf(shared: Shared, self: Account, limits: Limit[], at: number): Shared {
  const accounts: Record<string, Entry> = {}
  for (const [key, entry] of Object.entries(shared.accounts)) {
    if (key !== self.key && at - entry.at <= STALE_MS) accounts[key] = entry
  }
  accounts[self.key] = { plan: self.plan, email: self.email, loginExpiresAt: self.loginExpiresAt, limits, at }
  return { version: 1, accounts }
}

/** 自己以外、仍在使用的号；按配置目录排序，行里的顺序才稳定。 */
export function peersOf(shared: Shared, selfKey: string | null, now: number): Peer[] {
  return Object.entries(shared.accounts)
    .filter(([key, entry]) => key !== selfKey && now - entry.at <= STALE_MS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => ({ key, ...entry }))
}

/** 这个号上一次留下的额度：新会话收到第一次响应之前，先拿它显示。 */
export function lastOwn(shared: Shared, selfKey: string): Limit[] {
  return shared.accounts[selfKey]?.limits ?? []
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isLimit(x: unknown): x is Limit {
  return (
    isRecord(x) &&
    typeof x.kind === 'string' &&
    typeof x.percentUsed === 'number' &&
    (x.resetsAt === undefined || typeof x.resetsAt === 'string')
  )
}

function isEntry(x: unknown): x is Entry {
  return (
    isRecord(x) &&
    typeof x.plan === 'string' &&
    (x.email === null || typeof x.email === 'string') &&
    (x.loginExpiresAt === null || typeof x.loginExpiresAt === 'string') &&
    Array.isArray(x.limits) &&
    x.limits.every(isLimit) &&
    typeof x.at === 'number'
  )
}
