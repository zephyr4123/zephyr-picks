import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Account, Limit, Peer, Snapshot } from '../types'
import { EMPTY, lastOwn, parseAuthStatus, parseShared, peersOf, withSelf } from './accounts'
import type { Shared } from './accounts'
import { compose } from './line'
import type { Span } from './line'

const snapshot = atom({ plugin: 'usage-line', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-line', key: 'now' } as const, 0)
const self = atom({ plugin: 'usage-line', key: 'self' } as const, null)
const peers = atom({ plugin: 'usage-line', key: 'peers' } as const, [])

// 倒计时按分钟显示，半分钟走一次足够准；顺带重读一次其他号的额度，
// 还没认出账号的话也顺带再认一次
const TICK_MS = 30_000

// 一次认账号还没回来时不再叠一次（命令最长等 15 秒，定时器 30 秒一走，一般叠不上）
let identifying = false

// 压缩触发点是按哪个窗口大小测的；换模型（窗口变了）或重载后要重测
let thresholdWindow: number | null = null

// 共享文件放在 mod 自己的目录里：两个号的配置目录链接的是同一份 mods，
// 天然两边都能读写；哪天不用这个 mod 了，删掉目录，数据也一起没了
const sharedPath = ($: EngineInterface) => `${$.plugin.root}/data/accounts.json`

async function measureThreshold($: EngineInterface, window: number): Promise<void> {
  thresholdWindow = window
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const b = context.breakdown
    if (b === undefined) {
      thresholdWindow = null
      return
    }
    const threshold = b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null
    await update($, snapshot, s => (s === null ? s : { ...s, threshold }))
  } catch (err) {
    thresholdWindow = null
    $.ui.log(`usage-line: compaction threshold unavailable: ${String(err)}`, { to: 'debug' })
  }
}

async function take($: EngineInterface, usage: Pick<SessionUsage, 'context' | 'rateLimits'>) {
  await update($, snapshot, (s): Snapshot => ({
    tokens: usage.context.tokens ?? null,
    window: usage.context.window,
    threshold: s !== null && s.window === usage.context.window ? s.threshold : null,
    // 新会话第一次响应前引擎还没有额度数据，先留着上次的（取自共享文件），不清空
    limits: usage.rateLimits.length > 0 ? usage.rateLimits.map(toLimit) : (s?.limits ?? []),
  }))
  if (thresholdWindow !== usage.context.window) void measureThreshold($, usage.context.window)
}

function toLimit({ kind, percentUsed, resetsAt }: Limit): Limit {
  return resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt }
}

async function readShared($: EngineInterface): Promise<Shared> {
  const path = sharedPath($)
  if (!(await $.fs.exists(path))) return EMPTY
  try {
    const { shared, dropped } = parseShared(await $.fs.read(path))
    if (dropped.length > 0) $.ui.log(`usage-line: ${path}: skipped malformed entries ${dropped.join(', ')}`, { to: 'debug' })
    return shared
  } catch (err) {
    // 文件坏了不影响显示：当空文件用，下次写入会覆盖成正确格式
    $.ui.log(`usage-line: ${path} unreadable, treated as empty: ${String(err)}`, { to: 'debug' })
    return EMPTY
  }
}

async function refreshPeers($: EngineInterface): Promise<Shared> {
  const shared = await readShared($)
  const me = await read($, self)
  const t = await $.clock.now()
  await update($, peers, (): Peer[] => peersOf(shared, me?.key ?? null, t))
  return shared
}

/** 问 `claude auth status` 当前是哪个号；它继承本会话的 CLAUDE_CONFIG_DIR，所以问到的就是本会话的号。 */
async function identify($: EngineInterface): Promise<void> {
  if (identifying) return
  identifying = true
  try {
    const r = await $.process.run(['claude', 'auth', 'status', '--json'], { timeoutMs: 15_000 })
    if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`)
    const account = parseAuthStatus(r.stdout)
    if (account === null) throw new Error(`not signed in according to: ${r.stdout.slice(0, 200)}`)
    await update($, self, (): Account | null => account)
    const shared = await refreshPeers($)
    const own = lastOwn(shared, account.key)
    if (own.length > 0) await update($, snapshot, s => (s !== null && s.limits.length === 0 ? { ...s, limits: own } : s))
  } catch (err) {
    // 认不出账号时这一行照常显示，只是不带账号名；下次定时器走时再认
    $.ui.log(`usage-line: could not tell which account this session uses, will retry: ${String(err)}`, { to: 'debug' })
  } finally {
    identifying = false
  }
}

/** 把本号最新的额度写进共享文件，供其他号的会话读。 */
async function publish($: EngineInterface, limits: Limit[]): Promise<void> {
  const me = await read($, self)
  if (me === null || limits.length === 0) return
  try {
    const shared = await readShared($)
    const t = await $.clock.now()
    await $.fs.write(sharedPath($), `${JSON.stringify(withSelf(shared, me, limits.map(toLimit), t), null, 2)}\n`)
  } catch (err) {
    $.ui.log(`usage-line: could not write ${sharedPath($)}: ${String(err)}`, { to: 'debug' })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const t = await $.clock.now()
      await update($, now, () => t)
      await take($, await $.session.usage())
    } catch (err) {
      $.ui.log(`usage-line: first reading failed: ${String(err)}`, { to: 'debug' })
    }
    // 跑 `claude auth status` 要一两秒，不挡会话启动
    void identify($)

    $.clock.every(TICK_MS, () => {
      $.clock
        .now()
        .then(t => update($, now, () => t))
        .then(() => refreshPeers($))
        .then(() => read($, self))
        .then(me => (me === null ? identify($) : undefined))
        .catch(err => $.ui.log(`usage-line: tick failed: ${String(err)}`, { to: 'debug' }))
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await take($, e)
    if (e.changed.includes('rateLimits')) await publish($, e.rateLimits)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ticked = await read($, now)
    const line = compose({
      snap: await read($, snapshot),
      self: await read($, self),
      peers: await read($, peers),
      now: ticked > 0 ? ticked : await $.clock.now(),
      columns: e.props.bodyColumns,
    })

    const { Box, Text } = $.ui.resolve(e)
    const row = (spans: Span[]) => (
      <Text wrap="truncate-end">
        {spans.map(s => (
          <Text color={s.color} backgroundColor={s.bg} bold={s.bold}>
            {s.text}
          </Text>
        ))}
      </Text>
    )
    // 上面空一行：额度行紧跟在对话最后一行下面，贴在一起分不清哪句是对话、哪行是状态
    return (
      <Box marginTop={1} flexDirection="column">
        {line.bottom.length > 0 ? [row(line.top), row(line.bottom)] : [row(line.top)]}
      </Box>
    )
  })
}
