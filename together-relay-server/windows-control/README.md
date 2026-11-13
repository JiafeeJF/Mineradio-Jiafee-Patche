# Mineradio 一起听中转控制台（Windows）

当前版本：1.0.2。该版本内置支持账号身份字段与同账号拒绝的中转运行时。

这是现有 `together-relay-server` 的 Windows 图形控制端。它打包同一套中转运行时，不修改 Mineradio 客户端协议，也不影响 Docker 部署。

## 功能

- 启动、停止、重启中转服务，最小化到系统托盘。
- 配置监听地址、TCP 端口、公开地址、房间名称和局域网免授权。
- 使用 Windows DPAPI 加密保存 6 位授权码。
- 显示健康状态、在线人数、PID、运行时间和连接入口。
- 查看实时日志、导出脱敏诊断、复制 Windows 防火墙放行命令。
- 可设置登录 Windows 后启动控制台，并自动启动中转服务。
- 服务异常退出时最多自动恢复三次。
- 安装包自带独立 Node.js 运行时，不要求服务器额外安装 Node.js。

## 开发与测试

```powershell
cd together-relay-server\windows-control
npm install
npm test
npm start
```

## 构建安装包

```powershell
npm run build:win
```

输出位于 `dist/`。安装后首次打开会自动生成 6 位授权码；请在“配置”页查看或更换。公网使用前还需在云安全组和 Windows 防火墙放行配置的 TCP 端口。

“登录 Windows 后自动运行”是当前用户登录后的启动项，不是无需登录即可运行的 Windows Service。关闭主窗口会隐藏到托盘；通过托盘菜单“退出控制台并停止服务”才会结束后台进程。

