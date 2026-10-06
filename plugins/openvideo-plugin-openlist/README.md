# openvideo-plugin-openlist

OpenList（AList 系）网盘接入插件。

## 功能

- 后台面板 `/plugin/openlist/panel`（管理员登录后可用）浏览网盘目录树
- 服务端代理 OpenList API：令牌保存在服务端，不暴露给浏览器，无跨域问题
- 一键「注册到库」：把网盘视频注册为播放库视频（自动触发内封字幕扫描）
- 一键「复制播放链接」：生成 `/player/?url=...` 直达播放页

## 配置

插件设置中填写：

- **baseUrl**：OpenList 站点地址，如 `https://pan.example.com`
- **token**：OpenList 后台生成的 API Token（游客可访问的网盘可留空）
