// 输入框上方额度行的排版：数据进、带样式的片段出，按可用列数挑一个放得下的版本。
// 不调用引擎，测试可以直接驱动。
//
// 两行，分主次：第一行是"用了多少"，扫一眼就够；第二行是"还有多久重置"，灰色，
// 每个倒计时对齐在它的额度正下方——对齐让两行读成一张小表，按列看，不会像流水账从头读到尾。
//
// 视觉层级（终端里字号不能变，只能靠背景色、亮度、粗细和留白）：
//   1. 当前账号是一块带底色的标签，整行最重，扫一眼就知道在哪个号
//   2. 当前号的数值用亮色，标签（5h、7d、ctx）调暗
//   3. 另一个号整组用标签色，和当前号之间用一道浅色竖线隔开
//   4. 颜色只表达含义：平时一律中性色，到 70% 变黄、90% 变红加粗
//   5. 每个套餐一个固定识别色，当前号的底色和另一个号的名字用同一套颜色
//
// 只用 ASCII 和中文：方框线、箭头、间隔点这类字符在部分终端里按两格显示，
// 算出的宽度会和实际不符，所以不用。

import type { Account, Limit, Peer, Snapshot } from '../types'

export type Span = { text: string; color?: string; bg?: string; bold?: boolean }

/** 排好的两行；没有任何重置时间时 bottom 为空，只画一行。 */
export type Line = { top: Span[]; bottom: Span[] }

/** 一列：上格是额度，下格是它的重置倒计时（没有就空着）。两格按较宽的补齐，下一行才对得上。 */
type Cell = {
  top: Span[]
  bottom: Span[]
  /** 上格是色块时，补齐用同一个底色、名字居中，色块就和整列一样宽。 */
  fill?: Pick<Span, 'color' | 'bg'>
}

type Plan = {
  /** 识别色：当前号标签的底色，也是另一个号名字的颜色。 */
  color: string
  /** 标签底色上的字。 */
  onColor: string
}

export type Palette = {
  /** 当前号的数值。 */
  value: string
  /** 标签（5h、7d、ctx），以及另一个号的整组内容。 */
  label: string
  /** 两组之间的竖线：只起分隔作用，可以最淡。 */
  rule: string
  warn: string
  danger: string
  /** 每个套餐的识别色；不认识的套餐用 otherPlan。 */
  plans: Readonly<Record<string, Plan>>
  otherPlan: Plan
}

// 颜色写的是 Claude Code 主题里的颜色名，由当前主题换成具体颜色。
// 主题设成 auto 时跟着终端在浅色、深色之间切换，这边不用判断背景是黑是白；
// 之前自己按主题名挑两套写死的颜色，auto 认不出来，白底终端上数字几乎看不见。
export const COLORS: Palette = {
  value: 'text',
  label: 'inactive',
  rule: 'subtle',
  warn: 'warning',
  danger: 'error',
  plans: {
    // claude 橙在浅色、深色主题里是同一个颜色，上面固定用深色字
    Max: { color: 'claude', onColor: '#1b1b1b' },
    // suggestion 蓝在浅色主题里偏深、深色主题里偏浅，字用 inverseText 跟着反过来
    Pro: { color: 'suggestion', onColor: 'inverseText' },
  },
  otherPlan: { color: 'inactive', onColor: 'inverseText' },
}

export type LineInput = {
  snap: Snapshot | null
  /** 当前会话的账号；`claude auth status` 还没返回时为 null。 */
  self: Account | null
  peers: Peer[]
  now: number
  columns: number
}

type Variant = {
  peers: boolean
  context: boolean
  /** 账号下面的登录状态；最窄时去掉，色块缩回名字本身的宽度。 */
  login: boolean
  /** 当前号最多显示几个窗口。 */
  maxWindows: number
}

