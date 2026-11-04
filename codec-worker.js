/* All assets and dependencies are served from this independent Pages site. */
let engine;
let queue = Promise.resolve();

async function initialize() {
  self.postMessage({ type: 'progress', message: '首次加载浏览器引擎，请稍候…' });
  const originalFetch = self.fetch.bind(self);
  const vendorRoot = new URL('./vendor/pyodide/', self.location.href).href;
  let received = 0, lastProgress = 0;
  const progress = message => self.postMessage({ type: 'progress', message });
  // Each resource gets one retry. The deadline measures inactivity, not total
  // transfer time: a slow but progressing download must be allowed to finish.
  async function download(input, options) {
    const name = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, self.location.href).pathname.split('/').pop();
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      let timer, reader;
      const touch = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), 60000); };
      try {
        progress(`正在下载 ${name}${attempt ? ' · 重试1/1' : ''}…`);
        touch();
        const response = await originalFetch(input, { ...options, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error('响应缺少内容');
        reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
          chunks.push(value);
          size += value.byteLength;
          received += value.byteLength;
          if (Date.now() - lastProgress >= 250) {
            progress(`正在下载 ${name} · 已接收 ${(received / 1048576).toFixed(1)} MB`);
            lastProgress = Date.now();
          }
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const headers = new Headers(response.headers);
        headers.delete('Content-Length');
        headers.delete('Content-Encoding');
        return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
      } catch (error) {
        if (reader) await reader.cancel().catch(() => {});
        if (attempt) throw new Error(`${name} 下载失败：${error.name === 'AbortError' ? '连续60秒未收到数据' : error.message}`);
      } finally { clearTimeout(timer); }
    }
  }
  self.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, self.location.href).href;
    if (url === vendorRoot + 'pyodide.asm.wasm' && typeof DecompressionStream !== 'undefined') {
      try {
        const response = await download(url + '.gz', options);
        // Finish decompression here, so corrupted gzip also takes the raw fallback.
        const bytes = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
      } catch (error) {
        progress('压缩引擎不可用，正在切换原始WASM…');
      }
    }
    if (url.startsWith(vendorRoot) || url.includes('/runtime-files.json')) return download(input, options);
    return originalFetch(input, options);
  };
  importScripts('./vendor/pyodide/pyodide.js');
  const pyodide = await loadPyodide({ indexURL: new URL('./vendor/pyodide/', self.location.href).href });
  self.postMessage({ type: 'progress', message: '正在加载模型校验组件…' });
  await pyodide.loadPackage('jsonschema');
  self.postMessage({ type: 'progress', message: '正在载入字典编译器…' });
  const runtimeUrl = new URL('./runtime-files.json', self.location.href);
  runtimeUrl.search = self.location.search;
  const response = await fetch(runtimeUrl.href);
  if (!response.ok) throw new Error('无法加载编解码引擎文件');
  const files = await response.json();
  for (const [path, text] of Object.entries(files)) {
    pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    pyodide.FS.writeFile(path, text);
  }
  await pyodide.runPythonAsync(`
import sys, json
sys.path.insert(0, '/workspace/tools')
import serve_ble_codec_demo as demo
def browser_dispatch(path, body):
    try:
        if len(body.encode('utf-8')) > demo.MAX_BODY:
            raise demo.codec.MappingError('BODY_LENGTH', '上传／请求内容须在2MiB以内')
        request = json.loads(body, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('不允许NaN或Infinity')))
        demo.require(isinstance(request, dict), 'REQUEST_FORMAT', '请求必须是JSON对象')
        if path == '/api/demo/bootstrap':
            result = demo.bootstrap()
        elif path == '/api/demo/import':
            result = demo.import_content(request)
        elif path == '/api/demo/compile':
            dictionary = demo.compile_workspace(request.get('workspace'))
            result = dict(ok=True, dictionary=dictionary, identity=dictionary['identity'], operations=demo.operation_descriptions(dictionary), files=demo.thing_mapping.export_pair(request['workspace']))
        elif path == '/api/demo/convert':
            result = demo.convert(request)
        else:
            raise demo.codec.MappingError('NOT_FOUND', '接口不存在')
        return json.dumps(result, ensure_ascii=False, allow_nan=False)
    except demo.codec.MappingError as error:
        return json.dumps(dict(ok=False, error=error.code, message=str(error)), ensure_ascii=False)
    except (ValueError, KeyError, TypeError, AttributeError, RecursionError) as error:
        return json.dumps(dict(ok=False, error='CONFIG_INVALID', message='配置格式错误：' + str(error)), ensure_ascii=False)
`);
  self.postMessage({ type: 'ready' });
  return pyodide;
}

self.addEventListener('message', ({ data }) => {
  // Pyodide uses shared interpreter globals; never interleave calls.
  queue = queue.then(async () => {
    let pyodide;
    try {
      engine ||= initialize();
      pyodide = await engine;
    } catch (error) {
      self.postMessage({ id: data.id, fatal: true, message: '浏览器引擎加载失败：' + error.message });
      return;
    }
    try {
      const dispatch = pyodide.globals.get('browser_dispatch');
      try {
        const result = JSON.parse(dispatch(data.path, data.body));
        self.postMessage({ id: data.id, result });
      } finally { dispatch.destroy(); }
    } catch (error) {
      self.postMessage({ id: data.id, result: { ok: false, error: 'INTERNAL_ERROR', message: '浏览器转换失败：' + error.message } });
    }
  });
});
