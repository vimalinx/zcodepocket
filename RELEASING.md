# 发布流程

源码发布和正式签名 APK 发布是两件事。这里列出准备流程，不自动创建仓库、修改可见性、打 tag、推送或发布 Release。

## 1. 审阅候选源码

保留未提交修改，确认本次差异和 [docs/release-readiness.md](docs/release-readiness.md) 中的遗留项。使用锁定依赖运行：

```sh
bun install --frozen-lockfile
npm test
npx tsc --noEmit
npm run lint
npm run check:release-source
gitleaks git --redact --no-banner .
bun audit
```

`check:release-source` 检查版本、仓库元数据与候选文件范围；它不代替秘密扫描、依赖审计、版权审阅或实机验收。另对已跟踪文件和将提交的新文件做工作区秘密扫描，不扫描或打包本机日志、数据库与私有归档。

## 2. 确定发布范围

- 本次源码候选的发布文案在 [docs/releases/v1.0.8.md](docs/releases/v1.0.8.md)，仍是草稿；仅推送源码不要求同时发布 APK。
- **源码候选**：许可证、贡献说明、隐私说明和已知问题都应随源码提交；未完成实机验收不能宣称正式稳定版。
- **正式 APK**：先确定长期保管的独立签名密钥、备份方式与证书指纹。不得复用 Expo / Android 默认调试密钥。
- 已有调试签名安装与新签名不能直接按普通更新互相覆盖。不要为改签名擅自卸载现有应用、清除数据或改包名；先与使用者确定迁移方案。
- 现有公开 Release 不自动删除、替换或改写历史，需要维护者另行决定。

签名生成与配置按照 [Android 官方签名说明](https://developer.android.com/studio/publish/app-signing)；原生配置应通过 [Expo config plugin](https://docs.expo.dev/config-plugins/plugins/) 管理，不把唯一配置留在会被 prebuild 重建的目录。当前仓库仍保持本地调试签名构建；正式签名配置尚未启用。

## 3. 验证 APK

`app.json` 的版本和构建号、`package.json` 版本必须一致。构建后按下面的格式命名：

`zcodepocket-<版本>-<构建号>-arm64-v8a.apk`

在本地安全环境中设置 `ZCODEPOCKET_RELEASE_CERT_SHA256` 为维护者确认的正式签名证书 SHA-256 指纹（公开指纹，不是私钥或密码），然后运行：

```sh
npm run verify:release-apk -- builds/zcodepocket-1.0.8-38-arm64-v8a.apk
```

检查器需要 `apksigner` 和 `aapt`。它验证签名、证书指纹、包名、版本、构建号、文件名、arm64 ABI 与非 debuggable 标志，并输出 APK 的 SHA-256。默认调试签名必须失败，不能通过忽略退出码放行。检查器不会上传、安装或重新签名。

实机另外验证覆盖安装与数据保留、扫码/解除配对、跨工作区会话、创建与返回、消息收发、重新生成、背景导入以及系统返回。使用者亲自测试的项目应由使用者确认，不把模拟测试当作实机结果。

## 4. 人工确认后发布

检查 `git diff` 和待提交文件后，由维护者确认提交、目标分支、tag、公开 Release 文案与附件，再执行推送/发布。不要对结果未知的上传盲目重试。

正式 tag 为 `v主.次.修订`。应用更新目前只读 GitHub 最新正式 Release，忽略 draft/prerelease；不要为了让应用发现候选版本而把未验收 APK 标成正式版本。最终附件包括已验签 APK、校验值和所需第三方声明。
