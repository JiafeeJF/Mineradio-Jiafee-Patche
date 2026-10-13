# Mineradio 一起听中转服务

这是与 Jiafee-FX-Patch 2.3.0 一起听模块兼容的独立服务端。一台容器代表一个双人房间，双方在一起听面板中输入相同的服务器 `域名:端口`（或 `IP:端口`）和 6 位授权码即可连接，无需填写 `wss://`。

## 使用域名直接连接

1. 将域名的 DNS A 记录指向服务器公网 IP。使用带 CDN 的 DNS 服务时，该记录需使用仅 DNS 解析模式，或配置支持原生 TCP 的转发服务。
2. 将 Docker 的 TCP 端口映射到服务器，并在防火墙及云安全组中允许该端口。默认是 `17861/tcp`。
3. 双方都选择“加入服务器”，填写 `music.example.com:17861` 和部署者提供的授权码。

客户端 2.3.0 已内置这种地址识别方式，会使用 Mineradio 原生 TCP 协议，无需升级客户端。裸域名后必须填写端口；不要用 `域名:443` 连接普通 HTTPS 反向代理。

`PUBLIC_ADDRESS` 用于在启动日志中显示可直接复制的连接地址，例如 `music.example.com:17861`。它不自动配置 DNS 或端口转发，填写的端口应与 `PUBLIC_PORT` 一致。

服务端维护权威播放状态并中转播放、暂停、切歌、进度、队列、头像和文字互动数据。它不传输歌曲音频，不提供音乐资源，不接触音乐平台账号，也不把房间数据写入磁盘。容器重启后会话随即清空。

## Docker Compose 部署

服务器需要安装 Docker Engine 和 Docker Compose 插件，并开放一个 TCP 端口。进入本目录后执行：

```bash
cp .env.example .env
```

编辑 `.env`，把 `AUTHORIZATION_CODE` 换成你自己的 6 位数字，将 `PUBLIC_ADDRESS` 改成自己的 `域名:端口`（不用域名时可填写公网 IP:端口或留空）。然后启动：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

默认监听服务器的 `17861/tcp`。如果服务器公网 IP 是 `203.0.113.10`，用户在 Mineradio 一起听面板中填写：

```text
服务器地址：203.0.113.10:17861
授权码：你在 .env 中设置的 6 位数字
```

两名用户都选择“加入服务器”。第一名进入后等待，第二名进入时服务端会建立新的双人播放会话并清空之前的联机播放状态。

## 直接使用 docker run

从仓库根目录构建：

```bash
docker build -f together-relay-server/Dockerfile -t mineradio-together-relay:2.3.0 .
docker run -d --name mineradio-together-relay --restart unless-stopped \
  -p 17861:17861/tcp \
  -e AUTHORIZATION_CODE=482731 \
  -e ROOM_NAME="JIAFEE 一起听中转" \
  --read-only --tmpfs /tmp:size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  mineradio-together-relay:2.3.0
```

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `17861` | 容器内 TCP 监听端口 |
| `PUBLIC_PORT` | `17861` | Compose 映射到宿主机的端口 |
| `PUBLIC_ADDRESS` | 空 | 启动日志显示的 `域名:端口` 或 `IP:端口`，不改变监听地址 |
| `ROOM_NAME` | `Mineradio 一起听中转` | 客户端探测时显示的名称 |
| `AUTHORIZATION_CODE` | 无 | 必填，必须为 6 位数字 |
| `ALLOW_LAN_WITHOUT_AUTH` | `false` | 是否允许私网来源免授权码；公网部署建议保持关闭 |
| `DEBUG` | `false` | 输出协议状态变化日志，不记录音乐音频 |
| `SERVER_ID` | 启动时随机生成 | 可选；固定后便于识别同一服务实例 |

## 运维说明

- 防火墙和云安全组只需要放行映射后的 TCP 端口，例如 `17861/tcp`，不需要开放 UDP。
- 该端口同时支持 Mineradio 原生 TCP 协议、`GET /status` 和 WebSocket `/together`，通常直接映射 TCP 最稳定。
- 如果使用域名，可在客户端填写 `域名:端口`。当前原生 TCP 连接不提供 TLS；需要加密公网链路时，可在前面配置支持 WebSocket Upgrade 的 HTTPS 反向代理，然后使用 `wss://域名/together`。
- 单个实例最多连接两名用户。需要多组用户时，启动多个实例并映射不同宿主机端口。
- 状态保存在内存中，没有数据库、后台管理面板或用户注册系统。
- 查看健康状态：`docker inspect --format '{{json .State.Health}}' mineradio-together-relay`。

## 更新与停止

```bash
docker compose up -d --build
docker compose down
```

停止容器会通知在线客户端并清空当前会话。重新启动后，用户可按客户端自带的最多 3 次重连流程恢复连接，但播放会话会以新房间状态开始。
