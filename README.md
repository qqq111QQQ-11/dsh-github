# dsh-github

在 **DeepSeek Harness** 里登录并浏览 GitHub。

界面按 GitHub Desktop 的骨架做：顶部工具栏 + 左侧导航 + 内容区，全中文，字号按长时间阅读调过。

## 功能

- **官方 OAuth 登录**（设备授权流程，GitHub Desktop 同款）：点一下 → 浏览器输入 8 位验证码 → 自动登录，令牌不经过用户的手
- **我的仓库**：公开 / 私有 / 协作仓库，按更新时间排序，分页
- **收藏**：`/user/starred`
- **通知**：未读状态与原因
- **议题与拉取请求**：分派给我 / 我创建的 / 提到我 / 全部
- **搜索**：仓库搜索
- **账号邮箱**：登录后显示主邮箱（`user:email`）
- 列表项点击直接在系统浏览器打开 GitHub 页面

## 安装

```bash
dsh plugin --profile web add github:qqq111QQQ-11/dsh-github
```

桌面版：

```bash
dsh plugin --profile desktop add github:qqq111QQQ-11/dsh-github
```

装完重启 DSH，进 **设置 → GitHub**。

## 一次性配置：Client ID

GitHub 不允许匿名应用拿账号授权，任何官方登录方式都要先注册一个 OAuth App。**只需做一次**：

1. 打开 <https://github.com/settings/applications/new>
2. 应用名称随便填；Homepage URL 与 Callback URL 都填 `http://127.0.0.1`
3. **勾选「启用设备流」（Enable Device Flow）** ← 不勾会失败
4. 注册后复制页面上的 **Client ID**（`Iv1.` 开头，不是 Client Secret）
5. 粘贴到面板的输入框里保存

也可以用插件配置项 `clientId` 填（设置 → 插件 → dsh-github）。

## 安全

- 令牌只写本机 `~/.dsh/dsh-github/auth.json`（权限 0600）
- 令牌**永不**回传浏览器，前端只拿到 `ghp_…abcd` 掩码
- 设备授权的 `device_code` 只留在服务端
- 所有接口只接受 `127.0.0.1` / `::1` 且 Origin 与 Host 同源的请求
- 除 `api.github.com` 与 `github.com` 外不连任何第三方服务，无遥测

## 接口

全部挂在 `/plugins/dsh-github` 下，仅本机可访问：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/status` | 登录状态、版本、兼容性探测；`?probe=1` 时额外拉一次 `/user` |
| POST | `/login` | 令牌登录（兜底方式） |
| POST | `/logout` | 清除本地令牌 |
| GET | `/me` | 当前用户 |
| GET | `/emails` | 主邮箱与邮箱列表 |
| GET | `/repos` | `?page=&per_page=&sort=` |
| GET | `/starred` | `?page=&per_page=` |
| GET | `/notifications` | `?all=0\|1` |
| GET | `/issues` | `?filter=assigned\|created\|mentioned\|all&state=` |
| GET | `/search` | `?q=&type=repositories\|issues\|users` |
| GET | `/rate` | API 配额 |
| POST | `/oauth/start` | 开始设备授权，返回验证码 |
| GET | `/oauth/poll` | 轮询授权结果 |
| POST | `/oauth/cancel` | 取消授权 |
| POST | `/oauth/client-id` | 保存 Client ID |
| POST | `/hello` | 客户端加载自检 |

## 兼容性

针对不同宿主版本做了退让，任何一条路径不可用都只是降级，不会拖垮启动：

- `webServer` 未就绪时用 `ctx.inject` 等待，不抢跑（不会出现"插件 live 但接口全 404"）
- 不支持 `ctx.inject` 的老宿主自动退化为同步挂载
- `@deepseek-ai/schemastery` 缺失或 API 不兼容时，`Config` 降级为 `undefined`，插件照常工作
- 运行时没有全局 `fetch` 时给出可读提示，不抛异常
- 客户端 bundle 用 `try/catch` 逐段保护，任一插槽不可用都不影响其它插件
- 同时注册 `settings.section` 与 `settings.plugins.tab` 两个入口
- `/status` 的 `compat` 字段回显 node / fetch / inject / schema 能力，便于排错

## 卸载

```bash
dsh plugin --profile web remove dsh-github
```

## 开发

```bash
node test/client-load.mjs   # 客户端 bundle：注册 → factory → 导出 → apply
node test/mount-race.mjs    # 启动顺序竞态：两条挂载路径都必须挂上全部路由
node test/smoke.mjs         # 服务端：路由、鉴权、错误翻译（含真实 API 调用）
```

三个测试都不依赖宿主，用内置 Node 直接跑。

## License

MIT
