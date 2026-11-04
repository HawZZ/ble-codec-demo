/* All assets and dependencies are served from this independent Pages site. */
let engine;
let queue = Promise.resolve();

async function initialize() {
  self.postMessage({ type: 'progress', message: '首次加载浏览器引擎，请稍候…' });
  const nativeFetch = self.fetch.bind(self), nativeImport = self.importScripts.bind(self);
  const root = new URL('./', self.location.href), vendorRoot = new URL('./vendor/pyodide/', root).href;
  const version = self.location.search;
  const metadata = await nativeFetch(new URL('engine-assets.json'+version,root));
  if (!metadata.ok) throw new Error('引擎清单加载失败');
  const manifest=await metadata.json(),assets=manifest.assets,memory=new Map();
  const progress=(message,percent)=>self.postMessage({type:'progress',message,percent});
  let cache;
  try{cache=await caches.open('ble-public-engine-sha256-v1');}catch(_){}
  const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const keyFor=info=>new URL('__public_engine__/'+info.sha256,root).href;
  const put=async(name,bytes)=>{memory.set(new URL(name,root).href,bytes);if(cache)await cache.put(keyFor(assets[name]),new Response(bytes)).catch(()=>{});};
  await Promise.all(Object.entries(assets).map(async([name,info])=>{
    if(!cache)return;
    try{const hit=await cache.match(keyFor(info));if(!hit)return;const bytes=new Uint8Array(await hit.arrayBuffer());if(await digest(bytes)===info.sha256)memory.set(new URL(name,root).href,bytes);else await cache.delete(keyFor(info));}catch(_){}
  }));
  const have=name=>memory.has(new URL(name,root).href);
  let vendorDone=Object.keys(assets).filter(n=>n.startsWith('vendor/')).every(have),runtimeDone=have('runtime-files.json');
  const received={vendor:vendorDone?manifest.bundle.bytes:0,runtime:runtimeDone?53000:0};
  let high=2,last=0;
  function update(kind,bytes){received[kind]=Math.max(received[kind],bytes);high=Math.max(high,Math.min(85,Math.floor((received.vendor+received.runtime)/(manifest.bundle.bytes+53000)*85)));if(Date.now()-last>150){progress('正在下载并校验引擎资源',high);last=Date.now();}}
  async function transfer(url,kind){
    let error;
    for(let attempt=0;attempt<2;attempt++){
      const c=new AbortController();let timer,reader;
      const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>c.abort(),60000);};
      try{touch();const response=await nativeFetch(url,{signal:c.signal});if(!response.ok||!response.body)throw new Error('HTTP '+response.status);
        reader=response.body.getReader();const chunks=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;touch();chunks.push(value);size+=value.length;update(kind,size);}
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
      }catch(e){error=e;}finally{clearTimeout(timer);if(c.signal.aborted&&reader)reader.cancel().catch(()=>{});}
    }throw error;
  }
  async function gunzip(bytes){return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());}
  async function loadVendor(){
    if(vendorDone)return;
    if(typeof DecompressionStream==='undefined'){
      const names=Object.keys(assets).filter(n=>n.startsWith('vendor/')&&!have(n));let next=0;
      await Promise.all(Array.from({length:2},async()=>{while(next<names.length){const name=names[next++],info=assets[name];const bytes=await transfer(new URL(name+version,root).href,'vendor');if(bytes.length!==info.bytes||await digest(bytes)!==info.sha256)throw new Error('引擎文件校验失败');await put(name,bytes);}}));return;
    }
    const bundle=manifest.bundle;
    let compressed;
    const verified=async url=>{const bytes=await transfer(url,'vendor');if(bytes.length!==bundle.bytes||await digest(bytes)!==bundle.sha256)throw new Error('引擎包校验不匹配');return bytes;};
    if(bundle.revision){
      try{compressed=await verified('https://cdn.jsdelivr.net/gh/HawZZ/ble-codec-demo@'+bundle.revision+'/'+bundle.path);}
      catch(_){compressed=await verified(new URL(bundle.path+version,root).href);}
    }else compressed=await verified(new URL(bundle.path+version,root).href);
    const bytes=await gunzip(compressed),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const len=view.getUint32(0),index=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+len)));let offset=4+len;
    const found=new Set();
    for(const entry of index){const info=assets[entry.path];if(!info||!entry.path.startsWith('vendor/')||found.has(entry.path)||info.bytes!==entry.bytes)throw new Error('引擎包目录不匹配');found.add(entry.path);const file=bytes.slice(offset,offset+entry.bytes);offset+=entry.bytes;if(await digest(file)!==info.sha256)throw new Error('引擎文件校验不匹配');await put(entry.path,file);}
    if(offset!==bytes.length||Object.keys(assets).filter(n=>n.startsWith('vendor/')).some(n=>!found.has(n)))throw new Error('引擎包不完整');
  }
  async function loadRuntime(){
    if(runtimeDone)return;
    const info=assets['runtime-files.json'];let bytes;
    try{bytes=await gunzip(await transfer(new URL('runtime-files.json.gz'+version,root).href,'runtime'));if(await digest(bytes)!==info.sha256)throw new Error('校验失败');}
    catch(_){bytes=await transfer(new URL('runtime-files.json'+version,root).href,'runtime');}
    if(bytes.length!==info.bytes||await digest(bytes)!==info.sha256)throw new Error('字典引擎文件校验失败');await put('runtime-files.json',bytes);
  }
  progress(vendorDone?'正在读取已缓存的引擎':'正在下载压缩引擎包',vendorDone?85:2);
  await Promise.all([loadVendor(),loadRuntime()]);
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
