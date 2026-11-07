import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Account, Peer, Snapshot } from '../types'
import { EMPTY, lastOwn, parseAuthStatus, parseShared, peersOf, planLabel, STALE_MS, withSelf } from '../hooks/accounts'
import { COLORS, compose, formatCountdown, widthOf } from '../hooks/line'
import type { LineInput } from '../hooks/line'

const NOW = Date.parse('2026-11-07T10:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const SNAP: Snapshot = {
  tokens: 66_000,
  window: 200_000,
  threshold: 160_000,
  limits: [
    { kind: 'seven_day', percentUsed: 26, resetsAt: '2026-11-10T03:00:00Z' },
    { kind: 'five_hour', percentUsed: 22, resetsAt: '2026-11-07T12:00:00Z' },
  ],
}

const MAX: Account = { key: '/u/.claude-jivu', plan: 'Max', email: 'jivu@example.com', loginExpiresAt: '2026-12-01T00:00:00Z' }

const PRO: Peer = {
  key: '/u/.claude',
  plan: 'Pro',
  email: 'chris@example.com',
  loginExpiresAt: '2026-12-05T00:00:00Z',
  limits: [
    { kind: 'five_hour', percentUsed: 3, resetsAt: '2026-11-07T12:30:00Z' },
    { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-11-12T00:00:00Z' },
  ],
  at: NOW - 20 * MIN,
}

const lineOf = (over: Partial<LineInput> = {}, columns = 200) =>
  compose({ snap: SNAP, self: MAX, peers: [PRO], now: NOW, columns, ...over })
const spansOf = (over: Partial<LineInput> = {}, columns = 200) => lineOf(over, columns).top
const textOf = (over: Partial<LineInput> = {}, columns = 200) =>
  spansOf(over, columns)
    .map(s => s.text)
    .join('')
const bottomOf = (over: Partial<LineInput> = {}, columns = 200) =>
  lineOf(over, columns)
    .bottom.map(s => s.text)
    .join('')
// 一段文字在这一行里从第几格开始（中文按两格算）
const columnOf = (spans: ReturnType<typeof spansOf>, text: string) => {
  const i = spans.findIndex(s => s.text === text)
  return i === -1 ? -1 : widthOf(spans.slice(0, i))
}

// 方框线、箭头、间隔点、破折号、✻：部分终端按两格显示，会让算出的宽度和实际不符
const AMBIGUOUS = /[·–—←-⇿─-╿✻]/

const spanWith = (spans: ReturnType<typeof spansOf>, text: string) => spans.find(s => s.text === text)

describe('这一行：内容与顺序', () => {
  test('宽度够时分两组：左边当前号（标签、额度、上下文），竖线右边是另一个号', async () => {
    expect(textOf()).toBe('   Max       5h 22%  7d 26%  ctx 41%  |  Pro  5h 3%  7d 41%')
  })

  test('从 200 列到 5 列，每种宽度都放得下，且不用宽度不定的字符', async () => {
    for (let columns = 200; columns >= 5; columns--) {
      const { top, bottom } = lineOf({}, columns)
      for (const row of [top, bottom]) {
        expect(widthOf(row)).toBeLessThanOrEqual(columns)
        expect(row.map(s => s.text).join('')).not.toMatch(AMBIGUOUS)
      }
    }
  })

  test('变窄时账号标签留到最后，依次丢掉：另一个号、上下文、7d、5h', async () => {
    expect(textOf({}, 40)).toBe('   Max       5h 22%  7d 26%  ctx 41%')
    expect(textOf({}, 28)).toBe('   Max       5h 22%  7d 26%')
    expect(textOf({}, 19)).toBe('   Max       5h 22%')
    expect(textOf({}, 10)).toBe('   Max   ')
  })

  test('间距分三级，组内比组间明显近：一项内部 1 格，同组各项 2 格，组与组之间约 4 格', async () => {
    const spans = spansOf()
    const chipEnd = spans.map(s => s.bg !== undefined).lastIndexOf(true)
    // 账号列和额度之间 4 格：比组内的 2 格大一倍，第二行的「登录剩3d」才不会被读成额度里的一项
    expect(spans[chipEnd + 1]).toEqual({ text: '    ' })
    const rule = spans.findIndex(s => s.text === '|')
    expect([spans[rule - 1]?.text, spans[rule + 1]?.text]).toEqual(['  ', '  '])
    // 另一个号组内也是 2 格，和当前号一个规则
    expect(textOf()).toContain('Pro  5h 3%  7d 41%')
    expect(textOf()).toContain('5h 22%  7d 26%')
  })

  test('还没认出账号、也没有额度时，只剩上下文', async () => {
    expect(textOf({ self: null, peers: [], snap: { ...SNAP, limits: [] } })).toBe('ctx 41%')
  })

  test('两个号套餐相同时，带上邮箱前 4 位区分', async () => {
    const text = textOf({ peers: [{ ...PRO, plan: 'Max' }] })
    expect(text).toContain(' Max-jivu ')
    expect(text).toContain('Max-chri  5h 3%')
  })
})

describe('这一行：层级与颜色', () => {
  test('当前号是带底色的标签；另一个号的名字用它自己的识别色', async () => {
    const spans = spansOf()
    expect(spanWith(spans, ' Max ')).toEqual({ text: ' Max ', color: COLORS.plans.Max?.onColor, bg: COLORS.plans.Max?.color, bold: true })
    expect(spanWith(spans, 'Pro')?.color).toBe(COLORS.plans.Pro?.color)
    // 色块拉宽到和下面的登录状态同宽，名字居中；补的空白也是同一个底色
    const chip = spans.filter(s => s.bg !== undefined)
    expect(new Set(chip.map(s => s.bg))).toEqual(new Set([COLORS.plans.Max?.color]))
    expect(widthOf(chip)).toBe(widthOf([{ text: '登录剩23d' }]))
    expect(chip.map(s => s.text).join('')).toBe('   Max   ')
  })

  test('两行从同一个左边缘开始：第二行没有缩进，账号下面就是它的登录状态', async () => {
    const { top, bottom } = lineOf()
    expect(top[0]?.bg).toBe(COLORS.plans.Max?.color)
    expect(columnOf(bottom, '登录剩23d')).toBe(0)
  })

  test('颜色都写主题色名，跟着浅色、深色主题走；只有 Max 标签上的深色字是固定的', async () => {
    // 回归：之前写死两套十六进制颜色，主题为 auto 时认不出浅色，白底终端上数字几乎看不见
    const THEME_KEYS = new Set(['text', 'inactive', 'subtle', 'warning', 'error', 'claude', 'suggestion', 'inverseText'])
    const at = (pct: number) => ({ ...SNAP, limits: [{ kind: 'five_hour', percentUsed: pct, resetsAt: '2026-11-07T12:00:00Z' }] })
    const soon = { ...MAX, loginExpiresAt: new Date(NOW + 5 * HOUR).toISOString() }
    const cases = [
      spansOf(),
      spansOf({ snap: at(75) }),
      spansOf({ snap: at(92), self: soon }),
      spansOf({ self: { ...MAX, plan: 'Team' } }),
      spansOf({ self: { ...MAX, plan: 'Pro' }, peers: [{ ...PRO, plan: 'Max' }] }),
    ]
    for (const spans of cases) {
      for (const s of spans) {
        for (const c of [s.color, s.bg]) {
          if (c === undefined || c === COLORS.plans.Max?.onColor) continue
          expect(THEME_KEYS.has(c)).toBe(true)
        }
      }
    }
  })

  test('平时不上色：当前号数值用正文色、标签暗，另一个号整组和标签一样暗', async () => {
    const spans = spansOf()
    expect(spanWith(spans, '22%')).toEqual({ text: '22%', color: COLORS.value })
    expect(spanWith(spans, '5h ')?.color).toBe(COLORS.label)
    // 竖线右边是另一个号；上下文这会儿也是 41%，所以只在竖线之后找
    expect(spanWith(spans.slice(spans.findIndex(x => x.text === '|')), '41%')?.color).toBe(COLORS.label)
    expect(spans.some(s => s.color === COLORS.warn || s.color === COLORS.danger)).toBe(false)
  })

  test('到 70% 变黄，到 90% 变红加粗；下面的倒计时跟着变色，平时是标签灰', async () => {
    const at = (pct: number) => ({ ...SNAP, limits: [{ kind: 'five_hour', percentUsed: pct, resetsAt: '2026-11-07T12:00:00Z' }] })
    const warn = lineOf({ snap: at(75), peers: [] })
    expect(spanWith(warn.top, '75%')?.color).toBe(COLORS.warn)
    expect(spanWith(warn.bottom, '2h00m')?.color).toBe(COLORS.warn)
    const danger = lineOf({ snap: at(92), peers: [] })
    expect(spanWith(danger.top, '92%')).toEqual({ text: '92%', color: COLORS.danger, bold: true })
    expect(spanWith(danger.bottom, '2h00m')).toEqual({ text: '2h00m', color: COLORS.danger })
    expect(spanWith(lineOf({ snap: at(60), peers: [] }).bottom, '2h00m')?.color).toBe(COLORS.label)
    // 倒计时只在第二行，第一行不再挤括号
    expect(textOf({ snap: at(75), peers: [] })).not.toContain('(')
  })

  test('第二行：每个窗口还有多久重置，对齐在它的额度正下方，另一个号也一样', async () => {
    const { top, bottom } = lineOf()
    expect(columnOf(bottom, '2h00m')).toBe(columnOf(top, '5h '))
    expect(columnOf(bottom, '2d17h')).toBe(columnOf(top, '7d '))
    expect(columnOf(bottom, '2h30m')).toBeGreaterThan(columnOf(top, 'Pro'))
    const peerItems = top.map((s, i) => ({ s, i })).filter(({ s }) => s.text === '5h ' || s.text === '7d ').slice(2)
    expect(columnOf(bottom, '2h30m')).toBe(widthOf(top.slice(0, peerItems[0]!.i)))
    expect(columnOf(bottom, '4d14h')).toBe(widthOf(top.slice(0, peerItems[1]!.i)))
  })

  test('竖线在第二行也接上，两组的边界是一整条', async () => {
    const { top, bottom } = lineOf()
    expect(columnOf(bottom, '|')).toBe(columnOf(top, '|'))
  })

  test('第二行什么都没有（没有重置时间、也没开自动压缩）时只有一行', async () => {
    expect(lineOf({ self: { ...MAX, loginExpiresAt: null }, snap: { ...SNAP, limits: [], threshold: null }, peers: [] }).bottom).toEqual([])
  })

  test('另一个号快用完也变色，但不加粗，不和当前号抢', async () => {
    const hot: Peer = { ...PRO, limits: [{ kind: 'five_hour', percentUsed: 95, resetsAt: '2026-11-07T12:30:00Z' }] }
    expect(spanWith(spansOf({ peers: [hot] }), '95%')).toEqual({ text: '95%', color: COLORS.danger, bold: false })
  })

  test('上下文以压缩点为 100%：到 100% 就压缩，和 5h、7d 到 100% 触顶一个意思', async () => {
    // 66K / 压缩点 160K = 41%（按整个 200K 窗口算是 33%，会让人以为还早）
    expect(textOf()).toContain('ctx 41%')
    expect(spanWith(spansOf({ snap: { ...SNAP, tokens: 130_000 } }), '81%')?.color).toBe(COLORS.warn)
    expect(spanWith(spansOf({ snap: { ...SNAP, tokens: 170_000 } }), '即将压缩')?.color).toBe(COLORS.danger)
    expect(textOf({ snap: { ...SNAP, tokens: null } })).toContain('ctx -')
  })

  test('上下文下面写还剩多少就压缩，对齐在 ctx 正下方，快到时跟着变色', async () => {
    const { top, bottom } = lineOf()
    expect(columnOf(bottom, '剩94K')).toBe(columnOf(top, 'ctx '))
    expect(spanWith(bottom, '剩94K')?.color).toBe(COLORS.label)
    expect(spanWith(lineOf({ snap: { ...SNAP, tokens: 130_000 } }).bottom, '剩30K')?.color).toBe(COLORS.warn)
    expect(lineOf({ snap: { ...SNAP, tokens: 170_000 } }).bottom.some(s => s.text.startsWith('剩'))).toBe(false)
    const big = { ...SNAP, tokens: 320_000, window: 1_000_000, threshold: 600_000 }
    expect(textOf({ snap: big })).toContain('ctx 53%')
    expect(bottomOf({ snap: big })).toContain('剩280K')
    expect(bottomOf({ snap: { ...big, tokens: 10_000, threshold: 1_600_000, window: 2_000_000 } })).toContain('剩1.6M')
  })

  test('没开自动压缩：按整个窗口算，下面不写还剩多少', async () => {
    const off = { ...SNAP, threshold: null }
    expect(textOf({ snap: off })).toContain('ctx 33%')
    expect(lineOf({ snap: off }).bottom.some(s => s.text.startsWith('剩'))).toBe(false)
  })

  test('窗口已过重置时间、之后没有新记录：上面 - 不拿旧数字充数，下面写"未用"说明为什么没数', async () => {
    // 空状态要说清是什么情况：只摆一个 - 会让人以为坏了
    const stale: Peer = { ...PRO, limits: [{ kind: 'five_hour', percentUsed: 70, resetsAt: new Date(NOW - MIN).toISOString() }] }
    const { top, bottom } = lineOf({ peers: [stale] })
    const text = top.map(s => s.text).join('')
    expect(text).toContain('Pro  5h -')
    expect(text).not.toContain('70%')
    const peerItem = top.findIndex((s, i) => s.text === '5h ' && i > top.findIndex(x => x.text === 'Pro'))
    expect(columnOf(bottom, '未用')).toBe(widthOf(top.slice(0, peerItem)))
    expect(spanWith(bottom, '未用')?.color).toBe(COLORS.label)
    // 「未用」和「5h -」一样宽：不用为对齐补空白，组内间距保持 2 格
    expect(widthOf([{ text: '未用' }])).toBe(widthOf([{ text: '5h -' }]))
    // 当前号也一样
    const expired = { ...SNAP, threshold: null, limits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: new Date(NOW - MIN).toISOString() }] }
    expect(textOf({ snap: expired, peers: [] })).toContain('5h -')
    expect(bottomOf({ snap: expired, peers: [] })).toContain('未用')
  })

  test('当前号的登录还剩多久写在色块正下方：平时灰，3 天内黄，1 天内红，过期写需重新登录', async () => {
    const at = (ms: number) => ({ ...MAX, loginExpiresAt: new Date(NOW + ms).toISOString() })
    const status = (ms: number) => lineOf({ self: at(ms), peers: [] }).bottom[0]
    // 写「剩」：只写「登录3d」分不清是已登录 3 天还是还剩 3 天；过期了直接说该做什么
    expect(status(10 * DAY)).toEqual({ text: '登录剩10d', color: COLORS.label })
    expect(status(2.5 * DAY)).toEqual({ text: '登录剩2d', color: COLORS.warn })
    expect(status(5 * HOUR)).toEqual({ text: '登录剩5h', color: COLORS.danger })
    expect(status(-MIN)).toEqual({ text: '需重新登录', color: COLORS.danger })
    expect(textOf({ self: at(2.5 * DAY), peers: [] })).not.toContain('登录')
  })

  test('另一个号的登录只在 3 天内快过期时提醒，写在它名字正下方', async () => {
    expect(bottomOf()).not.toContain('Pro')
    expect(bottomOf().split('|')[1]).not.toContain('登录')
    const soon: Peer = { ...PRO, loginExpiresAt: new Date(NOW + DAY + HOUR).toISOString() }
    const { top, bottom } = lineOf({ peers: [soon] })
    expect(columnOf(bottom, '登录剩1d')).toBe(columnOf(top, 'Pro'))
    expect(spanWith(bottom, '登录剩1d')?.color).toBe(COLORS.warn)
  })

  test('倒计时读起来短', async () => {
    expect(formatCountdown(59 * MIN)).toBe('59m')
    expect(formatCountdown(2 * HOUR + 5 * MIN)).toBe('2h05m')
    expect(formatCountdown(3 * DAY + 5 * HOUR)).toBe('3d5h')
    expect(formatCountdown(-1)).toBe('即将')
  })
})

