# TodoTime

双人共享时间规划日历。当前版本包含：用户名密码登录、首位用户管理员、最多两位成员、周视图和月视图日历、全天/待安排任务、跨天时间段、重复任务、私人任务遮罩、拖拽调整、评论、站内通知、浏览器通知、回收站和管理员重置密码。页面每 5 秒自动同步当前视图数据。

## 本地运行

要求 Node.js 18+（推荐 Node.js 20）。

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。第一个注册用户自动成为管理员，第二个注册用户成为成员；达到两位后注册会自动关闭。

生产模式：

```bash
npm run build
NODE_ENV=production JWT_SECRET='请替换为随机长字符串' npm start
```

生产服务默认监听 `3030` 端口。SQLite 文件位于 `data/todotime.sqlite`，请定期备份整个 `data` 目录。

## Docker 部署

```bash
docker compose up -d --build
```

服务监听 `3030`，数据库通过 Docker volume `todotime-data` 持久化。阿里云上建议再用 Caddy/Nginx 做域名反向代理和 HTTPS，并把 `JWT_SECRET` 改为随机值。

## 重要说明

- 时间按中国标准时间展示，数据库以 ISO 时间保存。
- 当前通知是站内通知和浏览器页面内体验；短信/微信通知尚未接入。
- 密码找回采用管理员在“空间设置”中重置成员密码；没有邮箱或手机号验证。
- `npm run db:reset` 会删除本地 SQLite 数据库，仅用于开发验收。
