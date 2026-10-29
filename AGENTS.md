# 项目开发约定 — Band 9 NFC 分支

与用户使用中文沟通。先读 `HANDOVER.md` 和 `docs/band9-adaptation.md`。本分支是原项目的独立 Fork 适配，不是作者原签名版本的覆盖更新。

## 本次边界

- 目标为小米手环 9 NFC 的基础骑行导航，不做地图、独立定位或新导航引擎。
- 高德解析器、SendPolicy、WearBridge、后台服务及通信消息格式保持冻结。仅允许 `NavigationNotificationListener.java` 调整多条高德通知的候选选择，使用纯 Java `NavigationCandidateSelector.java` 及单元测试；不得扩大到通知字段抓取、导航算法或额外权限。`android/app/build.gradle` 仍只通过 `-Pband9` 选择独立包名/版本/签名，原 namespace 不改。
- `wearable/` 保留 9 Pro 原版对照。新目标是 `band9/`，不得把原版字体、设置页或多套箭头带入新 RPK。
- `band9/src/common/protocol.js` 是上游逐字节副本，测试锁定其 Git blob SHA；不要为振动改协议。
- 振动模块只读取已验证的消息。不得补造距离/方向，不得把传输 session 当作路线 ID，不得每条 seq 或心跳都振动。
- 阈值 150m / 50m / 20m；掉头最终 30m。每动作每档去重，同包多档取最高优先级。隐藏、断连、过期、演示不排队补振。即时文案与同向连续路口识别是保守启发式，不能声称可靠识别所有路口。
- 手环仅承诺前台振动调用，不承诺系统后台保活。亮屏是前台 keepScreenOn，不是 AOD；所有退出路径释放常亮和延迟短振。

## 构建与签名

- `npm run test:band9` 跑新目标测试；`npm test` 跑原版和新增测试。
- 使用 `npm run deps:band9` / `npm run build:band9`，不要误打 `wearable/` 原包。
- `band9/package.json` 沿用上游锁文件的工具链元信息；应用包名/版本以 `band9/src/manifest.json` 为准。
- 新 APK / RPK 包名统一为 `com.bewoodw.band9.navigation`，新身份位于 `signing/band9/` 与 `band9/sign/`。只能首次生成或复用本机私有备份；不得轮换已安装身份，也不得碰原版 `signing/development.p12` / `wearable/sign/`。
- 缺少密钥必须失败，禁止退回 toolkit 默认签名。不要提交密钥、证书目录、APK/RPK、SDK AAR、用户通知原文、设备凭据或路线数据。
- 用户本轮只授权改代码和提交；打包/安装由用户随后指令 Codex。分开记录源码测试、编译、签名检查、传输、安装和实机效果。

## 验收与安全

在当前 Git 工作区先检查未提交改动，不能覆盖用户变更。不要自行 root、恢复出厂、刷固件、降低系统安全或替换运动健康。只检查本项目和高德相关通知，不能采集其他应用通知。

上游历史规则与验证见 `docs/upstream-AGENTS.md`、`docs/upstream-HANDOVER.md`，它们属于 9 Pro 原版，不可当作本分支或手环 9 NFC 的测试证明。
