# 本地参考文件

开发时实际读取的根目录：`E:\Mineradio-main\Jiafee-FX-Patcher`。

- `desktop\index.html` → PatcherHome：黑灰背景、薄荷绿状态、页头署名、双模块、五行目录状态、按钮与日志结构。
- `payload\audio-effects\index.css` → AudioEffectsDemo：深色音效弹层、纵向预设列表、10 段 EQ、底部工具与状态。
- `payload\audio-effects\index-head.html`、`index-loader-line.js` → 音效脚本和资源加载参考。
- `payload\public\fx-presets.json` → 原声、JIAFEE 招牌、人声聚焦、水晶三频及说明。
- `payload\together-listen\index-presence.html` → 固定双头像、连接线、消息定位、∧ / ∨、输入栏与发送图标。
- `payload\together-listen\index-modal.html` → 我的联机资料、创建、局域网、直接连接、6 位授权码、保存地址、断开入口。
- `payload\together-listen\together-index.css` → 黑灰玻璃材质、头像背景、连接点、气泡样式。
- `payload\public\js\modules\12-together-listen\ui.js` → 消息动效、收起展开、柔和提示音。
- `payload\public\js\modules\12-together-listen\playback-controller.js`、`player-adapter.js` → 同步演示和断开回到单人待播放的行为边界。
- `patch-manifest.json`、`patch-manifest-coplay.json` → 展示的注入文件摘要、版本号与两个独立模块。

额外读取 `E:\Mineradio-main\Mineradio-2.2.0-source\Mineradio-paused-main\public\index.html` 的桌面标题栏与入口结构。三个真实产品目录未因本次视频工作被修改。

视频为基于参考代码的 DOM 重建，不是运行产品的屏幕录像；不包含真实联机、实际注入或功能回归测试证据。
