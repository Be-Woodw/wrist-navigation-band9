# 腕上导航 · 小米手环 9 / 9 NFC 适配分支

基于 [Gu-Mie/wrist-navigation](https://github.com/Gu-Mie/wrist-navigation) 的独立适配，原项目与贡献者的 MIT 许可保持不变。与高德、小米、AstroBox 无隶属关系。

**当前为源码实现，尚未打包或完成本版本真机验收。** 用户已验证独立 Hello World RPK 在手环 9 NFC 正常安装，但这不证明本导航应用或振动已通过实机测试。

## 两个构建目标

| 目录 | 用途 |
| --- | --- |
| `band9/` | 新版：192×490、系统字体、单套固定箭头、距离/方向、原文兜底、分级振动 |
| `wearable/` | 原版 9 Pro 对照，保持原样；其字体与显示设置不打入 Band 9 包 |
| `android/` | 共用原版手机业务代码；构建时加 `-Pband9` 选择独立身份 |

Band 9 复用原版通知监听、解析、发送、自动打开、后台同步与通信协议。没有新增定位、路线规划、云端服务或 MCP 运行依赖。

## 骑行振动

新指令短振；首次进入 150m 短振；50m 双短振；20m 转向长振；掉头改为 30m 长振；真实导航结束短振。一次更新跨过多档仅发最高级提醒。重复消息、8 秒心跳、演示和后台隐藏不振动。

**振动只基于收到的高德通知，不是精确路口检测。** 通知跳过最后距离时不能补造最终提醒；连续同向转弯没有可靠路口 ID，只能保守结合距离回升和原文变化判断。见 [实现与打包交接](docs/band9-adaptation.md)。

## 开发与交付

```sh
npm run test:band9
npm test
npm run deps:band9
npm run build:band9
```

构建前需要在本机准备自己的成对签名。新包名为 `com.bewoodw.band9.navigation`，必须配套安装同身份的 Android APK，不能混用原作者 APK。

**Codex 从 [HANDOVER.md](HANDOVER.md) 开始，再按 [打包步骤](docs/band9-adaptation.md) 操作。** 原项目的预览工具仍展示 9 Pro，不代表 Band 9 的实际页面。

[上游原始介绍](docs/upstream-README.md) · [上游交接存档](docs/upstream-HANDOVER.md) · [许可](LICENSE)
