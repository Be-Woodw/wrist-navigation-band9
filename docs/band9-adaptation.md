# Band 9 / 9 NFC：实现说明与 Codex 打包清单

## 1. 范围和结构

上游基线：`174c638f199eadaf9863bf5f4918716ac9843b9c`。新增独立 `band9/` 构建目标，不删除原 `wearable/`，这样可保留 9 Pro 对照并继续同步上游。**新 RPK 不打包原版三套字体、字体选择、字号/箭头粗细设置、原生存储或多套粗细箭头。** 固定一套上游 PNG 箭头及原图标，保留 MIT 许可。

`band9/src/common/protocol.js` 与上游完全相同，Git blob SHA 为 `b8718a71fff42ed9a34531f81fed69ee32e514cb`；解码、4096 字符限制、session/seq 去重、20秒传输过期和状态展示语义沿用上游。

高德通知解析器、SendPolicy、WearBridge、后台同步、消息协议保持原版。2026-10-29 实机发现高德同时发布“82米后直行”和“正在为您步行导航”两类通知：原监听器单纯按 `getPostTime()` 选择，较新的通用状态可能遮蔽转向指令。因此仅在 `NavigationNotificationListener.java` 中使用纯 Java `NavigationCandidateSelector` 对候选排序（方向+距离 > 方向 > 通用状态；明确结束通知在时间晚于指令时优先），并增加 JUnit 回归测试。通知字段提取及 `NavigationParser.java` 不修改；若自定义通知的真实文字不在 Android 标准字段中，本次修复仍无法读取，须由实机日志验证。`android/app/build.gradle` 的 `-Pband9` 只影响 applicationId、版本和签名路径。

## 2. 提醒规则

| 条件 | 输出 |
| --- | --- |
| 首次真实导航/新方向或指令 | 短振 |
| 首次进入150米 | 短振 |
| 首次进入50米 | 双短振 |
| 首次进入20米；掉头改为30米 | 长振，最高优先级 |
| 当前动作的明确“现在/立即/马上”转向文案 | 保守识别后与最终提醒共用去重 |
| 真实导航结束 | 短振一次 |
| 心跳、重复/乱序包、普通距离变化、演示 | 无振动 |
| 隐藏/断连/暂停/过期/恢复后的首个快照 | 不补发旧提醒 |

距离只转换已有 `distance` 字段的米/公里单位，不从原文总剩余里程猜测，不读取 GPS。170→130 可触发150档，60→18只发一次最终长振。18→12→0不重复。首包就是12米时也只发长振。

直行、未知方向、到达图标不应用“执行转向”阈值，以免把直行路段终点误报为转弯；新指令仍短振。高德没有提供可靠偏航事件，因此未新增一个声称精确的偏航报警器。

### 连续同向转弯

原协议没有路口 ID。不同方向/指令直接建立新动作；相同方向需在曾经接近路口后看到足够大的距离回升，并有导航原文变化或另一次不同且递减的距离样本佐证。很近的同向路口仅在旧距离≤20米、回升≥30米且新距离≥35米，并且指引文案变化时尝试识别。普通心跳不能作为第二次佐证，单次距离跳大后回落不重置。

这是有测试覆盖的**保守启发式**，不是准确的路口检测。没有足够通知证据的相邻同向转弯仍可能漏判。不能为满足振动而修改冻结的高德解析器或编造道路信息。

### 生命周期及硬件边界

只在页面前台、互联有效时调用振动。隐藏/销毁/断连/过期取消尚未发出的第二短振；设备已经开始的振动可能自然结束，不能宣称已调用不支持的 stop。双短振通过两次 `vibrate({mode:'short'})` 加600ms软件间隔实现；真实间隔/振感待实机确认。最终长振会取消先前待发的第二短振。

心跳仍可更新传输有效期。传输session变化不被当成新路线；恢复后的首个快照静默建立基线。它无法判定高德通知本身是否已经陈旧，也无法保证切至表盘后应用继续运行。

## 3. 测试记录

2026-10-29，在 Node.js 22.16.0 下运行 `node --test band9/test/*.test.js`：69项通过、0失败。覆盖严格单位转换、跳档优先级、GPS抖动、同向转弯启发式、会话恢复、演示、去重、定时取消、真实index.ux脚本的模拟互联/亮屏/振动、ACK独立性与100条递减距离序列。协议副本通过Git blob哈希锁定。

