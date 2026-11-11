# Persist Android（USB 调试安装）

该目录是 Capacitor 8 Android 外壳。Web 内容来自 `dist-mobile`，默认进入 owner；不会加载生产 web 的 demo / guest 入口，也不会把 owner 入口暴露到网页。

## 前置环境

- Node.js 22+
- Android Studio（含 SDK Platform 36、Android SDK Build-Tools、Platform-Tools）
- JDK 21+；建议把 `JAVA_HOME` 指向 Android Studio 自带 JBR，例如 Windows 的 `C:\Program Files\Android\Android Studio\jbr`
- 手机已开启开发者选项与 USB 调试，并已授权当前电脑

当前仓库开发机如果仍是 JDK 8 且没有 adb / Android SDK，`npm run android:check` 会明确报错；完成 Android Studio 安装后再继续。

## 配置 API 地址

复制示例文件：

```powershell
cd D:\Persist\app
Copy-Item .env.mobile.example .env.mobile.local
```

编辑 `app/.env.mobile.local`：

```text
VITE_PERSIST_API_BASE_URL=http://<服务器地址>
```

只填服务器 origin，不要带 `/api`、路径、查询参数或账号密码。该文件已被 `.gitignore` 排除，真实 IP 不进仓库，也不打进 APK 之外的文档。

服务端必须允许 Capacitor 的本地 origin `https://localhost`。默认已允许；部署时可用 `PERSIST_ALLOWED_ORIGINS` 覆盖多个 origin。CORS 只是浏览器访问控制，不是 API 鉴权。

当前服务器仍是 HTTP，因此 Android 工程暂时允许 cleartext / mixed content。域名与 HTTPS 完成后应移除 `cleartext`、`allowMixedContent` 与 Manifest 中的 `usesCleartextTraffic`。

## USB 安装

先把手机与电脑连接，确认手机端已允许 USB 调试：

```powershell
cd D:\Persist\app
npm run android:check
```

检查通过后构建、同步并安装：

```powershell
npm run android:usb
```

脚本会依次执行：

1. `npm run build:mobile`
2. `npx cap sync android`
3. `android/gradlew installDebug`

调试 APK 输出：

```text
app/android/app/build/outputs/apk/debug/app-debug.apk
```

如果使用 Android Studio：

```powershell
npm run android:sync
npm run android:open
```

然后在 Android Studio 选择已连接手机并运行。`android:open` 前必须先 `android:sync`，否则 Android 工程内仍可能是旧 Web 产物。

## 首次安装后确认

- 启动后直接进入 owner 产品，不出现网页的“返回首页 / 首页”入口。
- 设置页能看到“数据同步”卡片，owner 的 AI 入口不应回退为 demo / guest。
- 真机上的数据位于 Android WebView 的 `persist-app` IndexedDB，与手机 Chrome 的站点数据隔离。
- AI 观察卡、晨间简报和综合分析需要手机能访问配置的服务器 origin，并且服务端 `/api/health` 返回 `ai:"deepseek"`。

## 不要提交

- `.env.mobile.local`
- `android/local.properties`
- keystore / signing 文件
- `android/app/build/`
- `android/app/src/main/assets/public/` 与生成的 Capacitor 配置

## 发布前提醒

当前是作者自用调试安装，不包含生产签名配置。不要直接把 debug APK 分发给他人；面向用户提供生成式 AI 前仍需完成服务端 token 门、来源限制、配额、审计与专门备案 / 安全评估。