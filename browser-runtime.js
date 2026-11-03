/* Static hosting adapter. The existing Python engine runs in an isolated worker. */
(() => {
  const workerUrl = new URL('./codec-worker.js', document.currentScript.src);
  workerUrl.search = new URL(document.currentScript.src).search;
  const worker = new Worker(workerUrl);
  let sequence = 0;
  let failed = null;
  const pending = new Map();
  function failAll(error) {
    failed = error;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
    worker.terminate();
  }
  worker.addEventListener('message', ({ data }) => {
    if (data.type === 'progress') {
      const status = document.getElementById('serverStatusText');
      if (status && !failed) status.textContent = data.message;
      return;
    }
    const task = pending.get(data.id);
    if (!task) return;
    clearTimeout(task.timer);
    pending.delete(data.id);
    if (data.fatal) {
      const error = Object.assign(new Error(data.message), { code: 'ENGINE_STARTUP' });
      task.reject(error);
      failAll(error);
    } else task.resolve(data.result);
  });
  worker.addEventListener('error', () => failAll(Object.assign(new Error('浏览器引擎加载失败，请刷新页面重试'), { code: 'ENGINE_STARTUP' })));
  window.BLEBrowserRuntime = {
    request(url, options = {}) {
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => failAll(Object.assign(new Error('浏览器引擎等待超时，请刷新页面重试'), { code: 'ENGINE_TIMEOUT' })), 300000);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, path: url, body: options.body || '{}' });
      });
    }
  };
})();
