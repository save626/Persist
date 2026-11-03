# Server

Fastify 服务端。承载 DeepSeek API 代理（P3）、后续账号态同步与备份服务（P4）。

## 约束

- 监听 `127.0.0.1:3000`，**不直接对外**；生产由 Nginx 反代 `/api/*`（见 `docs/部署与服务器现状.md`）。
- 服务器运行时是 **Node.js v20.20.2**（本机为 v22.19.0），代码与依赖必须兼容 Node 20；`engines` 写 `>=20.19`。
- 任何 API Key 只能保存在服务器 `/etc/persist/server.env`（权限 `600`）；仓库只提交 `.env.example`，禁止 Key 进入 Web 构建产物或 Android 安装包。
- P3 阶段**不引入数据库**（DeepSeek 代理是无状态转发；Node 20 无内置 `node:sqlite`，SQLite 留到 P4 选型）。
- 前端只请求相对路径 `/api/*`；本地开发用 Vite `server.proxy` 指向 `127.0.0.1:3000`，不在前端写死 IP 或域名。
- 流式接口按 SSE 设计；Nginx 侧需 `proxy_buffering off`（草案见部署文档 §8）。
