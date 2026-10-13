# Mineradio 多功能补丁器 · 动态演示视频

JIAFEE 开发 · Jiafee-FX-Patch 2.2.9

独立 Remotion + React + TypeScript 项目，35 秒、1920×1080、30fps。所有软件界面都是 DOM 和 Lucide SVG 图标，不使用截图、Canvas、视频素材或图片。它模拟产品操作，不连接真实房间、不执行真实源码注入。

## 安装与渲染

```powershell
cd E:\Mineradio-main\Jiafee-FX-Patcher\demo-video
npm install
npm run render
```

`render` 会自动生成原创合成音轨，再导出 H.264 / AAC MP4 和 PNG 封面：

- `out/Mineradio-JIAFEE-2.2.9.mp4`
- `out/Mineradio-JIAFEE-2.2.9-cover.png`

优先使用本机 Chrome / Edge；没有可用浏览器时由 Remotion 下载。指定其他浏览器：

```powershell
$env:REMOTION_BROWSER_EXECUTABLE='C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run render
```

可用 `REMOTION_CONCURRENCY` 设置渲染并发数，默认 4。无需修改父项目 package.json。

## 预览与检查

```powershell
npm start
npm run typecheck
npm test
npm run test:layout
npm run stills
npm run cover
node scripts/verify-output.mjs
```

`npm start` 打开 Remotion Studio，可拖动时间轴逐帧预览。`test:layout` 使用无头浏览器测量实际 DOM；`verify-output.mjs` 在 Windows 上使用 Remotion 自带 FFmpeg / FFprobe 检查产物、全片解码并提取关键帧。预设来源测试使用父项目 payload，单独移动本目录后应同时保留参考文件或跳过该来源测试。

## 项目结构

- `src/config.mjs`：产品名称、版本、文案、颜色、字体、场景时间、主要交互时间、音效参数。
- `src/Video.tsx`：Remotion Sequence 编排，转场包含短交叉淡入。
- `src/motion.ts`：spring / interpolate 动画、聊天占位空间、共享播放状态。
- `src/components/PatcherHome.tsx`：开场与原版紧凑补丁器主页。
- `src/components/CompatibilityCheck.tsx`：目录选择及兼容检查。
- `src/components/InjectionProgress.tsx`：备份、文件日志与事务验证。
- `src/components/AudioEffectsDemo.tsx`：真实预设名称、10 段均衡器。
- `src/components/TogetherListenDemo.tsx`：局域网、远程授权码、双向播放对照、聊天输入栏。
- `src/components/ChatBubble.tsx`：放大、停留、缩小、淡出，独立定位。
- `src/components/DisconnectRecovery.tsx`：清理联机状态并恢复单人待播放。
- `src/components/Cover.tsx`：结尾与封面共享同一个 EndingFrame，1920×1080。
- `scripts/audio.mjs`：确定性的立体声 lo-fi 合成乐、柔和点击和 0.2 秒正弦消息提示音。
- `scripts/render.mjs`：一键 H.264 渲染、封面、关键帧导出。
- `tests/`、`scripts/layout-qa.mjs`：时间轴及真实浏览器布局验证。

## 35 秒分镜

1. 0–3 秒：扫描线、逐字标题、开发者署名。
2. 3–8 秒：窗口进入，依次选择两个模块。
3. 8–13 秒：长路径选择、五项兼容性检查、开始注入。
4. 13–17 秒：备份、注入日志、进度与验证成功。
5. 17–22 秒：JIAFEE 招牌 → 人声聚焦 → 水晶三频，10 段 EQ。
6. 22–29 秒：局域网加入、远程 6 位授权码、双端播放暂停切歌和进度同步。
7. 29–33 秒：∧ 收起、∨ 展开；收到“这首好听！”，气泡放大保持后缩小消失。
8. 33–35 秒：断开、清空、单人待播放、结尾署名与版本。

## 字体与声音

字体优先 Microsoft YaHei UI / Microsoft YaHei，备选思源黑体。使用系统字体，不随源码分发 Windows 字体文件。其他机器请安装相应字体后渲染，避免字体替换导致字宽变化。

音轨是本项目代码合成，不引用商业录音或网上素材；随机噪声采用固定种子，重复渲染可复现。没有旁白。点击和消息声的独立峰值均小于背景音乐峰值，最后一秒音乐淡出。合成音轨及电平报告在渲染时自动生成。

## 与真实产品的边界

- 保留参考 UI 层次，按 1080p 演示放大控件和文字，卡片圆角不超过 8px。
- 右侧说明、双端对照为视频注释，不是软件新增功能。
- 视频初始两个模块未勾选，用于展示选择过程，不改变产品默认勾选音效的行为。
- 均衡器微动用于演示，不意味着实际软件会自动调整用户 EQ。
- 消息动画压缩到该镜头的 4 秒窗口；气泡与头像独立，输入栏空间独立计算。
- 断开后回到单人待播放，不声称自动恢复入房前歌曲。
- 域名 `music.example.com` 和地址、授权码均为演示数据。
- 本项目没有修改补丁器安装包、音效模块或一起听运行逻辑。

本项目使用 kinetic-typography 的逐字可访问性处理与关键帧验证方法；所有动画仍按任务限定使用 Remotion 驱动。