// 从宽到窄，取第一个放得下的。账号标签是"第一眼"，留到最后；
// 变窄时依次去掉：另一个号 → 上下文 → 7d → 5h → 登录状态。倒计时在第二行、对齐在额度下方，不额外占宽度
const VARIANTS: readonly Variant[] = [
  { peers: true, context: true, login: true, maxWindows: Infinity },
  { peers: false, context: true, login: true, maxWindows: Infinity },
  { peers: false, context: false, login: true, maxWindows: Infinity },
  { peers: false, context: false, login: true, maxWindows: 1 },
  { peers: false, context: false, login: true, maxWindows: 0 },
  { peers: false, context: false, login: false, maxWindows: 0 },
]

// 用到多少开始提醒：黄色提醒，红色加粗表示快用完了
const WARN_AT = 0.7
const DANGER_AT = 0.9
// 登录到期前 3 天开始提醒
const LOGIN_WARN_MS = 3 * 24 * 60 * 60 * 1000

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

// 间距分三级，靠得近的才是一组：
//   1 格：同一个东西内部——标签和数值；账号标签和后面的额度（标签自带底色的内边距，再隔 1 格就够）
//   2 格：同组的各项之间
//   竖线两边各 1 格：组与组之间靠竖线分，不靠大段空白——空白一多整行就散了
// 另一个号是次要信息，组内各项也只隔 1 格，排得更紧
const BADGE_GAP = ' '
const ITEM_GAP = '  '
const PEER_GAP = ' '
const GROUP_GAP = ' '

export function compose(input: LineInput): Line {
  let line: Line = { top: [], bottom: [] }
  for (const variant of VARIANTS) {
    line = layout(input, variant)
    if (widthOf(line.top) <= input.columns && widthOf(line.bottom) <= input.columns) return line
  }
  return line
}

function layout(input: LineInput, v: Variant): Line {
  const { self, snap, peers, now } = input
  const p = COLORS
  const names = displayNames(self, peers)

  // 第一组：我现在所在的地方——账号、它的额度、本会话的上下文
  const items: Cell[] = windows(snap?.limits ?? [], now, p, { peer: false, max: v.maxWindows })
  if (v.context) items.push(context(snap, p))
  const head = self !== null ? [badge(names.self, self, now, p, v.login)] : []

  const groups: Cell[][] = [joinCells([head, joinWith(items, ITEM_GAP)], BADGE_GAP)]

  // 其余各组：另一个号，整组用标签色，不和当前号抢
  if (v.peers) {
    peers.forEach((peer, i) => {
      const name: Span = { text: names.peers[i] ?? peer.plan, color: plan(peer.plan, p).color }
      const cells = [{ top: [name], bottom: loginStatus(peer.loginExpiresAt, now, p, { always: false }) }, ...windows(peer.limits, now, p, { peer: true, max: Infinity })]
      groups.push(joinWith(cells, PEER_GAP))
    })
  }

  // 组与组之间的竖线在第二行也画，两组的边界是一整条
  const rule: Cell = { top: [{ text: '|', color: p.rule }], bottom: [{ text: '|', color: p.rule }] }
  const between = [gapCell(GROUP_GAP), rule, gapCell(GROUP_GAP)]
  const cells = groups.filter(g => g.length > 0).flatMap((g, i) => (i > 0 ? [...between, ...g] : g))
  return flatten(cells)
}

/** 只有上格的列：账号标签、上下文、另一个号的名字，下面都空着。 */
function only(top: Span[]): Cell {
  return { top, bottom: [] }
}

function gapCell(text: string): Cell {
  return { top: [{ text }], bottom: [{ text }] }
}

/** 把若干列用同样的空隙连起来。 */
function joinWith(cells: Cell[], gap: string): Cell[] {
  return cells.flatMap((c, i) => (i > 0 ? [gapCell(gap), c] : [c]))
}

/** 把若干段（每段是若干列）用空隙连起来，跳过空段。 */
function joinCells(parts: Cell[][], gap: string): Cell[] {
  const kept = parts.filter(part => part.length > 0)
  return kept.flatMap((part, i) => (i > 0 ? [gapCell(gap), ...part] : part))
}