这不证明 aiot 编译成功、手环安装成功、系统接口真正可用或骑行时序可靠。尚未执行本版本 RPK/APK 构建；完整原版测试和 Android 测试应在完整检出后复跑。Windows PowerShell签名脚本需要本机运行验证。

## 4. 本机准备与打包

需要 Node.js 22+、JDK17+；APK额外需要上游文档指定的Android SDK和小米XMS AAR。不要删除或覆盖用户已有工作区。

```powershell
# 在完整检出的仓库根目录，确认当前为 band9-nfc-haptics 分支
npm test
npm run test:band9

# 首次创建/以后复用自己的成对身份，绝不覆盖原作者密钥
.\tools\prepare-band9-signing.ps1
npm run deps:band9
npm run build:band9

$rpk = Get-ChildItem .\band9\dist\*.rpk | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $rpk) { throw 'Band 9 RPK missing' }
node tools/check-band9-package.cjs $rpk.FullName
node tools/verify-rpk-signature.cjs --band9 $rpk.FullName

# 按上游工具从官方示例取得并校验AAR，已有正确文件可复用
.\tools\fetch-xiaomi-sdk.ps1
.\android\gradlew.bat -p android -Pband9 :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --console=plain
```

**独立身份：** APK/RPK都用 `com.bewoodw.band9.navigation`。Android保留原namespace是为了不改Java业务包，不代表applicationId仍是原版。PKCS12位于 `signing/band9/development.p12`，PEM位于 `band9/sign/{debug,release}/`，全部必须留在本机并安全备份。开发keystore密码 `android` 只是本地调试约定，不应被当作生产密钥保护措施。

`prepare-band9-signing.ps1` 只在没有旧身份时生成；已有P12重复导出会检查PEM是否一致，不会有意覆盖另一身份。缺少签名时prebuild失败，不借用toolkit默认证书。`band9/package.json` 复用上游锁文件的工具链name/version，应用版本以manifest的0.3.0/code10为准。

原作者APK签名不属于本fork，不能与新RPK混用。打包后用Android `apksigner verify --print-certs` 与本机certificate.pem核对证书SHA-256，再分别计算APK/RPK文件SHA-256；记录结果但不上传私钥。可先运行`-Pband9 -Punsigned`编译检查，unsigned APK不能安装。

包检查设置了 **1 MiB项目体积预算**，用于防止再次带入大资源，不是宣称手环固件的硬性上限。签名验证器默认仍验证原`wearable`目标，必须加`--band9`。

## 5. 实机验收顺序

先停止旧版腕上导航的同步，防止两套桥接同时工作；不要停止日常导航所需的小米运动健康连接。用户通过AstroBox安装新RPK后恢复运动健康，安装配套APK并授权。

静止检查：安装无重启→页面不裁切→互联和真实通知显示→短/双短/长振可感知→结束/隐藏/断连释放亮屏与定时器。随后验证手机锁屏、30分钟运行、掉头、连续转弯、距离抖动和通知跳过最后20米。不要为了测试骑行中操作手机。

若再次在100%重启，停止重复安装，记录固件、工具版本、文件哈希和错误；Hello World成功不证明字体就是原故障根因。

## 6. 官方接口依据

- [Vela振动接口及设备支持表](https://iot.mi.com/vela/quickapp/zh/features/system/vibrator.html)：Band9支持vibrate的short/long，不支持start/stop自定义任务。
- [Vela设备通信](https://iot.mi.com/vela/quickapp/zh/features/network/interconnect.html)：双端包名、签名必须一致。

原项目许可见根目录LICENSE，原始介绍和交接存档在`docs/upstream-*.md`。测试通知全部为虚构示例，不包含用户真实路线。

## 7. 双通知选择回归测试（待本机 Gradle 验证）

使用 `-Pband9 :app:testDebugUnitTest` 验证 `NavigationCandidateSelectorTest`，尤其“实时指令较早、普通持续导航通知较新”的场景，并在手机开启真实高德导航时核对 APK 诊断页。不要更改或上传用户实际路线信息，也不要把系统通知截图误当作 `Notification.extras` 的直接证明。
