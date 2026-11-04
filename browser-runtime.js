/* Static hosting adapter. The existing Python engine runs in an isolated worker. */
(() => {
  const workerUrl = new URL('./codec-worker.js', document.currentScript.src);
  workerUrl.search = new URL(document.currentScript.src).search;
  const STARTUP_IDLE_MS = 90000;
  const REQUEST_MS = 300000;
  let worker, watchdog, sequence = 0, failed = null, ready = false;
  let stage = '启动浏览器引擎';
  const pending = new Map();
  let percent=0;
  function loading(message, value) {
    const panel=document.getElementById('engineLoading');
    if(!panel)return;
    panel.hidden=false;document.getElementById('demoSurface').inert=true;
    document.getElementById('engineLoadingMessage').textContent=message;
    if(Number.isFinite(value))percent=Math.max(percent,Math.min(99,value));
    document.getElementById('engineLoadingProgress').value=percent;
    document.getElementById('engineLoadingPercent').textContent=percent+'%';
  }

  function failAll(error) {
    if (failed) return;
    failed = error;
    loading(error.message);
    document.getElementById('engineLoadingTitle').textContent='加载遇到问题';
    document.getElementById('engineLoadingRetry').hidden=false;
    clearTimeout(watchdog);
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
    worker.terminate();
    window.dispatchEvent(new CustomEvent('ble-engine-failure', { detail: error }));
  }
  function watchStartup() {
    clearTimeout(watchdog);
    if (!ready) watchdog = setTimeout(() => failAll(Object.assign(new Error(`${stage}：连续90秒没有加载进展。可点击“重新加载引擎”，当前编辑内容会保留。`), { code: 'ENGINE_TIMEOUT' })), STARTUP_IDLE_MS);
  }
  function start() {
    failed = null;
    percent=0;loading('正在连接下载服务…',0);
    document.getElementById('engineLoadingTitle').textContent='正在准备实验台';
    document.getElementById('engineLoadingRetry').hidden=true;
    ready = false;
    stage = '启动浏览器引擎';
    worker = new Worker(workerUrl);
    const current = worker;
    worker.addEventListener('message', ({ data }) => {
      if (worker !== current || failed) return;
      if (data.type === 'progress') {
        stage = data.message;
        loading(data.message,data.percent);
        watchStartup();
        const status = document.getElementById('serverStatusText');
        if (status) status.textContent = data.message;
        return;
      }
      if (data.type === 'ready') {
        ready = true;
        clearTimeout(watchdog);
        for (const [id, task] of pending) armRequest(id, task);
        return;
      }
      if (data.fatal) {
        failAll(Object.assign(new Error(data.message), { code: 'ENGINE_STARTUP' }));
        return;
      }
      const task = pending.get(data.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(data.id);
      task.resolve(data.result);
    });
    worker.addEventListener('error', () => {
      if (worker === current) failAll(Object.assign(new Error(`${stage}：引擎加载失败。可点击“重新加载引擎”，当前编辑内容会保留。`), { code: 'ENGINE_STARTUP' }));
    });
  }
  function armRequest(id, task) {
    task.timer = setTimeout(() => failAll(Object.assign(new Error('编解码处理等待超时。可重新加载引擎，当前编辑内容会保留。'), { code: 'ENGINE_TIMEOUT' })), REQUEST_MS);
  }
  start();
  document.getElementById('engineLoadingRetry').addEventListener('click',()=>document.getElementById('retryEngineBtn').click());
  window.BLEBrowserRuntime = {
    markUsable() {
      if(!ready||failed)return;
      document.getElementById('engineLoadingProgress').value=100;
      document.getElementById('engineLoadingPercent').textContent='100%';
      document.getElementById('demoSurface').inert=false;
      document.getElementById('engineLoading').hidden=true;
    },
    restart() {
      if (!failed || pending.size) throw new Error('仅在引擎失败后重新加载');
      start();
    },
    request(url, options = {}) {
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const task = { resolve, reject, timer: null };
        pending.set(id, task);
        if (ready) armRequest(id, task);
        else watchStartup();
        worker.postMessage({ id, path: url, body: options.body || '{}' });
      });
    }
  };
})();
