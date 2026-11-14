/**
 * dsh-github — Host 半侧
 * ---------------------------------------------------------------------------
 * 在 DeepSeek Harness 里登录 GitHub 并浏览数据。
 *
 * 设计约束（都是踩过的坑）：
 *  1. 只 import node 内置模块。DSH 的 profile node_modules 里没有
 *     @deepseek-ai/* 这些 peer，静态 import 解析失败会让整个插件树
 *     起不来（DSH 启动是全有或全无），所以这里零外部依赖。
 *  2. apply() 整体 try/catch，一个路由注册失败也只降级，绝不拖垮宿主。
 *  3. Token 只存在本机 ~/.dsh/dsh-github/auth.json（0600），永远不回传给浏览器。
 *  4. 所有接口只接受本机同源请求，防止同网段别的机器调你的 token。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-github'

const NS = 'dsh-github'
const BASE = '/plugins/dsh-github'
const VERSION = '1.6.0'
const DEFAULT_API = 'https://api.github.com'
const USER_AGENT = `dsh-github-plugin/${VERSION}`
const TIMEOUT_MS = 20000

/**
 * 配置 schema。宿主（DSH 0.1.7+）按导出进来的 Config 生成插件配置卡，
 * 没有 Config 的插件在「已安装插件」里是不显示的。
 *
 * schemastery 是宿主的 peer 依赖，不一定能解析到 —— 动态导入 + 降级，
 * 拿不到就不导出 Config，绝对不要在模块顶层硬 import（解析失败会拖垮整个
 * 插件树，DSH 启动是全有或全无）。
 */
let Schema = null
try {
  Schema = (await import('@deepseek-ai/schemastery')).default
} catch {
  Schema = null
}

/**
 * 配置 schema。
 *
 * 双重保护：schemastery 不是本包依赖（宿主的 peer），解析不到就降级为
 * undefined；schema API 在不同宿主版本上有差异，构造失败也只降级，绝不
 * 让整个模块导入失败——DSH 启动是全有或全无，导入炸了整个插件树都起不来。
 */
function buildConfigSchema() {
  if (!Schema || typeof Schema.object !== 'function') return undefined
  try {
    return Schema.object({
      clientId: Schema.string()
        .default('')
        .description('GitHub OAuth App 的 Client ID（配置一次，之后可用「使用 GitHub 账号登录」走官方授权流程）'),
      apiBase: Schema.string()
        .default(DEFAULT_API)
        .description('GitHub API 地址。默认 https://api.github.com，国内访问不畅时可换成镜像。'),
      timeoutMs: Schema.number()
        .min(2000)
        .max(120000)
        .step(1000)
        .default(TIMEOUT_MS)
        .description('单次请求超时（毫秒）。'),
    }).description('GitHub 登录与浏览设置')
  } catch {
    return undefined
  }
}

export const Config = buildConfigSchema()

/** 运行环境能力探测（写进 /status，方便排查不同宿主的兼容性） */
const COMPAT = {
  node: typeof process !== 'undefined' ? process.versions?.node ?? '' : '',
  fetch: typeof globalThis.fetch === 'function',
  abortSignal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function',
  inject: true, // apply 时按 ctx 实际能力更新
}

/** 运行时配置（由 apply 从 cordis 配置填入） */
const runtime = { apiBase: DEFAULT_API, timeoutMs: TIMEOUT_MS, clientId: '' }

/** 进行中的设备授权会话；device_code 只留在服务端，不下发浏览器 */
let oauthSession = null

/** 邮箱缓存（按登录名），避免每次打开面板都打一次 /user/emails */
let emailCache = { key: '', primary: '', list: [] }

/* ── 存储 ─────────────────────────────────────────────────────────────────── */

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function authPath() {
  return join(dshHome(), 'dsh-github', 'auth.json')
}

function configPath() {
  return join(dshHome(), 'dsh-github', 'config.json')
}

/** 面板里直接填的 Client ID（不依赖插件配置页，少一步就少一个出错点） */
function readLocalClientId() {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8'))
    const value = typeof parsed?.clientId === 'string' ? parsed.clientId.trim() : ''
    return value
  } catch {
    return ''
  }
}

