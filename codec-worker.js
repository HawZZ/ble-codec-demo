/* All assets and dependencies are served from this independent Pages site. */
let engine;
let queue = Promise.resolve();

async function initialize() {
  self.postMessage({ type: 'progress', message: '首次加载浏览器引擎，请稍候…' });
  const nativeFetch = self.fetch.bind(self), nativeImport = self.importScripts.bind(self);
  const root = new URL('./', self.location.href), vendorRoot = new URL('./vendor/pyodide/', root).href;
  const version = self.location.search;
  const progress = (message, percent) => self.postMessage({type:'progress',message,percent});
  const metadata = await nativeFetch(new URL('engine-assets.json'+version,root));
  if (!metadata.ok) throw new Error('引擎清单加载失败');
  const assets = await metadata.json(), memory = new Map();
  const total = Object.values(assets).reduce((n,a)=>n+a.bytes,0), loaded = new Map();
  let cache;
  try { cache = await caches.open('ble-public-engine-sha256-v1'); } catch (_) {}
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  let last=0, high=0;
  function update(name,bytes) {
    loaded.set(name,Math.max(loaded.get(name)||0,bytes));
    high=Math.max(high,Math.min(85,Math.floor([...loaded.values()].reduce((a,b)=>a+b,0)/total*85)));
    if(Date.now()-last>150) {progress('正在下载并校验引擎资源',high);last=Date.now();}
  }
  async function transfer(url, signal, name) {
    const controller=new AbortController();
    const abort=()=>controller.abort(); signal.addEventListener('abort',abort,{once:true});
    let timer,reader;
    const touch=()=>{clearTimeout(timer);timer=setTimeout(abort,20000);};
    try {
      touch();const response=await nativeFetch(url,{signal:controller.signal});
      if(!response.ok||!response.body)throw new Error('HTTP '+response.status);
      reader=response.body.getReader();const chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;touch();chunks.push(value);size+=value.length;update(name,size);}
      const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}return bytes;
    } finally {clearTimeout(timer);signal.removeEventListener('abort',abort);if(controller.signal.aborted&&reader)reader.cancel().catch(()=>{});}
  }
  async function obtain(name, info) {
    const key=new URL('__public_engine__/'+info.sha256,root).href;
    if(cache){const hit=await cache.match(key);if(hit){const bytes=new Uint8Array(await hit.arrayBuffer());if(await digest(bytes)===info.sha256){update(name,info.bytes);return bytes;}await cache.delete(key);}}
    const controllers=[],timers=[];
    const source=async(url,delay=0,gzip=false)=>{
      const c=new AbortController();controllers.push(c);
      if(delay)await new Promise((resolve,reject)=>{const t=setTimeout(resolve,delay);timers.push(t);c.signal.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('Canceled'));},{once:true});});
      let error;
      for(let attempt=0;attempt<2;attempt++){
        try {let bytes=await transfer(url,c.signal,name);
          if(gzip)bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
          if(bytes.length!==info.bytes||await digest(bytes)!==info.sha256)throw new Error('资源校验不匹配');return bytes;
        }catch(e){error=e;if(c.signal.aborted)throw e;}
      }throw error;
    };
    const local=new URL(name+version,root).href;
    const candidates=name.startsWith('vendor/pyodide/')?
      [source('https://cdn.jsdelivr.net/pyodide/v0.28.3/full/'+name.split('/').pop()),source(local,1200)]:
      (typeof DecompressionStream!=='undefined'?[source(new URL(name+'.gz'+version,root).href,0,true),source(local,1200)]:[source(local)]);
    try {
      const bytes=await Promise.any(candidates);update(name,info.bytes);
      if(cache)await cache.put(key,new Response(bytes)).catch(()=>{});return bytes;
    }catch(e){throw new Error(name+' 下载失败；请检查网络后重试');}
    finally{controllers.forEach(c=>c.abort());timers.forEach(clearTimeout);}
  }
  progress('正在准备引擎资源',2);
  await Promise.all(Object.entries(assets).map(async([name,info])=>{memory.set(new URL(name,root).href,await obtain(name,info));}));
  const responseFor = (url,bytes) => new Response(bytes,{headers:{'Content-Type':url.endsWith('.wasm')?'application/wasm':url.endsWith('.js')?'text/javascript':'application/octet-stream'}});
  self.fetch=async(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,root);url.search='';return memory.has(url.href)?responseFor(url.href,memory.get(url.href)):nativeFetch(input,options);};
  self.importScripts=(...urls)=>nativeImport(...urls.map(input=>{const url=new URL(input,root);url.search='';return memory.has(url.href)?URL.createObjectURL(new Blob([memory.get(url.href)],{type:'text/javascript'})):input;}));
  progress('正在启动本地编解码引擎',88);
  self.importScripts(vendorRoot+'pyodide.js');
  const pyodide=await loadPyodide({indexURL:vendorRoot});
  progress('正在加载模型校验组件',93);
  await pyodide.loadPackage('jsonschema');
  progress('正在准备字典和样例',97);
  const response=responseFor('runtime-files.json',memory.get(new URL('runtime-files.json',root).href));
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
