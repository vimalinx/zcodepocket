# 开源与发行候选检查（2026-09-07）

候选版本：`1.0.8` / Android `38`。源码候选包含依赖修复与按需图标导入；准备阶段确认的手机安装版本为 v37。本文件记录提交前的验证，不是安全认证；远端提交与 CI 状态以 [GitHub 仓库](https://github.com/vimalinx/zcodepocket) 和 [Actions](https://github.com/vimalinx/zcodepocket/actions) 为准。

## 远端与安装现状

- 准备阶段检查时 `vimalinx/zcodepocket` 已是公开仓库，已有正式 Release `v1.0.6`。源码提交和正式 APK 发布独立进行；本轮源码提交不打 Release tag，也不上传或替换 APK 附件。
- 公开 `v1.0.6` APK 的 SHA-256 与本地 v36 构建一致；该构建使用 Expo 默认调试证书。现有公开附件的处置需要维护者决定，本次没有删除或替换。
- v37 已于 2026-09-07 13:52（Asia/Shanghai）使用 `adb install -r` 成功覆盖安装，未卸载或清除数据。设备包信息核实为 `versionName=1.0.7`、`versionCode=37`；尚未操作应用界面，不能把安装成功算作功能实机验收。

## 已准备

- MIT 许可证保留 Expo 原声明，并注明项目贡献者；补充贡献、安全、第三方和发行说明。
- 项目元数据、锁定依赖安装及源码 CI。CI 只有源码检查，没有发布写权限、签名私钥或自动上传。
- 源码候选范围检查，明确排除生成原生工程、APK、密钥、数据库和日志。
- APK 发布检查：正式证书指纹必须由维护者提供；默认调试证书、版本/包名/文件名不符、可调试或 ABI 不符均不放行。
- Git 历史秘密扫描：2 个提交；v38 的 141 个候选文件另行扫描，两者均为 0 条发现。零发现不构成没有秘密或漏洞的保证。

## 本地验证结果

- v38 本地锁定安装、148 项自动测试、TypeScript、ESLint、源码范围/版本检查通过。
- 独立源码副本中，使用最低支持的 Node `22.13.0`、Bun `1.3.14` 全新安装（827 个包）；148 项测试、类型检查、lint 均通过，确认补丁由锁文件重新应用。使用 JDK 17 / Android SDK 36 预构建并完成 arm64 Release 构建（532 项任务，3 分 6 秒）。仍依赖本机 Android SDK 与下载缓存，不等于所有操作系统均已验证。
- 64 项新旧查询参数结果比较、长畸形编码的限时检查、1000 次实际 xcode UUID 调用、图片解析器零/短头部快速失败检查通过。细节见 [依赖维护说明](dependency-maintenance.md)。
- 提交前 CI YAML 和动作完整 commit pin 检查通过；推送后的托管运行结果见 [Source checks](https://github.com/vimalinx/zcodepocket/actions/workflows/ci.yml)，不以本地检查冒充远端 CI 结果。
- 发布检查器用真实 v37 / v38 APK 验证，按预期拒绝其默认调试签名；另检查了指纹不符、多签名、版本/ABI 不符和 debuggable 拒绝路径。没有正式签名 APK 可验证成功放行路径。
- v38 本地验证 APK：`builds/zcodepocket-1.0.8-38-arm64-v8a.apk`；SHA-256：`3fa09b1ea30128467dd02598c469610aa15f16a6beea54413fdc10e71bf7899c`。包名、版本 1.0.8、构建号 38、arm64 ABI 与签名已核对；没有安装或公开发布。
- 已安装的旧 v37 APK：`builds/zcodepocket-1.0.7-37-arm64-v8a.apk`；SHA-256：`324b7375e46dc4790804f7431b23fdba41f8de531a7684896328265a4b07e835`。它不包含 v38 的依赖改动。

## 依赖审计：已升级两项，其余有本地补丁

v37 原锁文件有 3 个包、4 条告警。v38 升级并验证 decoder / uuid 后，`bun audit --json` 剩下 `image-size` 的 **2 条 high**；本地补丁不会改变包的版本号，所以审计仍然失败，不能标成零告警。

| 当前包 | 已核对的依赖入口 | 告警与处理边界 |
| --- | --- | --- |
| `image-size@1.2.1` + 本地补丁 | RN Metro 工具链的 `metro@0.87.0` | 两项 high；本地补丁拒绝 ICNS 非法条目长度和零/短 ISO box，已验证循环路径快速失败。上游公告仍未列修复版：[ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)、[JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)。正式放行仍需审阅本地缓解。 |
| `decode-uri-component@0.5.0` | `expo-router → query-string@7.1.3` + ESM 兼容补丁 | 已升级到公告修复版，保留旧查询参数的 `+` 行为；本次版本审计不再报告该项。[公告](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)。 |
| `uuid@11.1.1` | `@expo/config-plugins → xcode@3.0.1` | 已升级至仍有 CommonJS 入口的修复版，验证了实际 `generateUuid()` 调用；本次版本审计不再报告该项。[公告](https://github.com/advisories/GHSA-w5hq-g745-h8pq)。 |

源码可作为带有上述说明的开发候选分享，但不应宣称安全稳定。本地有限回归不等同于独立安全审计，也不能证明 APK 绝不受影响。

## 字体分发范围

v37 APK 实际包含 20 份字体，未压缩共 5,040,616 字节；SHA-256 对照本地依赖后，对应 19 份 vector-icons 字体和一份 Material Symbols。应用源代码只使用 Ionicons，v38 将 14 处总入口导入改为 Ionicons 子路径，移除无用字体以缩小分发范围。

v38 APK 实际只剩 2 份字体，共 1,353,500 字节：

| 字体 | 字节 | SHA-256 |
| --- | ---: | --- |
| Ionicons | 389,724 | `fa2ab7d2557819b2bfe5009e46844efa7170cf177be7735d43aa2ac1295f1d54` |
| Material Symbols Regular | 963,776 | `53e4f7bd9f6ee6bbd8d428f2cb38a0e0036f1afa0d9731cf18eac75f6b59fca3` |

字体内容按哈希与原依赖匹配，未重绘或修改。APK 总大小从 56,397,221 降为 54,235,913 字节，减少 2,161,308 字节（约 2.06 MiB）；这是整包差值，同时包含本次依赖升级，不归因于字体这一项独立因素。旧 APK 保留。对应许可原文保留在 `third_party/`，尚不构成所有原生依赖的完整清单。

## 源码交付

本地生成 `builds/zcodepocket-1.0.8-source-candidate.tar.gz`，只包含候选源码、资源、补丁和说明，不含 Git 历史、依赖目录、生成工程、日志、密钥或 APK。压缩包内顶层目录是 `zcodepocket-1.0.8/`；解压后按 README 用 Bun 安装和构建。

APK 和源码压缩包的 SHA-256 另存于 `builds/zcodepocket-1.0.8-candidate.sha256`。这些本地产物不是远端 Release；文案草稿在 [releases/v1.0.8.md](releases/v1.0.8.md)。

## 正式 APK 放行前仍需决定或补齐

1. 长期正式签名与备份，以及旧调试签名用户的数据迁移路径；不通过擅自卸载来换签名。
2. 剩余 image-size 告警的上游修复或对本地补丁的审阅与风险处置。
3. 实际打包的传递依赖、字体、图标及原生库的许可证 / NOTICE 清单。现有直接依赖元数据检查不是完整分发授权审阅。
4. 最新候选版本的用户实机验收，包括直接在指定工作区创建、导航、移动网络收发和应用内数据完整性；仅 v37 覆盖安装已完成。iOS 未实机验收。
5. 维护者确认提交、目标分支、tag、Release 文案与附件。自动更新只接受正式 Release，不能用它分发未验收候选版。