function writeLocalClientId(clientId) {
  const file = configPath()
  const temporary = `${file}.${process.pid}.tmp`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(temporary, `${JSON.stringify({ version: 1, clientId }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, file)
}

/** 插件配置页填的优先，其次面板里存的 */
function resolveClientId() {
  return runtime.clientId || readLocalClientId()
}

function readAuth() {
  try {
    const parsed = JSON.parse(readFileSync(authPath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : ''
    if (!token) return null
    return {
      token,
      apiBase: normalizeBase(parsed.apiBase),
      login: typeof parsed.login === 'string' ? parsed.login : '',
      savedAt: Number(parsed.savedAt) || 0,
    }
  } catch {
    return null
  }
}

function writeAuth(auth) {
  const file = authPath()
  const temporary = `${file}.${process.pid}.tmp`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(temporary, `${JSON.stringify({ version: 1, ...auth }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, file)
}

function clearAuth() {
  try { unlinkSync(authPath()) } catch {}
}

function normalizeBase(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return DEFAULT_API
  let url
  try { url = new URL(raw) } catch { return DEFAULT_API }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_API
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

function maskToken(token) {
  if (!token) return ''
  if (token.length <= 10) return '••••••'
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

/* ── HTTP 小工具 ─────────────────────────────────────────────────────────── */

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** 只接受本机回环、且 Origin 与 Host 同源的请求。 */
function isLocalRequest(req) {
  const remote = req.socket?.remoteAddress
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false
  if (req.headers?.host) {
    try {
      const host = new URL(`http://${req.headers.host}`)
      if (host.username || host.password) return false
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false
    } catch { return false }
  }
  if (!req.headers?.origin) return true
  try {
    const origin = new URL(req.headers.origin)
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host
  } catch {
    return false
  }
}

async function readJsonBody(req, limit = 16 * 1024) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!bytes) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('请求体不是合法 JSON') }
}

/* ── GitHub API ──────────────────────────────────────────────────────────── */

function describeFailure(r) {
  const message = (r.data && (r.data.message || r.data.error)) || ''
  const remaining = r.headers.get('x-ratelimit-remaining')
  if (r.status === 0) return message || '无法连接 GitHub，请检查网络后重试。'
  if (r.status === 401) return '令牌无效、已过期或被撤销（401）。请重新生成一个令牌。'
  if (r.status === 403 && remaining === '0') {
    const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000
    const when = reset ? new Date(reset).toLocaleTimeString('zh-CN') : '稍后'
    return `接口配额已用完（403），${when} 重置。换一个令牌或等一会儿。`
  }
  if (r.status === 403) return message || 'GitHub 拒绝访问（403）。'
  if (r.status === 404) return '资源不存在，或令牌没有这个仓库的访问权限（404）。'
  if (r.status === 422) return message || '请求参数不合法（422）。'
  if (r.status >= 500) return `GitHub 服务端错误（${r.status}），稍后重试。`
  return message || `GitHub 返回 HTTP ${r.status}`
}

async function callGitHub(pathname, { token, apiBase, method = 'GET', body, timeout = runtime.timeoutMs } = {}) {
  if (!COMPAT.fetch) {
    return {
      ok: false,
      status: 0,
      data: { message: `当前运行时没有全局 fetch（Node ${COMPAT.node || '未知'}）。请把 DeepSeek Harness 升级到内置 Node 18+ 的版本。` },
      headers: new Headers(),
      network: true,
    }
  }
  const base = normalizeBase(apiBase)
  const url = base + pathname
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': USER_AGENT,
  }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'

  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const hint = /abort|timeout/i.test(message)
      ? `连接 ${base} 超时。国内访问 GitHub API 偶尔会慢，重试一次通常就好。`
      : `无法连接 ${base}：${message}。如果是国内网络，请检查网络或在设置里换一个 API 地址。`
    return { ok: false, status: 0, data: { message: hint }, headers: new Headers(), network: true }
  }

  const text = await response.text().catch(() => '')
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = { message: text.slice(0, 400) } }
  }
  return { ok: response.ok, status: response.status, data, headers: response.headers, network: false }
}

function publicUser(user) {
  if (!user || typeof user !== 'object') return null
  return {
    login: user.login,
    name: user.name || '',
    avatar_url: user.avatar_url || '',
    html_url: user.html_url || '',
    bio: user.bio || '',
    company: user.company || '',
    location: user.location || '',
    public_repos: user.public_repos ?? null,
    followers: user.followers ?? null,
    following: user.following ?? null,
    created_at: user.created_at || '',
  }
}

