# BLE 编解码实验台

独立 Demo：https://hawzz.github.io/ble-codec-demo/

日常只需物模型JSON（properties / services / events）和BLE映射JSON（ble-thing-mapping/1）；点击“导出模型与映射”得到两个文件。属性直接绑定，无需额外建立服务。旧workspace、0.1／0.2机器字典和三张CSV仍可在兼容入口导入，不是必需交付。

正式交换定义见two-file-contract.md，物模型及BLE映射Schema位于schemas/。兼容读取已交付的ble-mapping-definition/1.0拆分文件，导出统一为ble-thing-mapping/1；不会忽略模型引用、嵌套或属性更新。

物模型以属性／事件／服务三个标签表格为默认入口，保留结构树和JSON。指令只配置功能、SID、CID及交互；字段按指令和上下行分别配置，换算、特殊结构和来源信息进入高级详情。内部ID及版本引用由系统维护；原有高级信息随两文件完整保留。

上传或逐行维护指令字典、配置物模型，选择上行／下行，完成 HEX 与物模型 JSON 的双向转换。支持嵌套对象、对象数组、倍率、约束及 1～2B TLV Length。

所有编译和转换都在浏览器的 Web Worker 中执行，复用项目原 Python 引擎。上传内容不发往后端；草稿仅在点击保存后保存在当前浏览器。首次访问下载一个固定Git提交的jsDelivr公开压缩引擎包（约5.8MB），镜像失败或1.5秒后尚未完成时启用本站相同字节的备用包，先完成并通过校验的来源胜出，取消另一路下载；逐文件验证打包SHA-256，校验失败不执行。公开静态资源按内容哈希缓存至当前浏览器，模型／字典不发往镜像。runtime-files.json使用gzip下载并校验，解压失败回退原文件。下载持续有进展时不受固定总时限中断；单资源连续60秒无数据会重试一次。居中面板显示进度，引擎完成bootstrap之前禁止操作；引擎连续90秒无加载进展时停止等待，业务处理另有300秒上限。没有蓝牙发送、设备执行或云端平台能力。

站点可直接部署 GitHub Pages，也可用 `python3 -m http.server 8791` 启动静态预览。不需要本机 Python API 服务。支持 WebAssembly 和 Web Worker 的现代浏览器；加载失败时显示具体资源和阶段；点击“重新加载引擎”在当前页面重试，保留工作区及输入。

`runtime-files.json` 包含共享引擎、Schema 和预置样例；`build-manifest.json` 记录发布文件哈希。Pyodide固定0.28.3，公开压缩包优先使用jsDelivr，保留本站相同字节的完整回退；engine-assets.json记录资源大小和SHA-256。打包时仅移除原服务的 HTTP 适配器，不重写应用编解码逻辑。

第三方运行时：Pyodide（见 `PYODIDE-LICENSE`）与 CPython（见 `PYTHON-LICENSE`）；Python 依赖及版本见 `build-manifest.json`，原许可证保留在各 wheel 的 dist-info 中。

这是协议映射实验工具，独立于历史平台原型和聚合原型仓库。

完整吸奶器示例覆盖21条定义，05/06按来源停用，0C/14仅上行；支持重复对象。温度示例为合成教学地址，不代表吸奶器实际CID。

结果区按properties / services / events展示本次数据，服务输出或事件可同时产生属性更新。缺失字段不补值；此结果不是数据库完整状态，不自动按数组索引合并，也不表示请求已精确匹配或设备已执行。


平台类型已支持：物模型选择object、array、Int32、Float、Double、Enum、Bool、String；系统保存platformType与对应JSON值形态，BLE wireType单独选择。导入导出保留Float／Double区别和能力声明；旧文件不猜平台类型。预置“平台类型 · 八种类型”含Int32/u8、整数倍率、数组与嵌套。范围、枚举、步长和精确逆换算继续校验；Float检查溢出及非零值下溢为0。输出显示工程值，不模拟数据库存储舍入。

整数Enum可使用u8等整数编码；Int32／Float／Double属于number数值范畴但保留各自平台类型与约束。Bool可使用bool或u8／u16／u32／i8／i16／i32，严格false=0、true=1，不接受其他整数，不使用倍率偏移；系统自动声明boolean-integer/1能力。

engine-mirror.json固定已发布公开引擎包的Git提交和SHA；打包器逐文件保留Pyodide原字节，gzip包及内部每个文件均校验SHA后执行。更换Pyodide资源时先发布新包，再更新固定引用；业务字典更新不需更换公开引擎包。

## 0.4：属性设置与显式输出关联

“属性设置”选择可写属性和值，按启用映射选择指令；多候选必须选择，同指令合并，跨指令按字典顺序输出。全部预检通过才生成HEX清单，缺必填不使用缓存／默认值。生成不表示已发送或设备状态更新，不保证跨指令原子性。合成样例在samples/property-set/（源码examples/ble-codec-demo/property-set/）。

多属性write使用target.identifiers与property-groups/1，旧单属性及两文件format保持不变。服务映射直接展示“上行数据更新属性”，同名输出只提供建议，确认后保存propertyUpdates；未关联／缺失字段／结果码／空包不更新属性。

本轮不改变加载遮罩和引擎缓存策略；首次加载稳定10秒目标仍未验收通过。