/** 每列上下补齐到同宽，再拼成两行；第二行没有任何倒计时就整行不要。 */
function flatten(cells: Cell[]): Line {
  const top: Span[] = []
  const bottom: Span[] = []
  let hasCountdown = false
  for (const c of cells) {
    const w = Math.max(widthOf(c.top), widthOf(c.bottom))
    const extra = w - widthOf(c.top)
    if (c.fill !== undefined && extra > 0) {
      const left = Math.floor(extra / 2)
      top.push(...pad(left, c.fill), ...c.top, ...pad(extra - left, c.fill))
    } else {
      top.push(...c.top, ...pad(extra))
    }
    bottom.push(...c.bottom, ...pad(w - widthOf(c.bottom)))
    if (c.bottom.some(s => s.text.trim() !== '' && s.text !== '|')) hasCountdown = true
  }
  return { top: trimEnd(top), bottom: hasCountdown ? trimEnd(bottom) : [] }
}

function pad(n: number, style: Pick<Span, 'color' | 'bg'> = {}): Span[] {
  return n > 0 ? [{ text: ' '.repeat(n), ...style }] : []
}

/** 去掉行尾只有空白的片段，免得终端里拖着看不见的空格。 */
function trimEnd(spans: Span[]): Span[] {
  const out = [...spans]
  while (out.length > 0 && out[out.length - 1]!.text.trim() === '' && out[out.length - 1]!.bg === undefined) out.pop()
  return out
}

/**
 * 最左一列：上格是当前号的色块（色块本身就表示"当前账号"），下格是它的登录还剩多久。
 * 两格都有内容，两行就从同一个左边缘开始；下格空着会像缩进，缩进读起来是"从属于上一行"。
 */
function badge(name: string, self: Account, now: number, p: Palette, withLogin: boolean): Cell {
  const { color, onColor } = plan(self.plan, p)
  return {
    top: [{ text: ` ${name} `, color: onColor, bg: color, bold: true }],
    bottom: withLogin ? loginStatus(self.loginExpiresAt, now, p, { always: true }) : [],
    fill: { color: onColor, bg: color },
  }
}

function plan(name: string, p: Palette): Plan {
  return p.plans[name] ?? p.otherPlan
}

/** 两个号套餐相同时只写 Max 分不清，就在后面带上邮箱前 4 位。 */
function displayNames(self: Account | null, peers: Peer[]): { self: string; peers: string[] } {
  const all = [...(self ? [self] : []), ...peers]
  const count = new Map<string, number>()
  for (const a of all) count.set(a.plan, (count.get(a.plan) ?? 0) + 1)
  const name = (a: Account) =>
    (count.get(a.plan) ?? 0) > 1 && a.email ? `${a.plan}-${a.email.split('@')[0]?.slice(0, 4)}` : a.plan
  return { self: self ? name(self) : '', peers: peers.map(name) }
}

const KIND_ORDER = ['five_hour', 'seven_day']

/**
 * 每个窗口一列：上格 `5h 24%`，下格还有多久重置（`2h13m`）。
 * 快用完时数值和倒计时一起变色；平时倒计时用标签灰，不抢数字。
 * 窗口已过重置时间、之后没有新记录的，上格显示 `-`，不拿过时的数字充数；
 * 下格写"未开始"——新窗口要等这个号下次发消息才开始计时。空状态要说清是什么情况，只摆一个 - 会让人以为坏了。
 */
function windows(limits: Limit[], now: number, p: Palette, o: { peer: boolean; max: number }): Cell[] {
  return [...limits]
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .slice(0, o.max)
    .map(limit => {
      const label: Span = { text: `${limitLabel(limit.kind)} `, color: p.label }
      const at = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
      if (Number.isFinite(at) && at <= now) return { top: [label, { text: '-', color: p.label }], bottom: [{ text: '未开始', color: p.label }] }

      const fraction = limit.percentUsed / 100
      const top: Span[] = [label, { text: `${Math.round(limit.percentUsed)}%`, ...tone(fraction, o.peer ? p.label : p.value, p, !o.peer) }]
      const bottom: Span[] = Number.isFinite(at) ? [{ text: formatCountdown(at - now), color: tone(fraction, p.label, p, false).color }] : []
      return { top, bottom }
    })
}