function pickRepo(repo) {
  if (!repo || typeof repo !== 'object') return null
  return {
    id: repo.id,
    full_name: repo.full_name,
    name: repo.name,
    owner: repo.owner?.login || '',
    private: repo.private === true,
    description: repo.description || '',
    html_url: repo.html_url || '',
    language: repo.language || '',
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    open_issues: repo.open_issues_count ?? 0,
    updated_at: repo.updated_at || '',
    pushed_at: repo.pushed_at || '',
    default_branch: repo.default_branch || '',
  }
}

function pickIssue(item) {
  if (!item || typeof item !== 'object') return null
  return {
    id: item.id,
    number: item.number,
    title: item.title || '',
    state: item.state || '',
    is_pr: Boolean(item.pull_request),
    html_url: item.html_url || '',
    comments: item.comments ?? 0,
    created_at: item.created_at || '',
    updated_at: item.updated_at || '',
    user: item.user?.login || '',
    repo: item.repository_url ? String(item.repository_url).replace('https://api.github.com/repos/', '') : '',
    labels: Array.isArray(item.labels)
      ? item.labels.map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean).slice(0, 6)
      : [],
  }
}

function pickNotification(item) {
  if (!item || typeof item !== 'object') return null
  const latest = item.subject?.latest_comment_url
  return {
    id: item.id,
    unread: item.unread === true,
    reason: item.reason || '',
    title: item.subject?.title || '',
    type: item.subject?.type || '',
    repo: item.repository?.full_name || '',
    updated_at: item.updated_at || '',
    html_url: latest
      ? String(latest).replace('https://api.github.com/repos/', 'https://github.com/').replace('/pulls/', '/pull/')
      : '',
  }
}

function rateInfo(headers) {
  return {
    limit: Number(headers.get('x-ratelimit-limit')) || null,
    remaining: Number(headers.get('x-ratelimit-remaining')) || 0,
    reset: Number(headers.get('x-ratelimit-reset')) || 0,
    scopes: headers.get('x-oauth-scopes') || '',
  }
}

/* ── 路由 ───────────────────────────────────────────────────────────────── */

function query(req) {
  return new URL(req.url || '/', 'http://dsh.local').searchParams
}

/* 客户端半侧加载过的证据：界面看不到时用它判断 bundle 到底跑没跑 */
let clientHello = null

