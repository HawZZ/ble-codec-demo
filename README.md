# BLE 编解码实验台

独立 Demo：https://hawzz.github.io/ble-codec-demo/

日常只需物模型JSON（properties / services / events）和BLE映射JSON（ble-thing-mapping/1）；点击“导出模型与映射”得到两个文件。属性直接绑定，无需额外建立服务。旧workspace、0.1／0.2机器字典和三张CSV仍可在兼容入口导入，不是必需交付。

正式交换定义见two-file-contract.md，物模型及BLE映射Schema位于schemas/。兼容读取已交付的ble-mapping-definition/1.0拆分文件，导出统一为ble-thing-mapping/1；不会忽略模型引用、嵌套或属性更新。

物模型以属性／事件／服务三个标签表格为默认入口，保留结构树和JSON。指令只配置功能、SID、CID及交互；字段按指令和上下行分别配置，换算、特殊结构和来源信息进入高级详情。内部ID及版本引用由系统维护；原有高级信息随两文件完整保留。

上传或逐行维护指令字典、配置物模型，选择上行／下行，完成 HEX 与物模型 JSON 的双向转换。支持嵌套对象、对象数组、倍率、约束及 1～2B TLV Length。

所有编译和转换都在浏览器的 Web Worker 中执行，复用项目原 Python 引擎。上传内容不发往后端；草稿仅在点击保存后保存在当前浏览器。首次访问需要下载引擎及依赖，页面会显示下载进度；支持流解压的浏览器使用预压缩WASM资源。没有蓝牙发送、设备执行或云端平台能力。

站点可直接部署 GitHub Pages，也可用 `python3 -m http.server 8791` 启动静态预览。不需要本机 Python API 服务。支持 WebAssembly 和 Web Worker 的现代浏览器；加载失败时页面明确报错，刷新可重新加载。

`runtime-files.json` 包含共享引擎、Schema 和预置样例；`build-manifest.json` 记录发布文件哈希。Pyodide 固定 0.28.3，运行时和全部依赖来自同一站点，不依赖外部 CDN。打包时仅移除原服务的 HTTP 适配器，不重写应用编解码逻辑。

第三方运行时：Pyodide（见 `PYODIDE-LICENSE`）与 CPython（见 `PYTHON-LICENSE`）；Python 依赖及版本见 `build-manifest.json`，原许可证保留在各 wheel 的 dist-info 中。

这是协议映射实验工具，独立于历史平台原型和聚合原型仓库。

完整吸奶器示例覆盖21条定义，05/06按来源停用，0C/14仅上行；支持重复对象。温度示例为合成教学地址，不代表吸奶器实际CID。

结果区按properties / services / events展示本次数据，服务输出或事件可同时产生属性更新。缺失字段不补值；此结果不是数据库完整状态，不自动按数组索引合并，也不表示请求已精确匹配或设备已执行。


平台类型已支持：物模型选择object、array、Int32、Float、Double、Enum、Bool、String；系统保存platformType与对应JSON值形态，BLE wireType单独选择。导入导出保留Float／Double区别和能力声明；旧文件不猜平台类型。预置“平台类型 · 八种类型”含Int32/u8、整数倍率、数组与嵌套。范围、枚举、步长和精确逆换算继续校验；Float检查溢出及非零值下溢为0。输出显示工程值，不模拟数据库存储舍入。
