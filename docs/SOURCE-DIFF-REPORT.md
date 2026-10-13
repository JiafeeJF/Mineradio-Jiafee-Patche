# Mineradio 2.2.0 源码差异报告

对比范围：`Mineradio-paused-2.2.0`（官方原版）与 `Mineradio-2.2.0-source/Mineradio-paused-main`（新版）。

## 一起听新增内容

- 主进程新增 `desktop/together-listen/` 七个模块：权威房间状态、配置存储、UDP 发现、管理器、协议、房间服务和 TCP 帧传输。
- `desktop/main.js` 新增管理器初始化、可信主窗口 IPC 校验、允许的控制消息白名单、事件转发和退出清理。
- `desktop/preload.js` 通过 `contextBridge` 暴露受限方法；保持 `contextIsolation: true`，没有开启 Node renderer，也没有通配 IPC。
- renderer 新增 `public/js/modules/12-together-listen/` 四个模块：播放控制核心、播放器适配、控制器和 UI。
- 三个现有播放器文件增加了联机适配：`13-playback-start-audio.js` 支持暂停准备态和联机曲终推进，`18-cuefield-automix-integration.js` 在联机时暂停自动混音，`04-progress-seek.js` 避免本地拖动逻辑抢占联机 seek。
- `public/index.html` 新增标题栏入口、双人状态/互动区域和联机面板；`public/css/index.css` 新增 263 行独立样式；`public/js/index-loader.js` 增加四个模块加载项。
- `package.json` 新增 `ws ^8.22.0` 和 `test:together`；新增六个一起听测试文件、架构和操作文档。
- 全量文件核对结果：新增 28 个文件、删除 0 个文件、修改 12 个文件；除一起听相关改动外，文档还更新了 `README.md`、`RELEASE.md` 和更新投递资料。

## 可复用与需要适配的注入点

- 可复用：官方 2.2.0 的 `desktop/main.js` 仍有稳定的 `clearSpotifyToken` import、`FullDesktopModeRuntime` 初始化、`desktop-window-minimize` IPC 和退出清理位置。
- 可复用：preload 仍在 DOMContentLoaded 注册前结束 bridge 声明，适合插入独立 `togetherListen` bridge。
- 可复用：renderer 仍由 `public/js/index-loader.js` 的 `modulePaths` 顺序加载，播放器 API 名称与新版一起听适配器一致。
- 需要适配：旧音效补丁器整文件复制 `index.html`、`index.css` 和 `index-loader.js`，会覆盖 2.2.0 以及一起听代码；现已改为资源复制和独立标记插入。
- 需要适配：旧 CoPlay 是 `server.js` WebSocket 信令桥和 vendor UI，协议及播放集成不同；新版模块改用真实的桌面主进程服务、preload bridge 和 renderer 播放器适配，不再注入旧桥。

## 冲突结论

音效与一起听都改动 `public/index.html`、`public/css/index.css` 和 `public/js/index-loader.js`。新引擎按文件维护事务内的组合结果，每个模块使用独立 begin/end 标记。音效只连接 Web Audio 输出链；一起听通过播放器适配器调用已有播放函数，两者不注册同一 IPC 或覆盖同一资源，因此可组合安装和独立卸载。

未知版本、缺少关键文件或锚点时注入会停止。整个主文件不再由任一模块覆盖。
