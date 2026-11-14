/**
 * dsh-github — Web 半侧（手写 ModuleLoader bundle，无需构建）
 * ---------------------------------------------------------------------------
 * 界面参考 GitHub Desktop：顶部工具栏 + 左侧导航栏 + 右侧内容区。
 * 全中文文案。
 *
 * 约定（照抄 dsh-startup-secret 的可用写法）：
 *  - window.__ModuleLoader__.load({ id, factory }) 的 id 必须等于 loader entry 名
 *  - 只 require('react')，其余全部走 Host 的 HTTP 接口
 *  - exports = { name, inject: ['slots'], apply }
 */
window.__ModuleLoader__.load({
  id: 'dsh-github',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    var API = '/plugins/dsh-github'
    var TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,read:user,user:email,notifications&description=DeepSeek%20Harness'

    /* ── 配色（Primer / GitHub Desktop）────────────────────────────────── */
    var THEMES = {
      dark: {
        bg: '#0d1117',
        elevated: '#161b22',
        sidebar: '#0d1117',
        border: '#30363d',
        borderMuted: '#21262d',
        fg: '#e6edf3',
        muted: '#8b949e',
        accent: '#2f81f7',
        accentSubtle: 'rgba(56,139,253,0.15)',
        hover: 'rgba(177,186,196,0.12)',
        success: '#3fb950',
        danger: '#f85149',
        attention: '#d29922',
        pill: 'rgba(110,118,129,0.4)',
      },
      light: {
        bg: '#ffffff',
        elevated: '#f6f8fa',
        sidebar: '#f6f8fa',
        border: '#d0d7de',
        borderMuted: '#eaeef2',
        fg: '#1f2328',
        muted: '#656d76',
        accent: '#0969da',
        accentSubtle: 'rgba(9,105,218,0.08)',
        hover: 'rgba(208,215,222,0.32)',
        success: '#1a7f37',
        danger: '#cf222e',
        attention: '#9a6700',
        pill: 'rgba(175,184,193,0.2)',
      },
    }

    function detectDark() {
      try {
        var el = document.body || document.documentElement
        var bg = getComputedStyle(el).backgroundColor
        var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg || '')
        if (m) {
          var luma = (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255
          return luma < 0.45
        }
      } catch (e) { /* ignore */ }
      try { return matchMedia('(prefers-color-scheme: dark)').matches } catch (e) { return true }
    }

    /* ── 图标（Octicons 16px）──────────────────────────────────────────── */
    var ICONS = {
      repo: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z',
      star: 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z',
      bell: 'M8 16a2 2 0 0 0 1.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 0 0 8 16ZM3 5a5 5 0 0 1 10 0v2.947c0 .05.015.098.042.139l1.703 2.555A1.519 1.519 0 0 1 13.482 13H2.518a1.516 1.516 0 0 1-1.263-2.36l1.703-2.554A.255.255 0 0 0 3 7.947Zm5-3.5A3.5 3.5 0 0 0 4.5 5v2.947c0 .346-.102.683-.294.97l-1.703 2.556a.017.017 0 0 0-.003.01l.001.006c0 .002.002.004.004.006l.006.004.007.001h10.964l.007-.001.006-.004.004-.006.001-.007a.017.017 0 0 0-.003-.01l-1.703-2.554a1.745 1.745 0 0 1-.294-.97V5A3.5 3.5 0 0 0 8 1.5Z',
      issue: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z',
      pr: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
      search: 'M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z',
      sync: 'M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z',
      signout: 'M2 2.75C2 1.784 2.784 1 3.75 1h2.5a.75.75 0 0 1 0 1.5h-2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h2.5a.75.75 0 0 1 0 1.5h-2.5A1.75 1.75 0 0 1 2 13.25Zm10.44 4.5-1.97-1.97a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.97-1.97H6.75a.75.75 0 0 1 0-1.5Z',
      lock: 'M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 2.5h-8.5c-.138 0-.25.112-.25.25v5.5c0 .138.112.25.25.25h8.5c.138 0 .25-.112.25-.25v-5.5c0-.138-.112-.25-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z',
      external: 'M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z',
    }

    function Icon(props) {
      var size = props.size || 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor',
        'aria-hidden': 'true', style: { flex: '0 0 auto', display: 'block' },
      }, h('path', { d: ICONS[props.name] || ICONS.repo }))
    }

    /* ── 样式 ──────────────────────────────────────────────────────────── */
    function buildCss() {
      var base = [
        '.__ghd_wrap{padding:0}',
        '.__ghd_root{--b:var(--gh-border);--m:var(--gh-border-muted);display:flex;flex-direction:column;border:1px solid var(--b);border-radius:8px;overflow:hidden;background:var(--gh-bg);color:var(--gh-fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;font-size:15px;max-width:1080px;line-height:1.5}',
        '.__ghd_toolbar{display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--gh-elevated);border-bottom:1px solid var(--b);flex-wrap:wrap}',
        '.__ghd_brand{display:flex;align-items:center;gap:7px;font-weight:600;font-size:15px;padding-right:4px}',
        '.__ghd_pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--b);background:var(--gh-bg);border-radius:6px;padding:4px 10px;font-size:14px;color:var(--gh-fg);cursor:pointer;max-width:260px}',
        '.__ghd_pill:hover:not(:disabled){border-color:var(--gh-accent)}',
        '.__ghd_pill:disabled{opacity:.6;cursor:default}',
        '.__ghd_spacer{flex:1 1 auto}',
        '.__ghd_body{display:flex;min-height:640px;max-height:820px}',
        '.__ghd_side{width:244px;flex:0 0 244px;background:var(--gh-sidebar);border-right:1px solid var(--b);display:flex;flex-direction:column;padding:8px 8px 0;overflow:auto}',
        '.__ghd_navItem{display:flex;align-items:center;gap:8px;padding:11px 13px;border-radius:6px;cursor:pointer;color:var(--gh-fg);border:none;background:none;text-align:left;font:inherit;font-size:15px;width:100%}',
        '.__ghd_navItem:hover{background:var(--gh-hover)}',
        '.__ghd_navItemOn{background:var(--gh-accentSubtle);font-weight:600;color:var(--gh-accent)}',
        '.__ghd_navCount{margin-left:auto;font-size:13px;color:var(--gh-muted);font-variant-numeric:tabular-nums}',
        '.__ghd_sideFoot{margin-top:auto;border-top:1px solid var(--m);padding:10px 4px;display:flex;flex-direction:column;gap:8px}',
        '.__ghd_account{display:flex;align-items:center;gap:8px;min-width:0}',
        '.__ghd_avatar{width:38px;height:38px;border-radius:50%;border:1px solid var(--b);flex:0 0 auto;object-fit:cover}',
        '.__ghd_acctText{min-width:0;display:flex;flex-direction:column}',
        '.__ghd_acctName{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.__ghd_acctSub{font-size:13px;color:var(--gh-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.__ghd_main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;background:var(--gh-bg)}',
        '.__ghd_mainHead{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--m);flex-wrap:wrap}',
        '.__ghd_h{font-size:15px;font-weight:600}',
        '.__ghd_sub{font-size:13px;color:var(--gh-muted)}',
        '.__ghd_filter{display:flex;align-items:center;gap:6px;border:1px solid var(--b);border-radius:6px;padding:5px 10px;background:var(--gh-bg);min-width:150px;flex:1 1 150px;max-width:260px}',
        '.__ghd_filter input{border:none;outline:none;background:transparent;color:var(--gh-fg);font:inherit;font-size:14px;width:100%;padding:2px 0}',
        '.__ghd_list{overflow:auto;flex:1 1 auto}',
        '.__ghd_row{display:flex;gap:10px;padding:14px 18px;border-bottom:1px solid var(--m);align-items:flex-start}',
        '.__ghd_row:last-child{border-bottom:none}',
        '.__ghd_row:hover{background:var(--gh-hover)}',
        '.__ghd_rowIcon{color:var(--gh-muted);margin-top:2px}',
        '.__ghd_rowBody{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
        '.__ghd_rowTop{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
        '.__ghd_name{font-weight:600;font-size:15px;color:var(--gh-accent);text-decoration:none;word-break:break-word}',
        '.__ghd_name:hover{text-decoration:underline}',
        '.__ghd_plain{font-weight:600;font-size:15px;color:var(--gh-fg);word-break:break-word}',
        '.__ghd_desc{font-size:14px;color:var(--gh-muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
        '.__ghd_meta{display:flex;gap:10px;flex-wrap:wrap;font-size:13px;color:var(--gh-muted);font-variant-numeric:tabular-nums}',
        '.__ghd_tag{font-size:12px;line-height:1.6;padding:0 6px;border-radius:999px;border:1px solid var(--b);color:var(--gh-muted);white-space:nowrap}',
        '.__ghd_tagOpen{color:var(--gh-success);border-color:var(--gh-success)}',
        '.__ghd_tagPr{color:var(--gh-accent);border-color:var(--gh-accent)}',
        '.__ghd_tagUnread{color:var(--gh-attention);border-color:var(--gh-attention)}',
        '.__ghd_empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:64px 18px;color:var(--gh-muted);font-size:14px;text-align:center}',
        '.__ghd_err{margin:12px;padding:8px 10px;border:1px solid var(--gh-danger);border-radius:6px;color:var(--gh-danger);font-size:14px;line-height:1.5;word-break:break-word}',
        '.__ghd_btn{border:1px solid var(--b);background:var(--gh-elevated);color:var(--gh-fg);border-radius:6px;padding:8px 18px;font:inherit;font-size:14px;cursor:pointer}',
        '.__ghd_btn:hover:not(:disabled){border-color:var(--gh-accent)}',
        '.__ghd_btn:disabled{opacity:.55;cursor:default}',
        '.__ghd_btnPrimary{border-color:var(--gh-accent);background:var(--gh-accent);color:#fff}',
        '.__ghd_form{display:flex;flex-direction:column;gap:12px;padding:30px;max-width:860px}',
        '.__ghd_h2{font-size:18px;font-weight:600;display:flex;align-items:center;gap:8px}',
        '.__ghd_para{font-size:14px;color:var(--gh-muted);line-height:1.65}',
        '.__ghd_field{display:flex;flex-direction:column;gap:5px}',
        '.__ghd_label{font-size:14px;font-weight:600}',
        '.__ghd_input{border:1px solid var(--b);background:var(--gh-elevated);color:var(--gh-fg);border-radius:6px;padding:12px 16px;font:inherit;font-size:15px;outline:none;width:100%;box-sizing:border-box}',
        '.__ghd_input:focus{border-color:var(--gh-accent);box-shadow:0 0 0 3px var(--gh-accentSubtle)}',
        '.__ghd_mono{font-family:ui-monospace,SFMono-Regular,"Cascadia Mono",Consolas,monospace;font-size:14px}',
        '.__ghd_link{color:var(--gh-accent);text-decoration:none;font-size:14px;cursor:pointer}',
        '.__ghd_link:hover{text-decoration:underline}',
        '.__ghd_foot{display:flex;align-items:center;gap:8px;padding:7px 12px;border-top:1px solid var(--m);background:var(--gh-elevated);font-size:13px;color:var(--gh-muted);flex-wrap:wrap}',
      ]
      return base.join('\n')
    }

    function vars(theme) {
      return {
        '--gh-bg': theme.bg,
        '--gh-elevated': theme.elevated,
        '--gh-sidebar': theme.sidebar,
        '--gh-border': theme.border,
        '--gh-border-muted': theme.borderMuted,
        '--gh-fg': theme.fg,
        '--gh-muted': theme.muted,
        '--gh-accent': theme.accent,
        '--gh-accentSubtle': theme.accentSubtle,
        '--gh-hover': theme.hover,
        '--gh-success': theme.success,
        '--gh-danger': theme.danger,
        '--gh-attention': theme.attention,
      }
    }

    var CSS = buildCss()
    var tagId = 'dsh-github/main.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      var styleTag = document.createElement('style')
      styleTag.dataset.plugin = 'dsh-github'
      styleTag.dataset.pluginCss = tagId
      styleTag.textContent = CSS
      document.head.appendChild(styleTag)
    }

    /* ── 自检：告诉 Host 半侧「浏览器这一侧确实跑起来了」───────────────── */
    try {
      fetch(API + '/hello', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: '1.6.0', mode: 'web' }),
        keepalive: true,
      }).catch(function () { /* 自检失败不影响界面 */ })
    } catch (e) { /* ignore */ }

    /* ── HTTP ──────────────────────────────────────────────────────────── */
    async function api(path, options) {
      var response = await fetch(API + path, Object.assign({ cache: 'no-store' }, options || {}))
      var payload = null
      try { payload = await response.json() } catch (e) { payload = null }
      if (!response.ok || (payload && payload.ok === false)) {
        var message = (payload && (payload.error || payload.message)) || ('请求失败（HTTP ' + response.status + '）')
        throw new Error(message)
      }
      return payload
    }

    function postJson(path, body) {
      return api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
    }

    /* ── 工具 ──────────────────────────────────────────────────────────── */
    function timeAgo(iso) {
      if (!iso) return ''
      var t = Date.parse(iso)
      if (!t) return ''
      var diff = Date.now() - t
      if (diff < 0) return '刚刚'
      var minute = 60000, hour = 60 * minute, day = 24 * hour
      if (diff < minute) return '刚刚'
      if (diff < hour) return Math.floor(diff / minute) + ' 分钟前'
      if (diff < day) return Math.floor(diff / hour) + ' 小时前'
      if (diff < 30 * day) return Math.floor(diff / day) + ' 天前'
      return new Date(t).toLocaleDateString('zh-CN')
    }

    function fmtNum(n) {
      if (n === null || n === undefined) return '0'
      if (n < 1000) return String(n)
      if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + ' 千'
      if (n < 100000000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万'
      return (n / 100000000).toFixed(1).replace(/\.0$/, '') + ' 亿'
    }

    function tag(kind, text) {
      var suffix = kind === 'open' ? ' __ghd_tagOpen' : kind === 'pr' ? ' __ghd_tagPr' : kind === 'unread' ? ' __ghd_tagUnread' : ''
      return h('span', { className: '__ghd_tag' + suffix }, text)
    }

    function Link(props) {
      return h('a', {
        className: props.className || '__ghd_name',
        href: props.href,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: props.title || props.href,
      }, props.children)
    }

    function Btn(props) {
      return h('button', {
        type: 'button',
        className: '__ghd_btn' + (props.primary ? ' __ghd_btnPrimary' : ''),
        disabled: props.disabled,
        onClick: props.onClick,
        title: props.title,
      }, props.children)
    }

    function IconBtn(props) {
      return h('button', {
        type: 'button',
        className: '__ghd_pill',
        disabled: props.disabled,
        onClick: props.onClick,
        title: props.title || props.children,
      }, h(Icon, { name: props.name, size: 14 }), h('span', null, props.children))
    }

    /* ── 登录卡 ────────────────────────────────────────────────────────── */
    /**
     * 登录用 GitHub 官方的设备授权流程（OAuth Device Flow）：
     * 点登录 → 服务端拿到 8 位验证码 → 浏览器打开 github.com/login/device 输入
     * → 服务端轮询换取 access_token。和 GitHub Desktop 是同一套机制，
     * 全程不需要用户手动生成或粘贴令牌。
     *
     * 令牌方式保留为兜底，折叠在下面。
     */
    function LoginView(props) {
      var [phase, setPhase] = React.useState('idle') // idle | starting | waiting | authorized | error
      var [flow, setFlow] = React.useState(null)     // { userCode, verificationUri, expiresIn, interval }
      var [error, setError] = React.useState('')
      var [patOpen, setPatOpen] = React.useState(false)
      var [token, setToken] = React.useState('')
      var [busy, setBusy] = React.useState(false)
      var timerRef = React.useRef(null)

      var [clientIdInput, setClientIdInput] = React.useState('')
      var [configured, setConfigured] = React.useState(props.clientIdConfigured !== false)

      var stopTimer = function () {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
      }

      React.useEffect(function () { return stopTimer }, [])

      var poll = async function () {
        try {
          var result = await api('/oauth/poll')
          if (result.state === 'authorized') {
            stopTimer()
            setPhase('authorized')
            props.onLoggedIn(result)
            return
          }
          if (result.state === 'pending') return
          stopTimer()
          if (result.state === 'expired' || result.state === 'denied' || result.state === 'idle') {
            setPhase('idle')
            setFlow(null)
            setError(result.error || '授权未完成')
          } else {
            setPhase('error')
            setError(result.error || '授权失败')
          }
        } catch (e) {
          stopTimer()
          setPhase('error')
          setError(e && e.message ? e.message : String(e))
        }
      }

      var startOauth = async function () {
        if (busy) return
        setError('')
        setBusy(true)
        setPhase('starting')
        try {
          var result = await postJson('/oauth/start', {})
          setFlow({
            userCode: result.userCode,
            verificationUri: result.verificationUri || 'https://github.com/login/device',
            expiresIn: result.expiresIn,
            interval: Math.max(3, Number(result.interval) || 5),
          })
          setPhase('waiting')
          // 直接把授权页顶开，省得手动复制链接
          try { window.open(result.verificationUri || 'https://github.com/login/device', '_blank') } catch (e) { /* 被拦截就点链接 */ }
          stopTimer()
          timerRef.current = setInterval(poll, Math.max(3, Number(result.interval) || 5) * 1000)
        } catch (e) {
          setPhase('error')
          setError(e && e.message ? e.message : String(e))
        } finally {
          setBusy(false)
        }
      }

      var cancel = async function () {
        stopTimer()
        try { await postJson('/oauth/cancel', {}) } catch (e) { /* ignore */ }
        setPhase('idle')
        setFlow(null)
        setError('')
      }

      var submitPat = async function () {
        if (busy || !token.trim()) return
        setError('')
        setBusy(true)
        try {
          var result = await postJson('/login', { token: token.trim() })
          setToken('')
          props.onLoggedIn(result)
        } catch (e) {
          setError(e && e.message ? e.message : String(e))
        } finally {
          setBusy(false)
        }
      }

      var saveClientId = async function () {
        if (busy || !clientIdInput.trim()) return
        setError('')
        setBusy(true)
        try {
          await postJson('/oauth/client-id', { clientId: clientIdInput.trim() })
          setConfigured(true)
          setClientIdInput('')
        } catch (e) {
          setError(e && e.message ? e.message : String(e))
        } finally {
          setBusy(false)
        }
      }

      var setupCard = h('div', { className: '__ghd_card', style: { borderColor: 'var(--gh-attention)' } },
        h('div', { className: '__ghd_h2' }, h(Icon, { name: 'lock' }), '一次性配置'),
        h('div', { className: '__ghd_para' },
          h('strong', null, '① '),
          h(Link, { className: '__ghd_link', href: 'https://github.com/settings/applications/new' }, '新建 OAuth App ↗'),
          '　Homepage 与 Callback 都填 ',
          h('span', { className: '__ghd_mono' }, 'http://127.0.0.1')),
        h('div', { className: '__ghd_para' },
          h('strong', null, '② '), '把页面上的 Client ID 粘到下面'),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('input', {
            className: '__ghd_input __ghd_mono',
            style: { flex: '1 1 260px', width: 'auto' },
            type: 'text',
            value: clientIdInput,
            placeholder: 'Iv1.xxxxxxxxxxxx',
            spellCheck: false,
            onChange: function (e) { setClientIdInput(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') saveClientId() },
          }),
          h(Btn, {
            primary: true,
            disabled: busy || !clientIdInput.trim(),
            onClick: saveClientId,
          }, busy ? '保存中…' : '保存')),
        h('div', { className: '__ghd_para' },
          h('strong', null, '③ '), '保存后即可用账号登录'))

      var waitingCard = flow
        ? h('div', { className: '__ghd_card' },
          h('div', { className: '__ghd_h2' }, h(Icon, { name: 'sync' }), '在 GitHub 上确认授权'),
          h('div', { className: '__ghd_para' }, '在浏览器里输入这串验证码：'),
          h('div', {
            className: '__ghd_mono',
            style: {
              fontSize: 34, letterSpacing: 10, fontWeight: 700, textAlign: 'center',
              padding: '16px 10px', border: '1px dashed var(--gh-border)', borderRadius: 8,
              color: 'var(--gh-accent)', userSelect: 'all',
            },
          }, flow.userCode),
          h('div', { style: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' } },
            h(Link, { className: '__ghd_link', href: flow.verificationUri, target: '_blank' }, '重新打开授权页 ↗'),
            h('button', { type: 'button', className: '__ghd_btn', onClick: cancel }, '取消')))
        : null

      return h('div', { className: '__ghd_form' },
        h('div', { className: '__ghd_h2' }, h(Icon, { name: 'repo' }), '登录 GitHub'),
        h('div', { className: '__ghd_para' }, '使用 GitHub 官方授权登录。'),
        !configured ? setupCard : null,
        waitingCard,
        error ? h('div', { className: '__ghd_err', style: { margin: 0 } }, error) : null,
        phase === 'waiting'
          ? null
          : h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h(Btn, {
              primary: true,
              disabled: busy || !configured,
              onClick: startOauth,
            }, busy || phase === 'starting' ? '正在向 GitHub 申请…' : '使用 GitHub 账号登录'),
            !configured ? h('span', { className: '__ghd_para' }, '（先在上面填好 Client ID）') : null),

        h('div', null,
          h('button', {
            type: 'button',
            className: '__ghd_link',
            style: { background: 'none', border: 'none', padding: 0 },
            onClick: function () { setPatOpen(!patOpen) },
          }, patOpen ? '收起令牌登录 ▲' : '改用个人访问令牌登录 ▼')),

        patOpen
          ? h('div', { className: '__ghd_card' },
            h('div', { className: '__ghd_para' },
              '兜底方式：如果 OAuth 走不通，可以直接粘一个 Personal Access Token。令牌只存本机 ',
              h('span', { className: '__ghd_mono' }, '~/.dsh/dsh-github/auth.json'),
              '。'),
            h('div', { className: '__ghd_field' },
              h('label', { className: '__ghd_label' }, '访问令牌'),
              h('input', {
                className: '__ghd_input __ghd_mono',
                type: 'password',
                value: token,
                placeholder: 'ghp_xxxx 或 github_pat_xxxx',
                spellCheck: false,
                autoComplete: 'off',
                onChange: function (e) { setToken(e.target.value) },
                onKeyDown: function (e) { if (e.key === 'Enter') submitPat() },
              })),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
              h(Btn, { disabled: busy || !token.trim(), onClick: submitPat }, busy ? '正在验证…' : '用令牌登录'),
              h(Link, { className: '__ghd_link', href: TOKEN_URL }, '去 GitHub 创建令牌 ↗')))
          : null)
    }

    /* ── 行 ────────────────────────────────────────────────────────────── */
    function RepoRow(props) {
      var repo = props.repo
      return h('div', { className: '__ghd_row' },
        h('div', { className: '__ghd_rowIcon' }, h(Icon, { name: 'repo' })),
        h('div', { className: '__ghd_rowBody' },
          h('div', { className: '__ghd_rowTop' },
            h(Link, { href: repo.html_url }, repo.full_name),
            repo.private ? tag('', '私有') : null,
            repo.language ? tag('', repo.language) : null),
          repo.description ? h('div', { className: '__ghd_desc' }, repo.description) : null,
          h('div', { className: '__ghd_meta' },
            h('span', null, '★ ' + fmtNum(repo.stars)),
            h('span', null, '⑂ ' + fmtNum(repo.forks)),
            h('span', null, '议题 ' + fmtNum(repo.open_issues)),
            repo.updated_at ? h('span', null, '更新于 ' + timeAgo(repo.updated_at)) : null)))
    }

    function IssueRow(props) {
      var item = props.item
      return h('div', { className: '__ghd_row' },
        h('div', { className: '__ghd_rowIcon' }, h(Icon, { name: item.is_pr ? 'pr' : 'issue' })),
        h('div', { className: '__ghd_rowBody' },
          h('div', { className: '__ghd_rowTop' },
            h(Link, { href: item.html_url }, item.title),
            h('span', { className: '__ghd_tag' }, '#' + item.number)),
          h('div', { className: '__ghd_meta' },
            h('span', { className: item.state === 'open' ? '__ghd_tag __ghd_tagOpen' : '__ghd_tag' }, item.state === 'open' ? '打开' : '已关闭'),
            item.repo ? h('span', null, item.repo) : null,
            item.user ? h('span', null, item.user) : null,
            h('span', null, timeAgo(item.updated_at))),
          item.labels && item.labels.length
            ? h('div', { className: '__ghd_meta' }, item.labels.map(function (label) {
              return h('span', { className: '__ghd_tag', key: label }, label)
            }))
            : null))
    }

    function NotificationRow(props) {
      var item = props.item
      return h('div', { className: '__ghd_row' },
        h('div', { className: '__ghd_rowIcon' }, h(Icon, { name: 'bell' })),
        h('div', { className: '__ghd_rowBody' },
          h('div', { className: '__ghd_rowTop' },
            item.html_url
              ? h(Link, { href: item.html_url }, item.title || '（无标题）')
              : h('span', { className: '__ghd_plain' }, item.title || '（无标题）'),
            item.unread ? tag('unread', '未读') : null),
          h('div', { className: '__ghd_meta' },
            item.repo ? h('span', null, item.repo) : null,
            item.reason ? h('span', null, item.reason) : null,
            h('span', null, timeAgo(item.updated_at)))))
    }

    /* ── 主面板 ────────────────────────────────────────────────────────── */
    var TABS = [
      { key: 'repos', label: '我的仓库', icon: 'repo' },
      { key: 'starred', label: '收藏', icon: 'star' },
      { key: 'notifications', label: '通知', icon: 'bell' },
      { key: 'issues', label: '议题与拉取请求', icon: 'issue' },
      { key: 'search', label: '搜索', icon: 'search' },
    ]

    function Panel() {
      var theme = React.useMemo(function () { return detectDark() ? THEMES.dark : THEMES.light }, [])
      var [status, setStatus] = React.useState(null)
      var [booting, setBooting] = React.useState(true)
      var [error, setError] = React.useState('')
      var [tab, setTab] = React.useState('repos')
      var [list, setList] = React.useState({ items: [], loading: false, error: '', page: 1, hasMore: false })
      var [filter, setFilter] = React.useState('')
      var [issueFilter, setIssueFilter] = React.useState('assigned')
      var [term, setTerm] = React.useState('')
      var [email, setEmail] = React.useState('')

      var loadStatus = React.useCallback(async function (probe) {
        setBooting(true)
        setError('')
        try {
          var data = await api('/status' + (probe ? '?probe=1' : ''))
          setStatus(data)
        } catch (e) {
          setError(e && e.message ? e.message : String(e))
        } finally {
          setBooting(false)
        }
      }, [])

      React.useEffect(function () { loadStatus(true) }, [])

      // 登录后取一次账号邮箱（主邮箱优先），失败就算了，不影响主流程
      React.useEffect(function () {
        if (!status || !status.loggedIn) { setEmail(''); return }
        var alive = true
        api('/emails')
          .then(function (data) { if (alive) setEmail((data && data.primary) || '') })
          .catch(function () { if (alive) setEmail('') })
        return function () { alive = false }
      }, [status && status.loggedIn, status && status.login])

      var loadList = React.useCallback(async function (which, options) {
        var opts = options || {}
        var nextPage = opts.append ? list.page + 1 : 1
        setList(function (previous) {
          return { items: opts.append ? previous.items : [], loading: true, error: '', page: nextPage, hasMore: false }
        })
        try {
          var path
          if (which === 'repos') path = '/repos?page=' + nextPage + '&per_page=30'
          else if (which === 'starred') path = '/starred?page=' + nextPage + '&per_page=30'
          else if (which === 'notifications') path = '/notifications?all=0'
          else if (which === 'issues') path = '/issues?filter=' + encodeURIComponent(issueFilter)
          else if (which === 'search') path = '/search?q=' + encodeURIComponent(term) + '&type=repositories'
          var data = await api(path)
          setList(function (previous) {
            return {
              items: opts.append ? previous.items.concat(data.items || []) : (data.items || []),
              loading: false, error: '', page: nextPage, hasMore: data.hasMore === true,
            }
          })
          if (data.session) {
            setStatus(function (previous) { return previous ? Object.assign({}, previous, { session: data.session }) : previous })
          }
        } catch (e) {
          setList(function (previous) {
            return Object.assign({}, previous, { loading: false, error: e && e.message ? e.message : String(e) })
          })
        }
      }, [list.page, term, issueFilter])

      React.useEffect(function () {
        if (!status || !status.loggedIn) return
        if (tab === 'search' && !term.trim()) return
        loadList(tab, { append: false })
      }, [status && status.loggedIn, tab, issueFilter])

      var switchTab = function (key) {
        if (key === tab) return
        setTab(key)
        setFilter('')
        setList({ items: [], loading: false, error: '', page: 1, hasMore: false })
      }

      var onLoggedIn = function (result) {
        setStatus(function (previous) {
          return Object.assign({}, previous || {}, {
            loggedIn: true,
            login: result.user ? result.user.login : '',
            user: result.user,
            session: result.session,
            apiBase: result.apiBase,
            maskedToken: result.maskedToken,
          })
        })
        setTab('repos')
        setList({ items: [], loading: false, error: '', page: 1, hasMore: false })
      }

      var onLogout = async function () {
        try { await postJson('/logout') } catch (e) { /* 忽略 */ }
        setStatus(function (previous) {
          return Object.assign({}, previous || {}, { loggedIn: false, user: null, session: null, maskedToken: '' })
        })
        setList({ items: [], loading: false, error: '', page: 1, hasMore: false })
      }

      var loggedIn = Boolean(status && status.loggedIn)
      var user = status && status.user
      var visible = list.items
      if (filter.trim()) {
        var needle = filter.trim().toLowerCase()
        visible = visible.filter(function (item) {
          return [item.full_name, item.title, item.name, item.repo, item.description, item.user]
            .filter(Boolean).join(' ').toLowerCase().indexOf(needle) >= 0
        })
      }

      var rowRenderer = function (item, index) {
        var key = item.id || item.full_name || item.number || index
        if (tab === 'notifications') return h('div', { key: key }, h(NotificationRow, { item: item }))
        if (tab === 'issues') return h('div', { key: key }, h(IssueRow, { item: item }))
        return h('div', { key: key }, h(RepoRow, { repo: item }))
      }

      /* 顶部工具栏 */
      var toolbar = h('div', { className: '__ghd_toolbar' },
        h('div', { className: '__ghd_brand' }, h(Icon, { name: 'repo' }), 'GitHub'),
        h('span', { className: '__ghd_pill', style: { cursor: 'default' }, title: '当前仓库' },
          h(Icon, { name: 'repo', size: 14 }),
          h('span', null, loggedIn ? (user && user.name ? user.name + ' / @' + user.login : '@' + (user ? user.login : status.login)) : '未登录')),
        h('div', { className: '__ghd_spacer' }),
        status && status.session && status.session.remaining !== undefined && status.session.remaining !== null
          ? h('span', { className: '__ghd_sub' }, '接口配额 ' + status.session.remaining + '/' + (status.session.limit || '?'))
          : null,
        h(IconBtn, {
          name: 'sync',
          disabled: !loggedIn || list.loading,
          onClick: function () { if (loggedIn) loadList(tab, { append: false }) },
        }, '刷新'))

      /* 左侧导航 */
      var side = h('div', { className: '__ghd_side' },
        TABS.map(function (entry) {
          return h('button', {
            key: entry.key,
            type: 'button',
            className: '__ghd_navItem' + (tab === entry.key ? ' __ghd_navItemOn' : ''),
            onClick: function () { switchTab(entry.key) },
            disabled: !loggedIn,
            style: loggedIn ? null : { opacity: 0.45, cursor: 'default' },
          }, h(Icon, { name: entry.icon }), entry.label)
        }),
        h('div', { className: '__ghd_sideFoot' },
          loggedIn
            ? h(React.Fragment, null,
              h('div', { className: '__ghd_account' },
                user && user.avatar_url
                  ? h('img', { className: '__ghd_avatar', src: user.avatar_url, alt: '' })
                  : h('div', { className: '__ghd_avatar', style: { background: 'var(--gh-hover)' } }),
                h('div', { className: '__ghd_acctText' },
                  h('div', { className: '__ghd_acctName' }, (user && (user.name || user.login)) || status.login),
                  h('div', { className: '__ghd_acctSub' }, '@' + ((user && user.login) || status.login)))),
              email
                ? h('div', { className: '__ghd_acctSub', style: { wordBreak: 'break-all' }, title: 'GitHub 账号邮箱' }, '✉ ' + email)
                : null,
              h('div', { className: '__ghd_acctSub', style: { wordBreak: 'break-all' } },
                status.maskedToken || '',
                status.apiBase && status.apiBase !== 'https://api.github.com' ? ' · ' + status.apiBase : ''),
              h('button', {
                type: 'button',
                className: '__ghd_navItem',
                onClick: onLogout,
                style: { fontSize: 12 },
              }, h(Icon, { name: 'signout', size: 14 }), '退出登录'))
            : h('div', { className: '__ghd_acctSub' }, '未登录'))
      )

      /* 右侧内容 */
      var mainHead = null
      var mainBody = null

      if (booting && !status) {
        mainBody = h('div', { className: '__ghd_empty' }, h(Icon, { name: 'sync', size: 20 }), '正在读取登录状态…')
      } else if (error) {
        mainBody = h('div', { className: '__ghd_err' }, error)
      } else if (!loggedIn) {
        mainBody = h(LoginView, {
          onLoggedIn: onLoggedIn,
          clientIdConfigured: Boolean(status && status.clientIdConfigured),
        })
      } else {
        var current = TABS.filter(function (entry) { return entry.key === tab })[0]
        var count = filter ? visible.length : list.items.length
        mainHead = h('div', { className: '__ghd_mainHead' },
          h('div', { className: '__ghd_h' }, current.label),
          h('div', { className: '__ghd_sub' }, count ? '共 ' + count + ' 项' : ''),
          h('div', { className: '__ghd_spacer' }),
          tab === 'issues'
            ? h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
              [['assigned', '分派给我'], ['created', '我创建的'], ['mentioned', '提到我'], ['all', '全部']].map(function (pair) {
                return h('button', {
                  key: pair[0],
                  type: 'button',
                  className: '__ghd_btn',
                  style: issueFilter === pair[0]
                    ? { borderColor: 'var(--gh-accent)', color: 'var(--gh-accent)' }
                    : { borderColor: 'transparent', background: 'transparent' },
                  onClick: function () { setIssueFilter(pair[0]) },
                }, pair[1])
              }))
            : null,
          tab === 'search'
            ? h('div', { className: '__ghd_filter' },
              h(Icon, { name: 'search', size: 14 }),
              h('input', {
                type: 'text',
                value: term,
                placeholder: '搜索仓库，回车确认',
                onChange: function (e) { setTerm(e.target.value) },
                onKeyDown: function (e) { if (e.key === 'Enter' && term.trim()) loadList('search', { append: false }) },
              }),
              h(Btn, { disabled: !term.trim(), onClick: function () { loadList('search', { append: false }) } }, '搜索'))
            : h('div', { className: '__ghd_filter' },
              h(Icon, { name: 'search', size: 14 }),
              h('input', {
                type: 'text',
                value: filter,
                placeholder: '在当前列表中筛选…',
                onChange: function (e) { setFilter(e.target.value) },
              })))

        var bodyChildren = []
        if (list.error) bodyChildren.push(h('div', { className: '__ghd_err' }, list.error))
        if (list.loading) bodyChildren.push(h('div', { className: '__ghd_empty' }, '正在加载…'))
        if (!list.loading && !list.error && visible.length === 0) {
          bodyChildren.push(h('div', { className: '__ghd_empty' },
            h(Icon, { name: current.icon, size: 24 }),
            filter ? '没有匹配的内容' : (tab === 'search' ? '输入关键词后按回车搜索' : '暂无内容')))
        }
        if (visible.length) bodyChildren.push(h('div', null, visible.map(rowRenderer)))
        if (list.hasMore && !filter) {
          bodyChildren.push(h('div', { style: { padding: 12, textAlign: 'center' } },
            h(Btn, { disabled: list.loading, onClick: function () { loadList(tab, { append: true }) } }, '加载更多')))
        }
        mainBody = h('div', { className: '__ghd_list' }, bodyChildren)
      }

      return h('div', { className: '__ghd_wrap', style: vars(theme) },
        h('div', { className: '__ghd_root' },
          toolbar,
          h('div', { className: '__ghd_body' },
            side,
            h('div', { className: '__ghd_main' }, mainHead, mainBody)),
          h('div', { className: '__ghd_foot' },
            h('span', null, 'dsh-github v' + ((status && status.version) || '1.5.0')),
            h('span', null, '·'),
            h('span', null, '令牌仅存本机'),
            status && status.session && status.session.scopes
              ? h('span', null, '· ' + status.session.scopes.trim())
              : null)))
    }

    /* ── 插件 ──────────────────────────────────────────────────────────── */
    var inject = ['slots']

    function apply(ctx) {
      // 主入口：设置侧栏的分区
      try {
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            { name: 'settings.section', id: 'github', order: 27, label: 'GitHub' },
            function () { return h(Panel, {}) })
        })
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-github] 注册设置分区失败：', error)
        }
      }

      // 备用入口：设置 → 插件 里的标签页（两个都注册，保证一定能找到）
      try {
        ctx.slots.inject('settings.plugins.tab', function () {
          return ctx.slots.register(
            { name: 'settings.plugins.tab', id: 'github', order: 50, label: 'GitHub' },
            function () { return h(Panel, {}) })
        })
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-github] 注册插件标签页失败：', error)
        }
      }
    }

    module.exports = { name: 'dsh-github-client', inject: inject, apply: apply }
    return module.exports
  },
})