/** 平时用中性色；到提醒线变黄，到危险线变红（当前号再加粗）。 */
function tone(fraction: number, calm: string, p: Palette, canBold: boolean): Pick<Span, 'color' | 'bold'> {
  if (fraction >= DANGER_AT) return { color: p.danger, bold: canBold }
  if (fraction >= WARN_AT) return { color: p.warn }
  return { color: calm }
}

function rank(kind: string): number {
  const i = KIND_ORDER.indexOf(kind)
  return i === -1 ? KIND_ORDER.length : i
}

/**
 * 登录还剩多久，写在账号正下方，和第二行其他格子"还剩多久"一个意思。
 * 平时灰色，3 天内变黄，1 天内变红，过期写"登录过期"。
 * 当前号一直显示（always）；另一个号是次要信息，只在 3 天内快过期时才出现。
 */
function loginStatus(expiresAt: string | null, now: number, p: Palette, o: { always: boolean }): Span[] {
  if (expiresAt === null) return []
  const left = Date.parse(expiresAt) - now
  if (!Number.isFinite(left)) return []
  if (left <= 0) return [{ text: '登录过期', color: p.danger }]
  if (left < DAY) return [{ text: `登录${Math.ceil(left / HOUR)}h`, color: p.danger }]
  if (left <= LOGIN_WARN_MS) return [{ text: `登录${Math.floor(left / DAY)}d`, color: p.warn }]
  return o.always ? [{ text: `登录${Math.floor(left / DAY)}d`, color: p.label }] : []
}

/**
 * 上下文以自动压缩点为 100%：到 100% 就压缩，和 5h、7d 到 100% 触顶一个意思。
 * 按整个窗口算会误导——压缩点设在 60% 时，显示 32% 其实已经走了一半多。
 * 下格写还剩多少就压缩，和窗口的"还有多久重置"对应；没开自动压缩就按整个窗口算，下格空着。
 */
function context(snap: Snapshot | null, p: Palette): Cell {
  const label: Span = { text: 'ctx ', color: p.label }
  const tokens = snap?.tokens ?? null
  if (snap === null || tokens === null) return only([label, { text: '-', color: p.label }])
  if (snap.threshold === null) {
    const fill = tokens / snap.window
    return only([label, { text: `${Math.round(fill * 100)}%`, ...tone(fill, p.value, p, true) }])
  }
  if (tokens >= snap.threshold) return only([label, { text: '即将压缩', color: p.danger, bold: true }])
  const fraction = tokens / snap.threshold
  return {
    top: [label, { text: `${Math.round(fraction * 100)}%`, ...tone(fraction, p.value, p, true) }],
    bottom: [{ text: `余${formatTokens(snap.threshold - tokens)}`, color: tone(fraction, p.label, p, false).color }],
  }
}

/** token 数读起来短：94K、1.6M。 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(Math.max(0, Math.round(n)))
}

function limitLabel(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind === 'spend_limit') return '限额'
  return kind.replace('seven_day', '7d').replace('five_hour', '5h').replace(/_/g, ' ')
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return '即将'
  const minutes = Math.ceil(ms / 60_000)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  return `${m}m`
}

/** 片段占的终端格数：中文和全角字符算两格。 */
export function widthOf(spans: Span[]): number {
  let cells = 0
  for (const s of spans) {
    for (const ch of s.text) {
      const c = ch.codePointAt(0) ?? 0
      const isWide =
        (c >= 0x1100 && c <= 0x115f) ||
        (c >= 0x2e80 && c <= 0xa4cf) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe4f) ||
        (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6)
      cells += isWide ? 2 : 1
    }
  }
  return cells
}