function makeHandlers() {
  const requireAuth = () => {
    const auth = readAuth()
    if (!auth) return { auth: null, failure: { ok: false, error: '尚未登录 GitHub' } }
    return { auth, failure: null }
  }

  const status = async (req, res) => {
    const auth = readAuth()
    const body = {
      ok: true,
      app: NS,
      version: VERSION,
      loggedIn: Boolean(auth),
      apiBase: auth?.apiBase || runtime.apiBase,
      maskedToken: auth ? maskToken(auth.token) : '',
      savedAt: auth?.savedAt || 0,
      user: null,
      session: null,
      client: clientHello,
      clientIdConfigured: Boolean(resolveClientId()),
      compat: {
        ...COMPAT,
        schema: Boolean(Config),
        version: VERSION,
      },
    }
    if (auth && query(req).get('probe') === '1') {
      const result = await callGitHub('/user', auth)
      if (result.ok) {
        body.user = publicUser(result.data)
        body.session = rateInfo(result.headers)
      } else {
        body.session = { error: describeFailure(result) }
      }
    }
    json(res, 200, body)
  }

  const login = async (req, res) => {
    let payload
    try { payload = await readJsonBody(req) } catch (error) { return json(res, 400, { ok: false, error: error.message }) }
    const token = String(payload?.token ?? '').trim()
    if (!token) return json(res, 400, { ok: false, error: '请填写 GitHub 令牌' })
    if (token.length < 20 || /\s/.test(token)) return json(res, 400, { ok: false, error: '令牌格式不对（不应包含空格，长度至少 20）' })

    const apiBase = normalizeBase(payload?.apiBase || runtime.apiBase)
    const result = await callGitHub('/user', { token, apiBase })
    if (!result.ok) return json(res, 401, { ok: false, error: describeFailure(result) })

    const user = publicUser(result.data)
    try {
      writeAuth({ token, apiBase, login: user?.login || '', savedAt: Date.now() })
    } catch (error) {
      return json(res, 500, { ok: false, error: `令牌校验通过，但写入本地失败：${error.message}` })
    }
    json(res, 200, {
      ok: true,
      user,
      apiBase,
      maskedToken: maskToken(token),
      session: rateInfo(result.headers),
    })
  }

  const logout = async (req, res) => {
    clearAuth()
    emailCache = { key: '', primary: '', list: [] }
    json(res, 200, { ok: true })
  }

  const me = async (req, res) => {
    const { auth, failure } = requireAuth()
    if (failure) return json(res, 401, failure)
    const result = await callGitHub('/user', auth)
    if (!result.ok) return json(res, 502, { ok: false, error: describeFailure(result) })
    json(res, 200, { ok: true, user: publicUser(result.data), session: rateInfo(result.headers) })
  }

  /**
   * 账号邮箱。GitHub 没有「邮箱 + 密码」这种第三方登录接口（一律走 OAuth），
   * 邮箱只能作为账号信息读取：主邮箱 + 全部已验证邮箱。
   * 需要 user:email 权限；没有权限时返回空并给出原因，不当作错误。
   */
  const emails = async (req, res) => {
    const { auth, failure } = requireAuth()
    if (failure) return json(res, 401, failure)
    const cacheKey = auth.login || ''
    if (emailCache.key && emailCache.key === cacheKey && emailCache.primary) {
      return json(res, 200, { ok: true, primary: emailCache.primary, emails: emailCache.list, cached: true })
    }
    const result = await callGitHub('/user/emails?per_page=100', auth)
    if (!result.ok) {
      const hint = result.status === 403 || result.status === 404
        ? '当前令牌没有 user:email 权限，重新授权一次即可读取邮箱。'
        : describeFailure(result)
      return json(res, 200, { ok: true, primary: '', emails: [], error: hint })
    }
    const list = (Array.isArray(result.data) ? result.data : [])
      .filter((row) => row && typeof row.email === 'string')
      .map((row) => ({ email: row.email, primary: row.primary === true, verified: row.verified === true }))
    const primary = (list.find((row) => row.primary) || list.find((row) => row.verified) || list[0] || {}).email || ''
    emailCache = { key: cacheKey, primary, list }
    json(res, 200, { ok: true, primary, emails: list })
  }

  const repos = async (req, res) => {
    const { auth, failure } = requireAuth()
    if (failure) return json(res, 401, failure)
    const params = query(req)
    const page = Math.max(1, Number(params.get('page')) || 1)
    const perPage = Math.min(50, Math.max(1, Number(params.get('per_page')) || 30))
    const sort = ['updated', 'pushed', 'created', 'full_name'].includes(params.get('sort')) ? params.get('sort') : 'updated'
    const result = await callGitHub(`/user/repos?per_page=${perPage}&page=${page}&sort=${sort}&affiliation=owner,collaborator,organization_member`, auth)
    if (!result.ok) return json(res, 502, { ok: false, error: describeFailure(result) })
    json(res, 200, {
      ok: true,
      page,
      hasMore: Array.isArray(result.data) && result.data.length === perPage,
      items: (result.data || []).map(pickRepo).filter(Boolean),
      session: rateInfo(result.headers),
    })
  }

  const starred = async (req, res) => {
    const { auth, failure } = requireAuth()
    if (failure) return json(res, 401, failure)
    const params = query(req)
    const page = Math.max(1, Number(params.get('page')) || 1)
    const perPage = Math.min(50, Math.max(1, Number(params.get('per_page')) || 30))
    const result = await callGitHub(`/user/starred?per_page=${perPage}&page=${page}`, auth)
    if (!result.ok) return json(res, 502, { ok: false, error: describeFailure(result) })
    json(res, 200, {
      ok: true,
      page,
      hasMore: Array.isArray(result.data) && result.data.length === perPage,
      items: (result.data || []).map(pickRepo).filter(Boolean),
      session: rateInfo(result.headers),
    })
  }

  const notifications = async (req, res) => {
    const { auth, failure } = requireAuth()
    if (failure) return json(res, 401, failure)
    const all = query(req).get('all') === '1' ? 'true' : 'false'
    const result = await callGitHub(`/notifications?all=${all}&per_page=50`, auth)
    if (!result.ok) return json(res, 502, { ok: false, error: describeFailure(result) })
    json(res, 200, {
      ok: true,
      items: (result.data || []).map(pickNotification).filter(Boolean),
      session: rateInfo(result.headers),
    })
  }

  const issues = async (req, res) => {
    const { auth, failure } = requireAuth()
    if (failure) return json(res, 401, failure)
    const params = query(req)
    const filter = ['assigned', 'created', 'mentioned', 'subscribed', 'all'].includes(params.get('filter')) ? params.get('filter') : 'assigned'
    const state = ['open', 'closed', 'all'].includes(params.get('state')) ? params.get('state') : 'open'
    const result = await callGitHub(`/issues?filter=${filter}&state=${state}&per_page=50&sort=updated`, auth)
    if (!result.ok) return json(res, 502, { ok: false, error: describeFailure(result) })
    json(res, 200, {
      ok: true,
      filter,
      items: (result.data || []).map(pickIssue).filter(Boolean),
      session: rateInfo(result.headers),
    })
  }

  const search = async (req, res) => {
    const { auth, failure } = requireAuth()
    if (failure) return json(res, 401, failure)
    const params = query(req)
    const term = String(params.get('q') || '').trim()
    if (!term) return json(res, 400, { ok: false, error: '请输入搜索关键词' })
    const type = ['repositories', 'issues', 'users'].includes(params.get('type')) ? params.get('type') : 'repositories'
    const result = await callGitHub(`/search/${type}?q=${encodeURIComponent(term.slice(0, 256))}&per_page=30`, auth)
    if (!result.ok) return json(res, 502, { ok: false, error: describeFailure(result) })
    const items = Array.isArray(result.data?.items) ? result.data.items : []
    const mapped = type === 'repositories'
      ? items.map(pickRepo).filter(Boolean)
      : type === 'issues'
        ? items.map(pickIssue).filter(Boolean)
        : items.map((user) => ({ login: user.login, avatar_url: user.avatar_url, html_url: user.html_url, type: user.type }))
    json(res, 200, { ok: true, type, total: result.data?.total_count ?? mapped.length, items: mapped, session: rateInfo(result.headers) })
  }

  const rate = async (req, res) => {
    const { auth, failure } = requireAuth()
    if (failure) return json(res, 401, failure)
    const result = await callGitHub('/rate_limit', auth)
    if (!result.ok) return json(res, 502, { ok: false, error: describeFailure(result) })
    json(res, 200, { ok: true, data: result.data })
  }

  /** 浏览器半侧加载成功时打一个点，用来确认 bundle 真的跑起来了。 */
  const hello = async (req, res) => {
    let payload = {}
    try { payload = await readJsonBody(req, 4096) } catch { payload = {} }
    clientHello = {
      at: Date.now(),
      version: String(payload?.version ?? '').slice(0, 32),
      mode: String(payload?.mode ?? '').slice(0, 32),
      ua: String(req.headers?.['user-agent'] ?? '').slice(0, 120),
    }
    json(res, 200, { ok: true, server: VERSION, client: clientHello })
  }

  /* ── OAuth 设备授权（GitHub 官方登录流程，GitHub Desktop 同款）────────── */

  const DEVICE_CODE_URL = 'https://github.com/login/device/code'
  const TOKEN_URL = 'https://github.com/login/oauth/access_token'
  const DEVICE_SCOPES = 'repo read:user user:email notifications'

  async function postForm(url, form) {
    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': USER_AGENT,
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(runtime.timeoutMs),
      })
    } catch (error) {
      return { ok: false, status: 0, data: { error_description: error instanceof Error ? error.message : String(error) } }
    }
    const text = await response.text().catch(() => '')
    let data = null
    try { data = JSON.parse(text) } catch { data = { error_description: text.slice(0, 300) } }
    return { ok: response.ok, status: response.status, data }
  }

  /** 面板里保存 Client ID（一次性配置） */
  const oauthClientId = async (req, res) => {
    let payload = {}
    try { payload = await readJsonBody(req, 4096) } catch { payload = {} }
    const clientId = String(payload?.clientId ?? '').trim()
    if (!/^[A-Za-z0-9._-]{10,80}$/.test(clientId)) {
      return json(res, 400, { ok: false, error: 'Client ID 看起来不对：应该是 I 开头的一串字母数字，长度 10 以上' })
    }
    try {
      writeLocalClientId(clientId)
    } catch (error) {
      return json(res, 500, { ok: false, error: `保存失败：${error.message}` })
    }
    // 面板里保存是权威的：覆盖插件配置带进来的值，避免旧值继续生效
    runtime.clientId = clientId
    json(res, 200, { ok: true, clientIdConfigured: true })
  }

  const oauthStart = async (req, res) => {
    let payload = {}
    try { payload = await readJsonBody(req, 4096) } catch { payload = {} }
    const fromBody = String(payload?.clientId ?? '').trim()
    if (fromBody) {
      try { writeLocalClientId(fromBody) } catch { /* 存不下来也能本次用 */ }
    }
    const clientId = fromBody || resolveClientId()
    if (!clientId) {
      return json(res, 400, {
        ok: false,
        needsClientId: true,
        error: '还没有配置 OAuth App 的 Client ID。在下面的引导里填一个即可，只需一次。',
      })
    }
    const result = await postForm(DEVICE_CODE_URL, { client_id: clientId, scope: DEVICE_SCOPES })
    if (!result.ok || !result.data?.device_code) {
      const raw = result.data?.error_description || result.data?.error || `HTTP ${result.status}`
      const message = /not\s*found|invalid_client/i.test(String(raw))
        ? 'Client ID 无效或不存在。请确认填的是 OAuth App 的 Client ID（I 开头），不是 App ID、也不是 Client Secret。'
        : raw
      return json(res, 502, { ok: false, error: `无法开始 GitHub 授权：${message}` })
    }
    const interval = Math.max(3, Number(result.data.interval) || 5)
    oauthSession = {
      clientId,
      deviceCode: result.data.device_code,
      userCode: result.data.user_code,
      verificationUri: result.data.verification_uri || 'https://github.com/login/device',
      expiresAt: Date.now() + (Number(result.data.expires_in) || 900) * 1000,
      interval,
      nextPollAt: 0,
    }
    json(res, 200, {
      ok: true,
      state: 'pending',
      userCode: oauthSession.userCode,
      verificationUri: oauthSession.verificationUri,
      expiresIn: Math.round((oauthSession.expiresAt - Date.now()) / 1000),
      interval,
    })
  }

  const oauthPoll = async (req, res) => {
    if (!oauthSession) return json(res, 200, { ok: false, state: 'idle', error: '没有进行中的授权' })
    if (Date.now() > oauthSession.expiresAt) {
      oauthSession = null
      return json(res, 200, { ok: false, state: 'expired', error: '验证码已过期，请重新开始授权' })
    }
    if (Date.now() < oauthSession.nextPollAt) {
      return json(res, 200, { ok: true, state: 'pending', interval: oauthSession.interval })
    }

    const result = await postForm(TOKEN_URL, {
      client_id: oauthSession.clientId,
      device_code: oauthSession.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
    const data = result.data || {}

    if (data.access_token) {
      const token = String(data.access_token)
      const userResult = await callGitHub('/user', { token, apiBase: runtime.apiBase })
      if (!userResult.ok) {
        oauthSession = null
        return json(res, 502, { ok: false, state: 'error', error: describeFailure(userResult) })
      }
      const user = publicUser(userResult.data)
      try {
        writeAuth({ token, apiBase: runtime.apiBase, login: user?.login || '', savedAt: Date.now() })
      } catch (error) {
        oauthSession = null
        return json(res, 500, { ok: false, state: 'error', error: `授权成功，但写入本地失败：${error.message}` })
      }
      const session = rateInfo(userResult.headers)
      oauthSession = null
      return json(res, 200, {
        ok: true,
        state: 'authorized',
        user,
        apiBase: runtime.apiBase,
        maskedToken: maskToken(token),
        session,
      })
    }

    const error = String(data.error || '')
    if (error === 'authorization_pending') {
      oauthSession.nextPollAt = Date.now() + oauthSession.interval * 1000
      return json(res, 200, { ok: true, state: 'pending', interval: oauthSession.interval })
    }
    if (error === 'slow_down') {
      oauthSession.interval = Math.min(30, oauthSession.interval + 5)
      oauthSession.nextPollAt = Date.now() + oauthSession.interval * 1000
      return json(res, 200, { ok: true, state: 'pending', interval: oauthSession.interval })
    }

    oauthSession = null
    if (error === 'expired_token') return json(res, 200, { ok: false, state: 'expired', error: '验证码已过期，请重新开始授权' })
    if (error === 'access_denied') return json(res, 200, { ok: false, state: 'denied', error: '你在 GitHub 页面上取消了授权' })
    return json(res, 200, { ok: false, state: 'error', error: data.error_description || error || `HTTP ${result.status}` })
  }

  const oauthCancel = async (req, res) => {
    oauthSession = null
    json(res, 200, { ok: true })
  }

  return {
    status, login, logout, me, repos, starred, notifications, issues, search, rate, hello,
    oauthStart, oauthPoll, oauthCancel, oauthClientId, emails,
  }
}

/** 包一层：任何 handler 抛错都变成 JSON 500，不要让异常冒到宿主。 */
function guarded(fn) {
  return async (req, res) => {
    try {
      if (!isLocalRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
      await fn(req, res)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try { json(res, 500, { ok: false, error: message }) } catch {}
    }
  }
}

/**
 * 真正注册路由。
 *
 * 只在 webServer 就绪后调用 —— 宿主启动时插件的 apply 可能早于 web 服务，
 * 那时拿不到 webServer，如果直接 return 就变成「插件 live 但一条路由都没有」，
 * 表现为接口全 404。这是启动顺序竞态，必须靠 ctx.inject 等，不能靠运气。
 */
function mountRoutes(ctx) {
  let webServer
  try {
    webServer = (typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined) || ctx?.webServer
  } catch {
    webServer = ctx?.webServer
  }
  if (!webServer || typeof webServer.register !== 'function') {
    try { ctx?.logger?.warn?.(`[${NS}] webServer 仍不可用，接口未注册`) } catch {}
    return
  }

  const handlers = makeHandlers()
  const routes = [
    ['/status', handlers.status, ['GET']],
    ['/login', handlers.login, ['POST']],
    ['/logout', handlers.logout, ['POST']],
    ['/me', handlers.me, ['GET']],
    ['/emails', handlers.emails, ['GET']],
    ['/repos', handlers.repos, ['GET']],
    ['/starred', handlers.starred, ['GET']],
    ['/notifications', handlers.notifications, ['GET']],
    ['/issues', handlers.issues, ['GET']],
    ['/search', handlers.search, ['GET']],
    ['/rate', handlers.rate, ['GET']],
    ['/hello', handlers.hello, ['POST']],
    ['/oauth/start', handlers.oauthStart, ['POST']],
    ['/oauth/poll', handlers.oauthPoll, ['GET']],
    ['/oauth/cancel', handlers.oauthCancel, ['POST']],
    ['/oauth/client-id', handlers.oauthClientId, ['POST']],
  ]

  const dispose = []
  for (const [suffix, handler, methods] of routes) {
    const spec = {
      kind: 'exact',
      path: BASE + suffix,
      handler: (req, res) => {
        if (req.method && !methods.includes(req.method)) {
          res.writeHead(405, { allow: methods.join(', ') })
          res.end()
          return
        }
        return guarded(handler)(req, res)
      },
    }
    try {
      const off = webServer.register(spec)
      if (typeof off === 'function') dispose.push(off)
    } catch (error) {
      try { ctx?.logger?.warn?.(`[${NS}] 路由 ${suffix} 注册失败：${error?.message || error}`) } catch {}
    }
  }

  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => {
      for (const off of dispose) { try { off() } catch {} }
    }, `${NS}: routes`)
  }

  try { ctx?.logger?.info?.(`[${NS}] v${VERSION} 已挂载 ${dispose.length}/${routes.length} 个接口`) } catch {}
}