describe('账号与共享文件', () => {
  test('从 claude auth status 认出账号和套餐', async () => {
    const out = JSON.stringify({
      loggedIn: true,
      configDirectory: '/u/.claude-jivu',
      email: 'jivu@example.com',
      subscriptionType: 'max',
      loginExpiresAt: '2026-11-10T21:13:46.939Z',
    })
    expect(parseAuthStatus(out)).toEqual({
      key: '/u/.claude-jivu',
      plan: 'Max',
      email: 'jivu@example.com',
      loginExpiresAt: '2026-11-10T21:13:46.939Z',
    })
    expect(parseAuthStatus(JSON.stringify({ loggedIn: false }))).toBeNull()
    expect(planLabel('pro')).toBe('Pro')
    expect(planLabel(undefined)).toBe('API')
  })

  test('写入自己这一条，保留仍在用的号，剔除 7 天没动的号', async () => {
    const old: Peer = { ...PRO, key: '/u/.claude-old', at: NOW - STALE_MS - MIN }
    const shared = { version: 1 as const, accounts: { [PRO.key]: PRO, [old.key]: old } }
    const next = withSelf(shared, MAX, SNAP.limits, NOW)
    expect(Object.keys(next.accounts).sort()).toEqual(['/u/.claude', '/u/.claude-jivu'])
    expect(next.accounts[MAX.key]?.limits).toEqual(SNAP.limits)
    expect(lastOwn(next, MAX.key)).toEqual(SNAP.limits)
  })

  test('其他号不含自己，也不含过期的号', async () => {
    const shared = withSelf({ version: 1, accounts: { [PRO.key]: PRO } }, MAX, SNAP.limits, NOW)
    expect(peersOf(shared, MAX.key, NOW).map(p => p.key)).toEqual(['/u/.claude'])
    expect(peersOf(shared, MAX.key, NOW + STALE_MS)).toEqual([])
  })

  test('文件里坏掉的单条被丢弃并报出来；整体格式不对直接报错', async () => {
    const text = JSON.stringify({ version: 1, accounts: { [PRO.key]: PRO, '/u/bad': { plan: 3 } } })
    const { shared, dropped } = parseShared(text)
    expect(Object.keys(shared.accounts)).toEqual(['/u/.claude'])
    expect(dropped).toEqual(['/u/bad'])
    expect(() => parseShared('{"accounts":[]}')).toThrow()
    expect(EMPTY.accounts).toEqual({})
  })
})

