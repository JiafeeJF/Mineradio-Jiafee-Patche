# Mineradio 多功能补丁器 2.4.0

本版本重点提升一起听账号识别、入房校验和退出后的单人播放恢复。

## 更新内容

- 自动复用 Mineradio 已登录的网易云或 QQ 音乐资料，无需二次登录。
- 同平台、同 UID 的双方在进入双人同步前立即拒绝连接。
- 服务端权威接纳后才显示连接成功，避免身份校验期间误报。
- 单人房间保留现有播放；两人配对后才清理联机队列并等待第一首歌。
- 退出联机恢复原队列并保持暂停，修复自动播放和无声状态。
- 增强消息大小限制、发送失败处理、重连清理及资料界面状态。

## 下载

- `Jiafee-FX-Patch-2.4.0-Setup.exe`：Windows 安装包。
- `Jiafee-FX-Patch-2.4.0-Portable.zip`：免安装便携包。
- `Mineradio-Together-Relay-Control-1.0.2-Setup.exe`：Windows 中转服务图形控制端，修复旧运行时残留导致的账号校验不受支持。

## 校验

```text
0EF953445E84226EBABE356C61D21EBFF1394863998CC8B909FA871434F91E80  Jiafee-FX-Patch-2.4.0-Setup.exe
9F9BBDDF070BD68C212C5046B49A41E56B95068BA84D3DAD72C9A64EB100516B  Jiafee-FX-Patch-2.4.0-Portable.zip
67C453EBF5A23312FFF0744F288DE427706FD60658D6D516F5E80E5D3E7ACF12  Mineradio-Together-Relay-Control-1.0.2-Setup.exe
```

自动化身份、队列与退出路径测试 30/30 通过；增强回归和三种注入组合测试通过。用户已完成真实双机端到端验收，详见 `docs/TEST-RESULTS.md`。