export function apply(ctx, config = {}) {
  try {
    try {
      if (config && typeof config === 'object') {
        runtime.apiBase = normalizeBase(config.apiBase || runtime.apiBase)
        const t = Number(config.timeoutMs)
        if (Number.isFinite(t) && t >= 2000) runtime.timeoutMs = Math.min(120000, t)
        if (typeof config.clientId === 'string') runtime.clientId = config.clientId.trim()
      }
    } catch { /* 配置非法就沿用默认值 */ }

    if (typeof ctx?.inject === 'function') {
      COMPAT.inject = true
      // 等 webServer 就绪；宿主先启动 web 还是先挂插件都不影响
      ctx.inject(['webServer'], (httpCtx) => {
        try { mountRoutes(httpCtx) } catch (error) {
          try { ctx?.logger?.error?.(`[${NS}] 路由挂载失败：${error?.message || error}`) } catch {}
        }
      })
      return
    }

    // 没有 ctx.inject 的宿主：退化为直接挂
    COMPAT.inject = false
    mountRoutes(ctx)
  } catch (error) {
    try { ctx?.logger?.error?.(`[${NS}] 初始化失败：${error?.message || error}`) } catch {}
  }
}

// 供离线自测使用的内部导出（不影响插件契约）
export const __internals = { normalizeBase, maskToken, describeFailure, authPath }
