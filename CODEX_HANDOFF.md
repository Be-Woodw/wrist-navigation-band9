# Codex 本地交接｜小米手环 9 NFC 高德导航

更新时间：2026-10-29

## 任务目标
验证并交付 `Be-Woodw/wrist-navigation-band9` 的 `band9-nfc-haptics` 分支。用户希望高德步行/骑行导航的方向和距离实时显示在小米手环 9 NFC 上，并在新指令、150m、50m、20m（掉头 30m）和结束时振动。**不要重新设计 Android 手机界面，不要重写高德解析器、XMS 通信或手环消息协议。**

## 远程仓库与最新提交
- 仓库：https://github.com/Be-Woodw/wrist-navigation-band9
- 分支：`band9-nfc-haptics`
- 轻量化+振动基线：`7b0b7131588eb1ba8119f159d0dd6de839348cbd`
- 高德双通知选择修复：`cfb1a2cf611533ee046035fd19a4b0e1ac52810b`
- 仓库根目录已有 `AGENTS.md`、`HANDOVER.md`、`docs/band9-adaptation.md`，先阅读。

## 实机反馈与定位
1. 作者原版 9 Pro 的 RPK 在小米手环 9 NFC 上传输到 100% 时会重启；自建极简 Hello World RPK 已成功安装并正常显示。
2. 轻量版导航 RPK 已显示界面，但曾显示未知方向（i）、空距离（—）、“请查看导航原文”。
3. 手机高德应用内导航显示“82米后直行”，系统通知栏**同时存在两张高德通知**：实时卡“82米后直行”以及通用持续状态卡“高德地图持续为您导航／正在为您步行导航”。
4. 原版 `NavigationNotificationListener.java` 在多个解析成功的候选中只按 `sbn.getPostTime()` 选最新；通用状态卡可能覆盖真正的转向卡。
5. 2026-10-29 GitHub 提交 `cfb1a2c` 已新增 `NavigationCandidateSelector.java`，候选排序：有方向+距离 > 有方向但无距离 > 普通状态；较新的明确结束通知优先。新增 8 项 JUnit 测试；原 `NavigationParser.java` 和其他 Android 导航业务代码没有改动。
6. 注意：系统通知**视觉上**有转向文字，不等于 `Notification.extras` 一定含有同样字段。这是下一轮实机验证重点；如果读取不到，先有限度诊断，不要擅自重写整个系统。

## 本地工作区
上次 FileMCP 显示：
`C:\CodexopenAI\home\worktree\1n2c\手环导航\wrist-navigation-band9`
目录当时为空。**先核实是否已有文件或未提交修改，勿覆盖。**

如果目录确实为空：
```powershell
cd "C:\CodexopenAI\home\worktree\1n2c\手环导航\wrist-navigation-band9"
git clone --branch band9-nfc-haptics https://github.com/Be-Woodw/wrist-navigation-band9.git .
git rev-parse HEAD
```
如果已是 Git 工作区：先 `git status --short` 和 `git remote -v`；检查变更后再 `git fetch` / `git pull --ff-only`，不可盲目覆盖。

## 执行和验证顺序
1. 校验当前分支/提交，阅读上述三个项目文档。
2. 运行 `npm test` 和 `npm run test:band9`，检查新增 8 项 Java 候选排序测试。
3. Android：`./android/gradlew.bat -p android -Pband9 :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --console=plain`（PowerShell 下使用 `.\android\gradlew.bat`）。先检查 JDK 17+、Android SDK、XMS AAR 和本机成对签名；签名私钥不得提交。
4. 应用身份：APK/RPK 都使用 `com.bewoodw.band9.navigation`，不是作者原 `io.github.mi9pro.navigation`。不要把新版 RPK 和原作者 APK 混用。
5. 为检查本轮通知修复，主要需要**重新构建 APK**；如果 RPK 未变化，不必为了这次 Java 逻辑修复而重新设计或编译 RPK。
6. 用实际高德导航做静止测试：诊断当前可读的高德通知数量、选中的方向和距离，确认实时卡是否进入 Android 标准通知文本字段。只采集高德及本项目字段，脱敏路线与地点；不保存其他 App 通知。
7. 验证手环显示、指令改变、150m/50m/20m（掉头30m）振动，导航结束与锁屏同步。若高德通知跳过阈值，不能声称精确路口提醒。
8. 向用户分别报告：源码测试、编译、签名、安装、通知字段、真机功能是否通过。不要把模拟通过写成真机通过。

## 严格约束
- 不碰原 `wearable/`（9 Pro 对照版）；新手环目标是 `band9/`。
- 保持 Android 原 UI、`NavigationParser.java`、`WearBridge.java`、`SendPolicy.java`、通信协议不变。
- 暂不优化 RPK 视觉设计；优先验证新 APK 是否修复数据源。
- 小范围再改时先补回归测试，使用独立分支/提交。
- 不上传私钥、AuthKey、SDK 私有文件、安装包、通知个人路线数据；不刷机或恢复出厂设置。
- 若用户确认进展，再做后续打包及实机交付。
