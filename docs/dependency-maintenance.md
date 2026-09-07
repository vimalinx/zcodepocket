# 锁定依赖与本地补丁

使用 `bun install --frozen-lockfile`。`packageManager` 固定 Bun 版本，`preinstall` 拒绝不应用 Bun 补丁的其他包管理器。不要通过禁用安装脚本、删除锁文件或移除补丁绕过失败；普通 `npm run` 不受影响。

本次源码候选为 `1.0.8` / Android `38`，与手机上已安装的 v37 不同；旧 APK 没有这些依赖改动。

## 升级与适配

- `decode-uri-component` 固定为修复拒绝服务问题的 `0.5.0`。[上游公告](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)。它改为 ESM，因此给 `query-string@7.1.3` 保存了一个小型 Bun 补丁：兼容 default 导出，保留旧版将字面 `+` 作为空格的行为。不自行重写 UTF-8 解码器。
- `uuid` 固定为仍提供 CommonJS 入口的修复版 `11.1.1`。[上游公告](https://github.com/advisories/GHSA-w5hq-g745-h8pq)。本仓库锁文件中入口是 `xcode@3.0.1`；检查了它实际调用的 `generateUuid()`，仍得到 24 位大写十六进制 ID。
- 2026-09-07 本地验证：64 项新旧 `query-string` 结果比较（中文、加号、重复参数、数组、畸形编码、fragment、stringify），长畸形编码在受限子进程内完成；1000 次实际 xcode UUID 调用及短输出 buffer 拒绝检查通过。这些额外检查不是手机功能验收。

## image-size@1.2.1

检查时最新公开版仍为 `2.0.2`，两项公告未列修复版：[ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)、[JXL / HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)。本仓库保留原来 Metro 要求的 1.x API，用 Bun 补丁收紧两个解析入口：

1. ICNS 条目长度必须是至少 8 的整数；零长度和截断头部立即抛错，不能留在原偏移上循环。
2. ISO box 头至少 8 字节，声明长度小于 8 或超出可用输入时不返回 box；避免匹配到零长度 `jxlp` 后外层循环停在原位置。

这是严格的防御性解析策略，不扩展格式支持：尺寸为 0 的 ISO box（按部分容器约定代表直到文件末尾）也被拒绝，不作兼容承诺。合法 PNG 资源与多条目 ICNS 的尺寸读取已核对，ICNS 零/短条目和 JXL 零 box 在限时子进程中快速失败。手机背景使用的原生 Expo 图片组件不由这个构建工具补丁替代。

补丁文件仍对应 `image-size@1.2.1`，所以 `bun audit` 仍报告 **2 条 high**。不能把本地缓解写成“审计零告警”或“上游已修复”；正式 APK 放行仍需维护者审阅或等待合适的上游修复。

## 后续维护

- `patches/` 和 `patchedDependencies` 必须一同提交；Bun 安装会校验并应用补丁，不修改共享原始包缓存。
- 更新 Expo、Metro、query-string、decoder 或 uuid 时，重新核对依赖入口、CJS/ESM 接口与锁文件，重做上述兼容检查，并验证干净安装、完整测试、类型检查和 Android 构建。
- 上游有合适修复版后优先升级并移除本地补丁；不能仅因审计数量下降就跳过回归。
- 补丁仅修改查询参数适配与无效图片容器头检查；没有复制官方 ZCode 代码、引入替代网关或变更远程请求语义。对应原包的 MIT 声明保留在 `third_party/`。
