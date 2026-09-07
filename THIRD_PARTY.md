# 第三方来源与声明

本仓库代码按 MIT 许可证提供，见 [LICENSE](LICENSE)。原 Expo 模板的版权声明保留，新贡献不代表拥有第三方项目或商标的所有权。

## Expo 模板和图形

项目起始于 Expo 模板。`assets/` 中仍保留模板自带的 Expo / React 图形与图标资源；不将这些图形描述为本项目独立创作，也不暗示得到 Expo、React 或 ZCode 官方背书。公开商店上架前应另行确认应用图标、名称和商标展示。

## 依赖

`package.json` 与 `bun.lock` 是依赖与版本的依据。2026-09-07 对已安装的 42 项直接运行依赖检查时，包元数据均声明 MIT，包括 Expo SDK、React / React Native、Zustand、noble-hashes、buffer、Markdown 渲染器与手势/动画库。

这不是所有传递依赖、字体、原生系统库的完整授权清单。分发 APK 时，必须另外核对实际打包的原生依赖、字体和图形，并保留所需版权、许可证和 NOTICE 文件；不能仅用本项目的 MIT 文件替代它们。

源码仓库不包含 `node_modules/` 或第三方预构建程序。安装依赖时应保留包内许可证；复制、修改或打包第三方文件时沿用其声明。

## 本地补丁与字体

- `query-string@7.1.3` 与 `image-size@1.2.1` 的修改保存在 `patches/`，原包的 MIT 声明分别在 [query-string-MIT.txt](third_party/query-string-MIT.txt) 与 [image-size-MIT.txt](third_party/image-size-MIT.txt)。改动范围见 [依赖维护说明](docs/dependency-maintenance.md)。
- `@expo/vector-icons` 和内置 `react-native-vector-icons` 的 MIT 声明分别保留在 [expo-vector-icons-MIT.txt](third_party/expo-vector-icons-MIT.txt) 与 [react-native-vector-icons-MIT.txt](third_party/react-native-vector-icons-MIT.txt)。
- 本项目图标使用 Ionicons，源码按 `@expo/vector-icons/Ionicons` 子路径导入，不通过总入口引入其他图标集。保留 [Ionicons MIT 声明](third_party/Ionicons-MIT.txt)，文本来源为 [Ionic 上游许可证](https://github.com/ionic-team/ionicons/blob/v7.4.0/LICENSE)；不以该链接推断 Expo 内置字体的精确版本。
- Expo 传递依赖中的 Material Symbols 字体按其包内 `LICENSE_FONT` 保留 [Apache 2.0 许可证](third_party/MaterialSymbols-Apache-2.0.txt)，不能用 npm 包壳的 MIT 元数据替代字体许可证。
- 实际 APK 的字体清单与清理前后大小见 [候选检查](docs/release-readiness.md)。本目录里的声明不是所有原生依赖的完整 NOTICE 集；正式 APK 分发前还需完成该项核对。

## ZCode

ZCode 名称及其官方产品属于各自权利人。本项目是独立第三方客户端，不分发官方桌面软件、官方 Web 应用包或引擎，也不取得它们的授权。用户自行安装官方产品、授予远程访问，并遵守适用的产品条款。