// 以下各 hook 代替引擎：插件下面没有别的东西，调用 `$` 时由它们作答
const AUTH = JSON.stringify({
  loggedIn: true,
  configDirectory: MAX.key,
  email: MAX.email,
  subscriptionType: 'max',
  loginExpiresAt: MAX.loginExpiresAt,
})
const FILE = JSON.stringify({ version: 1, accounts: { [PRO.key]: { ...PRO, key: undefined } } })

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

type RunAnswer = { exitCode: number; stdout: string; stderr: string }

/** 引擎桩；`answers` 是 `claude auth status` 依次的回答，用完后一直重复最后一个。 */
const engine = (on: On, written: string[], answers: RunAnswer[] = [{ exitCode: 0, stdout: AUTH, stderr: '' }], runs: string[] = []) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { tokens: 66_000, window: 200_000, percent: 33 }, rateLimits: [] },
  }))
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    const a = answers[Math.min(runs.length, answers.length) - 1] ?? answers[0]
    return { value: { exitCode: a?.exitCode ?? 1, stdout: a?.stdout ?? '', stderr: a?.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: FILE }))
  on('fs.write', (_, e) => {
    written.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return clock
}

describe('输入框上方那一行', () => {
  test('认出当前号，同时显示另一个号；额度变了就写进共享文件', async ($, on) => {
    const written: string[] = []
    engine(on, written)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.session.measure({
      context: { tokens: 66_000, window: 200_000, percent: 33 },
      rateLimits: SNAP.limits,
      changed: ['context', 'rateLimits'],
    })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'usage-line', surface, component: 'AbovePrompt', props: BAND })
      expect(await ui.find({ type: 'Text', text: /^ Max $/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Pro$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^33%$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^2h00m$/ })).toBeDefined()
      await ui.unmount()
    }

    const last = JSON.parse(written[written.length - 1] ?? '{}')
    expect(Object.keys(last.accounts).sort()).toEqual([PRO.key, MAX.key].sort())
    expect(last.accounts[MAX.key].limits).toEqual(SNAP.limits)
  })

  test('启动时没认出账号，之后定时器每走一次就再认一次，认出来就停', async ($, on) => {
    // 回归：之前只在启动时认一次，失败了这一行就一直没有账号标签，还把自己当成另一个号列在后面
    const runs: string[] = []
    const clock = engine(
      on,
      [],
      [
        { exitCode: 1, stdout: '', stderr: 'boom' },
        { exitCode: 0, stdout: JSON.stringify({ loggedIn: false }), stderr: '' },
        { exitCode: 0, stdout: AUTH, stderr: '' },
      ],
      runs,
    )
    const band = async () => {
      const ui = await $.ui.mount({ plugin: 'usage-line', surface: 'terminal', component: 'AbovePrompt', props: BAND })
      const found = {
        badge: await ui.find({ type: 'Text', text: /^ Max $/ }),
        selfAsPeer: await ui.find({ type: 'Text', text: /^Max$/ }),
      }
      await ui.unmount()
      return found
    }

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await clock.advance(0)
    // 第一次：命令失败，认不出
    expect((await band()).badge).toBeUndefined()
    // 第二次：命令成功但说没登录，仍然认不出
    await clock.advance(30_000)
    expect((await band()).badge).toBeUndefined()
    // 第三次：认出来了，自己不再出现在另一个号里
    await clock.advance(30_000)
    const ok = await band()
    expect(ok.badge).toBeDefined()
    expect(ok.selfAsPeer).toBeUndefined()
    // 认出来之后不再跑命令
    await clock.advance(90_000)
    expect(runs).toHaveLength(3)
  })

  test('和上面的对话隔开一行，不贴在一起', async ($, on) => {
    engine(on, [])
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'usage-line', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ marginTop: 1, flexDirection: 'column' })
    await ui.unmount()
  })

  test('有问卷时把位置让给问卷', async ($, on) => {
    engine(on, [])
    const ui = await $.ui.mount({
      plugin: 'usage-line',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { ...BAND, hasSurvey: true },
    })
    expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
    await ui.unmount()
  })
})
