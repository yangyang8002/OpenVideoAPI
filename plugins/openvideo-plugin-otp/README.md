# openvideo-plugin-otp

OpenVideoAPI 双因素登录插件（2FA）：**TOTP 动态验证码**（兼容 Google Authenticator / Microsoft Authenticator / 1Password 等）+ **一次性恢复码**。

- 登录页自动注入「动态验证码」输入框：先校验验证码，通过后再走 `/api/admin/login` 正常登录
- 后台新增「OTP 登录」管理 tab：启用 / 禁用 / 重新生成密钥，二维码 + otpauth URI + 恢复码
- 纯 Node 实现 RFC 6238（HMAC-SHA1 / Base32 / RFC 4648），零外部依赖
- 恢复码仅存 sha256 哈希、单次使用，防止丢失验证器后无法登录
- 管理操作需管理员密码（已启用时还需当前验证码），防止他人篡改
- `verify` / 管理接口按「用户名|IP」限流（5 次/分钟，超限锁 10 分钟）

## 安装

- **方式一（市场一键安装）**：插件市场安装 `openvideo-plugin-otp`（需先发布到 npm），或手动 `npm install openvideo-plugin-otp`
- **方式二（GitHub）**：`npm install git+https://github.com/yangyang8002/openvideo-plugin-otp.git`
- **方式三（本地开发）**：将本目录放入 `plugins/`（自动发现），在后台「插件管理」中启用

启用后打开后台 → 插件 →「OTP 登录」tab 完成密钥绑定。

## 使用

1. 后台 → 插件 → 启用 `otp`（如未启用）
2. 打开「OTP 登录」tab：
   - 输入管理员账号与密码 →「生成密钥」
   - 用验证器 App 扫描二维码（或手动输入密钥 / otpauth URI）
   - 输入 App 中的 6 位验证码 →「确认并启用」
   - **立即保存页面显示的 8 个一次性恢复码**
3. 之后登录后台：输入账号 + 密码 + 验证码（验证码失效时可用恢复码代替）

## API

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/plugin/otp/config` | 公开 | 插件参数（issuer/period/digits/window） |
| POST | `/api/plugin/otp/status` | 公开 | `{ username }` → `{ enabled }` |
| POST | `/api/plugin/otp/verify` | 公开 | `{ username, code }` 校验 TOTP / 恢复码（限流） |
| POST | `/api/plugin/otp/setup` | 密码 | 生成新密钥（pending；已启用还需验证码） |
| POST | `/api/plugin/otp/confirm` | 密码 | 校验验证码匹配 pending 密钥并启用 |
| POST | `/api/plugin/otp/disable` | 密码+验证码 | 关闭 OTP |

## 配置（插件配置表单）

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 启用 OTP 插件 | true | 关闭后登录不校验验证码（已启用用户的密钥保留） |
| OTP 发行方名称 | OpenVideoAPI | 验证器 App 中显示的名称 |
| 刷新周期（秒） | 30 | TOTP 周期 |
| 验证码位数 | 6 | TOTP 长度 |
| 容错窗口（±步数） | 1 | 前后各允许多少个周期的验证码 |

## 数据

密钥与恢复码哈希存储于插件动态表 `otp_keys`（随主存储切换自动迁移）。
恢复码以 sha256 哈希保存，服务端无法还原明文。

## 安全说明

- OTP 是**附加**验证：`/api/admin/login` 的账号密码校验不受影响，密码错误时验证码校验不会执行（先校验密码再放行登录流程）
- 登录页在调用 `/api/plugin/otp/verify` 通过后才执行原有登录请求；未启用 OTP 的账号不受影响
- 请勿在非 HTTPS 环境使用（验证码可能被中间人截获）；建议配合 PoW / 限流使用

## 开发

```
plugins/openvideo-plugin-otp/
├── package.json            # npm 包元数据 + openvideoPlugin manifest
├── lib/
│   ├── index.js            # 服务端：TOTP/Base32/恢复码/限流 + API
│   └── client/
│       ├── login/otp.js    # 登录页注入验证码输入（scope=login）
│       └── admin/otp.js    # 后台管理 tab（scope=admin）
└── README.md
```

发布新版本：

```bash
npm version patch
git push origin master --tags
npm publish          # 市场安装依赖 npm 发布
```

## License

MIT
