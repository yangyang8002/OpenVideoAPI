# openvideo-plugin-embed-subtitle

OpenVideoAPI **内封字幕采集插件**：检测视频内嵌的字幕轨道（**多轨 / 多语言**），用 ffmpeg 提取为独立字幕文件并**写入字幕库**，可关联到视频。支持**本地文件**与 **http(s) 链接**两种视频源。

- **检测**：ffprobe 列出视频内全部字幕轨（序号 / 编码 / 语言 / 标题 / 默认 / 强制 / 是否图形字幕）
- **提取**：文本字幕轨（SRT / ASS / SSA / WebVTT / MOV_TEXT 等）统一提取为 `.srt` / `.ass`，存入 `data/subtitles/` 并登记字幕库（`type=local`，播放器可直接加载）
- **多轨批量**：一次勾选多条轨道批量提取（`extract-all`），每条自动按语言命名
- **语言映射**：ffprobe 三字母标签自动映射（zho→zh、jpn→ja、eng→en…）
- **关联视频**：提取时可填视频码（vid），自动挂到该视频的字幕菜单；未填时自动按播放 URL 分配/复用映射
- **URL 支持**：直接粘贴 http(s) 视频链接即可检测并提取该链接视频的内封字幕（ffprobe/ffmpeg 原生流式读取，带 `-rw_timeout` 防挂起）
- **安全**：本地路径仅允许项目根内（防目录穿越）；URL 拒绝内网/保留/元数据地址（DNS 解析后二次校验，防 SSRF/DNS rebinding）；ffmpeg/ffprobe 子进程带超时强制终止

## 安装

- 市场一键安装 `openvideo-plugin-embed-subtitle`（或 npm / GitHub 安装），后台启用
- **跨平台开箱即用（Linux / Windows / macOS）**：插件内置 `ffmpeg-static` + `@ffprobe-installer/ffprobe` 静态二进制（含 linux-x64 / linux-arm64 / win / mac），**无需在服务器安装 ffmpeg**（Docker 部署同样适用）
- 二进制解析顺序：插件配置指定路径 > 内置模块 > 系统 PATH；可在插件配置中覆盖

## 使用

后台 → 插件 → 启用 → 打开「**内封字幕**」tab：

1. 输入视频文件路径（相对项目根，如 `public/videos/demo.mkv`，或绝对路径）**或直接粘贴 http(s) 视频链接**
2. 点「检测内封字幕」→ 列出所有字幕轨
3. 勾选要提取的轨道（图形字幕不可选）→ 点「提取所选轨道到字幕库」
4. 字幕管理页可见；可选填视频码自动关联

> URL 检测依赖视频服务器支持 HTTP Range 请求（ffprobe 仅需读取文件尾部元数据）；不支持 Range 时 ffprobe 会尝试全量读取，耗时较长属正常现象。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/plugin/embed-sub/detect` | `{ file }`（本地路径或 http(s) 链接）→ `{ streams: [{index,codec,language,title,default,forced,text,image}] }` |
| POST | `/api/plugin/embed-sub/extract` | `{ file, index, lang?, name?, vid? }` 提取单条到字幕库 |
| POST | `/api/plugin/embed-sub/extract-all` | `{ file, indexes: [..], vid? }` 批量提取 |

## 配置（插件配置表单）

| 项 | 默认 | 说明 |
| --- | --- | --- |
| ffprobe 路径 | （空） | 留空自动使用内置二进制（`@ffprobe-installer/ffprobe`），找不到回退 PATH |
| ffmpeg 路径 | （空） | 留空自动使用内置二进制（`ffmpeg-static`），找不到回退 PATH |
| 提取超时（秒） | 120 | 超时自动终止 |

## 限制

- **图形字幕**（PGS / VOBSUB / DVB 等图片轨）：可检测并标注，但无法提取为文本（v1 不支持 OCR）
- 检测/提取为按需触发，无后台扫描
- URL 源需要服务器能访问目标链接（出站代理插件配置的 HTTPS_PROXY 不自动生效于 ffmpeg 子进程）
- 内置二进制由 npm 安装时按平台自动下载（`postinstall`）；离线安装可改用系统 ffmpeg 并在配置中指定路径

## 开发

```
plugins/openvideo-plugin-embed-subtitle/
├── package.json
├── lib/
│   ├── index.js            # 服务端：ffprobe 检测 + ffmpeg 提取 + 字幕库写入
│   └── client/admin/embed.js  # 后台「内封字幕」tab
└── README.md
```

发布新版本：`npm version patch && git push origin master --tags && npm publish`

## License

MIT
