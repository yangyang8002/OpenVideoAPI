# openvideo-plugin-embed-subtitle

OpenVideoAPI **内封字幕采集插件**：检测视频文件内嵌的字幕轨道（**多轨 / 多语言**），用 ffmpeg 提取为独立字幕文件并**写入字幕库**，可关联到视频。

- **检测**：ffprobe 列出视频内全部字幕轨（序号 / 编码 / 语言 / 标题 / 默认 / 强制 / 是否图形字幕）
- **提取**：文本字幕轨（SRT / ASS / SSA / WebVTT / MOV_TEXT 等）统一提取为 `.srt` / `.ass`，存入 `data/subtitles/` 并登记字幕库（`type=local`，播放器可直接加载）
- **多轨批量**：一次勾选多条轨道批量提取（`extract-all`），每条自动按语言命名
- **语言映射**：ffprobe 三字母标签自动映射（zho→zh、jpn→ja、eng→en…）
- **关联视频**：提取时可填视频码（vid），自动挂到该视频的字幕菜单
- **安全**：文件路径仅允许项目根内（防目录穿越）；ffmpeg/ffprobe 子进程带超时强制终止

## 安装

- 市场一键安装 `openvideo-plugin-embed-subtitle`（或 npm / GitHub 安装），后台启用
- **前置**：服务器需安装 [ffmpeg](https://ffmpeg.org)（含 ffprobe）；可在插件配置中指定 `ffprobePath` / `ffmpegPath` 绝对路径

## 使用

后台 → 插件 → 启用 → 打开「**内封字幕**」tab：

1. 输入视频文件路径（相对项目根，如 `public/videos/demo.mkv`，或绝对路径）
2. 点「检测内封字幕」→ 列出所有字幕轨
3. 勾选要提取的轨道（图形字幕不可选）→ 点「提取所选轨道到字幕库」
4. 字幕管理页可见；可选填视频码自动关联

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/plugin/embed-sub/detect` | `{ file }` → `{ streams: [{index,codec,language,title,default,forced,text,image}] }` |
| POST | `/api/plugin/embed-sub/extract` | `{ file, index, lang?, name?, vid? }` 提取单条到字幕库 |
| POST | `/api/plugin/embed-sub/extract-all` | `{ file, indexes: [..], vid? }` 批量提取 |

## 配置（插件配置表单）

| 项 | 默认 | 说明 |
| --- | --- | --- |
| ffprobe 路径 | ffprobe | 从 PATH 查找；可填绝对路径 |
| ffmpeg 路径 | ffmpeg | 提取字幕用 |
| 提取超时（秒） | 120 | 超时自动终止 |

## 限制

- **图形字幕**（PGS / VOBSUB / DVB 等图片轨）：可检测并标注，但无法提取为文本（v1 不支持 OCR）
- 需要 ffmpeg 环境；检测/提取为按需触发，无后台扫描

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
