# BLE 编解码实验台

独立 Demo：https://hawzz.github.io/ble-codec-demo/

上传或逐行维护指令字典、配置物模型，选择上行／下行，完成 HEX 与物模型 JSON 的双向转换。支持嵌套对象、对象数组、倍率、约束及 1～2B TLV Length。

所有编译和转换都在浏览器的 Web Worker 中执行，复用项目原 Python 引擎。上传内容不发往后端；草稿仅在点击保存后保存在当前浏览器。首次访问需要下载约 13 MB 引擎及依赖。没有蓝牙发送、设备执行或云端平台能力。

站点可直接部署 GitHub Pages，也可用 `python3 -m http.server 8791` 启动静态预览。不需要本机 Python API 服务。支持 WebAssembly 和 Web Worker 的现代浏览器；加载失败时页面明确报错，刷新可重新加载。

`runtime-files.json` 包含共享引擎、Schema 和预置样例；`build-manifest.json` 记录发布文件哈希。Pyodide 固定 0.28.3，运行时和全部依赖来自同一站点，不依赖外部 CDN。打包时仅移除原服务的 HTTP 适配器，不重写应用编解码逻辑。

第三方运行时：Pyodide（见 `PYODIDE-LICENSE`）与 CPython（见 `PYTHON-LICENSE`）；Python 依赖及版本见 `build-manifest.json`，原许可证保留在各 wheel 的 dist-info 中。

这是协议映射实验工具，独立于历史平台原型和聚合原型仓库。
