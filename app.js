(() => {
  'use strict';

  const API = {
    bootstrap: '/api/demo/bootstrap',
    import: '/api/demo/import',
    compile: '/api/demo/compile',
    convert: '/api/demo/convert'
  };

  const WORKSPACE_FORMAT = 'ble-codec-workspace/1';
  const DRAFT_KEY = 'ble-codec-demo:draft:v1';
  const FALLBACK_COLUMNS = {
    commands: ['operation', 'method', 'sid', 'cid', 'interaction', 'receive_variants', 'correlation', 'timeout_ms', 'source', 'availability'],
    bindings: ['operation', 'role', 'tlv_path', 'model_path', 'wire_type', 'required', 'scale', 'offset', 'max_bytes'],
    groups: ['operation', 'role', 'container_path', 'rule', 'fields']
  };
  const FALLBACK_WIRE_TYPES = ['group', 'array', 'object', 'u8', 'u16', 'u32', 'i8', 'i16', 'i32', 'f32', 'f64', 'bool', 'utf8', 'bytes', 'u8[]', 'u16[]', 'u32[]', 'i8[]', 'i16[]', 'i32[]', 'f32[]', 'f64[]'];

  const COLUMN_META = {
    operation: ['操作 ID', 132],
    method: ['功能引用', 230],
    sid: ['SID', 68],
    cid: ['CID', 68],
    interaction: ['交互语义', 144],
    receive_variants: ['接收变体', 144],
    correlation: ['关联方式', 106],
    timeout_ms: ['超时 ms', 86],
    source: ['来源说明', 250],
    availability: ['可用状态', 96],
    role: ['方向角色', 90],
    tlv_path: ['TLV 路径', 150],
    model_path: ['模型路径', 210],
    wire_type: ['线类型', 110],
    required: ['必填 M/O', 82],
    scale: ['倍率', 72],
    offset: ['偏移', 72],
    max_bytes: ['最大字节', 92],
    container_path: ['容器路径', 150],
    rule: ['约束规则', 142],
    fields: ['字段列表', 330]
  };

  const TABLE_META = {
    commands: {
      title: '指令表',
      description: '定义功能引用、SID/CID与交互。属性可直接绑定，无需新增服务。',
      hint: '功能引用可填 property:temperature:write（或read/report）、service:服务名、event:事件名；旧服务名仍兼容。availability填写active或suspended。'
    },
    bindings: {
      title: '字段绑定表',
      description: '把 TLV 路径映射到所选服务的 input / output 相对模型路径。',
      hint: 'model_path 是相对服务输入或输出的路径；改名或移动模型节点后必须同步调整。role 使用 request / incoming。'
    },
    groups: {
      title: '约束组表',
      description: '声明同一容器字段的至少一个或全有或全无约束。',
      hint: 'container_path 指向绑定表中的容器路径，fields 使用竖线 | 分隔。'
    }
  };

  const IDENTITY_LABELS = {
    product_id: '产品标识',
    firmware_version: '固件版本',
    function_version: '功能版本',
    dictionary_version: '字典版本',
    transport_ref: '传输引用'
  };

  let configUI = null;

  const state = {
    bootstrap: {
      examples: [],
      columns: structuredClone(FALLBACK_COLUMNS),
      wire_types: [...FALLBACK_WIRE_TYPES],
      blank: blankWorkspace()
    },
    columns: structuredClone(FALLBACK_COLUMNS),
    wireTypes: [...FALLBACK_WIRE_TYPES],
    workspace: blankWorkspace(),
    source: '浏览器空白',
    revision: 0,
    labRevision: 0,
    activeTab: 'config',
    activeTable: 'commands',
    server: 'loading',
    presetHint: '',
    modelNodes: [],
    modelJsonDirty: false,
    nodeEditor: null,
    importBusy: false,
    draft: null,
    compile: {
      status: 'idle',
      operations: [],
      dictionary: null,
      identity: null,
      error: null,
      compiledAt: null,
      serial: 0,
      timer: null
    },
    lab: {
      mode: 'encode',
      direction: 'down',
      operation: '',
      formView: 'form',
      formData: {},
      formJsonText: '{}',
      schemaSignature: '',
      hex: '',
      result: null,
      error: null,
      busy: false,
      freshness: 'idle',
      requestSerial: 0
    }
  };

  const $ = (id) => document.getElementById(id);

  class ApiError extends Error {
    constructor(code, message, status = 0) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'REQUEST_FAILED';
      this.status = status;
    }
  }

  function blankWorkspace() {
    return {
      format: WORKSPACE_FORMAT,
      model: { properties: {}, methods: {}, events: {} },
      commands: [],
      bindings: [],
      groups: []
    };
  }

  function clone(value) {
    return value == null ? value : structuredClone(value);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function pretty(value) {
    return JSON.stringify(value, null, 2);
  }

  function timeLabel(date = new Date()) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  function dateTimeLabel(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  function countCommands() {
    return state.workspace.commands.length;
  }

  function hasCompiledDictionary() {
    return state.compile.status === 'ready' && isObject(state.compile.dictionary);
  }

  function setServerState(status) {
    state.server = status;
    const wrapper = $('serverStatus');
    const text = $('serverStatusText');
    if (!wrapper || !text) return;
    wrapper.dataset.state = status;
    text.textContent = status === 'online'
      ? '浏览器引擎已就绪'
      : status === 'offline'
        ? '浏览器引擎不可用'
        : '正在加载浏览器引擎';
  }

  function setGlobalNotice(message) {
    const node = $('globalNotice');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  function showWorkspaceError(error) {
    const box = $('workspaceError');
    if (!box) return;
    if (!error) {
      box.hidden = true;
      return;
    }
    $('workspaceErrorCode').textContent = error.code || 'CONFIG_INVALID';
    $('workspaceErrorMessage').textContent = error.message || '工作区校验失败';
    box.hidden = false;
  }

  function showToast(message, type = 'info', duration = 4200) {
    const region = $('toastRegion');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' is-error' : type === 'warning' ? ' is-warning' : ''}`;
    toast.textContent = message;
    while (region.children.length >= 2) region.firstElementChild.remove();
    region.append(toast);
    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      window.setTimeout(() => toast.remove(), 180);
    }, duration);
  }

  async function requestJson(url, options = {}) {
    if (window.BLEBrowserRuntime) {
      const body = await window.BLEBrowserRuntime.request(url, options);
      if (body?.ok !== true) throw new ApiError(body?.error || 'ENGINE_ERROR', body?.message || '转换失败', 400);
      return body;
    }
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      throw new ApiError('RESPONSE_FORMAT', '引擎返回内容不是 JSON', response.status);
    }
    if (!response.ok || body?.ok !== true) {
      throw new ApiError(
        body?.error || `HTTP_${response.status}`,
        body?.message || `请求失败（HTTP ${response.status}）`,
        response.status
      );
    }
    return body;
  }

  function postJson(url, body) {
    return requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function normalizeColumns(columns) {
    const result = {};
    for (const key of ['commands', 'bindings', 'groups']) {
      result[key] = Array.isArray(columns?.[key]) && columns[key].every((item) => typeof item === 'string')
        ? [...columns[key]]
        : [...FALLBACK_COLUMNS[key]];
    }
    return result;
  }

  function normalizeWorkspace(raw) {
    const source = isObject(raw) ? clone(raw) : blankWorkspace();
    source.format = WORKSPACE_FORMAT;
    source.model = isObject(source.model) ? source.model : {};
    source.model.properties = isObject(source.model.properties) ? source.model.properties : {};
    source.model.methods = isObject(source.model.methods) ? source.model.methods : {};
    source.model.events = isObject(source.model.events) ? source.model.events : {};

    for (const [name, method] of Object.entries(source.model.methods)) {
      if (!isObject(method)) {
        source.model.methods[name] = { name, input: closedObjectSchema(), output: closedObjectSchema() };
        continue;
      }
      method.input = isObject(method.input) ? method.input : closedObjectSchema();
      method.output = isObject(method.output) ? method.output : closedObjectSchema();
    }

    for (const table of ['commands', 'bindings', 'groups']) {
      const columns = state.columns[table] || FALLBACK_COLUMNS[table];
      const rows = Array.isArray(source[table]) ? source[table] : [];
      source[table] = rows.filter(isObject).map((row) => {
        const next = {};
        for (const column of columns) next[column] = row[column] == null ? (column === 'availability' ? 'active' : '') : String(row[column]);
        return next;
      });
    }
    return source;
  }

  function workspaceSnapshot() {
    return clone(state.workspace);
  }

  function closeOpenDialogs() {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  }

  async function loadBootstrap() {
    setServerState('loading');
    try {
      const data = await requestJson(API.bootstrap);
      state.bootstrap = {
        examples: Array.isArray(data.examples) ? data.examples : [],
        columns: normalizeColumns(data.columns),
        wire_types: Array.isArray(data.wire_types) ? data.wire_types : [...FALLBACK_WIRE_TYPES],
        blank: isObject(data.blank) ? clone(data.blank) : blankWorkspace()
      };
      state.columns = normalizeColumns(state.bootstrap.columns);
      state.wireTypes = [...state.bootstrap.wire_types];
      if (state.revision === 0 && countCommands() === 0) {
        state.workspace = normalizeWorkspace(state.bootstrap.blank);
      }
      setServerState('online');
      setGlobalNotice('');
      renderAll();
    } catch (error) {
      setServerState('offline');
      setGlobalNotice(`浏览器引擎无法加载：${error.code} · ${error.message}`);
      renderAll();
    }
  }

  function renderAll() {
    renderExamples();
    renderDraftStatus();
    renderWorkspaceMeta();
    renderCompileStatus();
    renderIdentity();
    renderModelEditor();
    renderTable();
    renderLab();
  }

  function renderWorkspaceMeta() {
    const commandCount = countCommands();
    $('statCommands').textContent = String(commandCount);
    $('statBindings').textContent = String(state.workspace.bindings.length);
    $('statGroups').textContent = String(state.workspace.groups.length);
    $('statMethods').textContent = String(Object.keys(state.workspace.model.methods).length);
    $('configTabCount').textContent = String(commandCount);
    $('revisionMark').textContent = `REV ${state.revision}`;
    $('workspaceSource').textContent = state.source;
    $('headerWorkspaceName').textContent = `${state.source} · ${commandCount} 条指令`;

    if (commandCount === 0) {
      $('workspaceTitle').textContent = '从空白工作区开始';
      $('workspaceSubtitle').textContent = '导入字典与模型，或逐行建立指令、绑定和约束。';
    } else {
      const methodCount = Object.keys(state.workspace.model.methods).length;
      $('workspaceTitle').textContent = `${commandCount} 条指令的离线字典`;
      $('workspaceSubtitle').textContent = `${methodCount} 个物模型服务 · ${state.workspace.bindings.length} 条字段绑定 · 不连接蓝牙设备`;
    }
    $('onboardingPanel').hidden = commandCount > 0;
    $('modelSummary').textContent = `${Object.keys(state.workspace.model.methods).length} 个服务 · ${Object.keys(state.workspace.model.properties).length} 个属性 · ${Object.keys(state.workspace.model.events).length} 个事件`;
  }

  function renderCompileStatus() {
    const wrapper = $('compileStatus');
    const text = $('compileStatusText');
    const button = $('compileBtn');
    const labState = $('labCompileState');
    let label = '等待工作区数据';
    let status = state.compile.status;

    if (status === 'compiling') label = '正在校验与编译';
    else if (status === 'ready') label = `已编译 · ${state.compile.operations.length} 条指令`;
    else if (status === 'error') label = '编译失败';
    else if (status === 'dirty') label = '有未编译更改';
    else if (countCommands() === 0) {
      label = '没有指令可编译';
      status = 'idle';
    }

    wrapper.dataset.state = status;
    text.textContent = label;
    if (labState) labState.textContent = label;
    button.disabled = state.compile.status === 'compiling';
    button.textContent = state.compile.status === 'compiling' ? '编译中…' : '重新编译';
    $('exportDictionaryBtn').disabled = !hasCompiledDictionary();
    $('exportPairBtn').disabled = !hasCompiledDictionary();
  }

  function renderIdentity() {
    const grid = $('identityGrid');
    const empty = $('identityEmpty');
    const identity = state.compile.identity || (state.compile.status !== 'dirty' ? state.workspace.identity : null);
    if (!isObject(identity) || Object.keys(identity).length === 0) {
      grid.hidden = true;
      empty.hidden = false;
      empty.querySelector('p').textContent = state.compile.error
        ? '编译失败，当前没有可用的实验身份。修正工作区后重新编译。'
        : '编译后生成实验快照身份。导入完整机器字典时，保留其中明确声明的身份。';
      return;
    }
    empty.hidden = true;
    grid.hidden = false;
    grid.innerHTML = Object.entries(identity)
      .map(([key, value]) => `<div><dt>${escapeHtml(IDENTITY_LABELS[key] || key)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(typeof value === 'string' ? value : pretty(value))}</dd></div>`)
      .join('');
  }

  function activateTab(tab) {
    state.activeTab = tab === 'lab' ? 'lab' : 'config';
    const config = $('configPanel');
    const lab = $('labPanel');
    const configButton = $('configTabBtn');
    const labButton = $('labTabBtn');
    const isConfig = state.activeTab === 'config';
    config.hidden = !isConfig;
    lab.hidden = isConfig;
    configButton.classList.toggle('is-active', isConfig);
    labButton.classList.toggle('is-active', !isConfig);
    configButton.setAttribute('aria-selected', String(isConfig));
    labButton.setAttribute('aria-selected', String(!isConfig));
    if (!isConfig) renderLab();
  }

  function renderExamples() {
    const examples = Array.isArray(state.bootstrap.examples) ? state.bootstrap.examples : [];
    for (const containerId of ['quickExamples', 'exampleGrid']) {
      const container = $(containerId);
      if (!container) continue;
      container.replaceChildren();
      if (!examples.length) {
        const note = document.createElement('p');
        note.className = 'tree-empty';
        note.textContent = state.server === 'offline' ? '引擎加载完成后可载入预置实验。' : '暂无预置实验。';
        container.append(note);
        continue;
      }
      examples.forEach((example, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'example-card';
        button.dataset.exampleId = example.id;
        button.innerHTML = `
          <span class="example-index">${String(index + 1).padStart(2, '0')}</span>
          <span class="example-copy"><strong>${escapeHtml(example.label || example.id)}</strong><small>${escapeHtml(example.description || '')}</small></span>
          <span class="example-arrow" aria-hidden="true">›</span>
        `;
        container.append(button);
      });
    }
  }

  function applyWorkspace(workspace, source, options = {}) {
    window.clearTimeout(state.compile.timer);
    state.compile.timer = null;
    state.compile.serial += 1;
    state.workspace = normalizeWorkspace(workspace);
    state.source = source || '导入工作区';
    state.revision += 1;
    state.presetHint = options.presetHint || '';
    state.compile.status = countCommands() ? 'dirty' : 'idle';
    state.compile.operations = [];
    state.compile.dictionary = null;
    state.compile.identity = null;
    state.compile.error = null;
    state.compile.compiledAt = null;
    state.labRevision += 1;
    state.lab.requestSerial += 1;
    state.lab.operation = '';
    state.lab.result = null;
    state.lab.error = null;
    state.lab.busy = false;
    state.lab.freshness = 'stale';
    state.lab.schemaSignature = '';
    state.lab.formData = {};
    state.lab.formJsonText = '{}';
    state.lab.hex = '';
    if ($('decodeInput')) $('decodeInput').value = '';
    $('formJsonError').hidden = true;
    state.modelJsonDirty = false;
    showWorkspaceError(null);
    setGlobalNotice(state.presetHint);
    renderAll();
    if (countCommands()) scheduleCompile();
  }

  function markWorkspaceEdited() {
    state.revision += 1;
    state.source = '本页编辑';
    state.presetHint = '';
    setGlobalNotice('');
    state.compile.serial += 1;
    state.compile.status = countCommands() ? 'dirty' : 'idle';
    state.compile.operations = [];
    state.compile.dictionary = null;
    state.compile.identity = null;
    state.compile.error = null;
    state.compile.compiledAt = null;
    state.labRevision += 1;
    state.lab.requestSerial += 1;
    state.lab.result = null;
    state.lab.error = null;
    state.lab.busy = false;
    state.lab.freshness = 'stale';
    showWorkspaceError(null);
    renderWorkspaceMeta();
    renderCompileStatus();
    renderIdentity();
    if (state.activeTab === 'lab') renderLab();
    scheduleCompile();
  }

  function scheduleCompile() {
    window.clearTimeout(state.compile.timer);
    if (!countCommands()) {
      state.compile.status = 'idle';
      state.compile.operations = [];
      state.compile.dictionary = null;
      state.compile.identity = null;
      renderCompileStatus();
      renderIdentity();
      return;
    }
    state.compile.timer = window.setTimeout(() => {
      state.compile.timer = null;
      compileWorkspace(false);
    }, 650);
  }

  async function compileWorkspace(manual = false) {
    window.clearTimeout(state.compile.timer);
    state.compile.timer = null;
    if (!countCommands()) {
      state.compile.status = 'idle';
      state.compile.operations = [];
      state.compile.dictionary = null;
      state.compile.identity = null;
      state.compile.error = { code: 'DICTIONARY_MISSING', message: '还没有指令字典：请导入字典，或逐行新增指令和字段绑定。' };
      renderCompileStatus();
      renderIdentity();
      if (manual) showWorkspaceError(state.compile.error);
      if (state.activeTab === 'lab') renderLab();
      return;
    }

    const serial = ++state.compile.serial;
    const capturedRevision = state.revision;
    const workspace = workspaceSnapshot();
    state.compile.status = 'compiling';
    state.compile.error = null;
    showWorkspaceError(null);
    renderCompileStatus();
    renderIdentity();

    try {
      const data = await postJson(API.compile, { workspace });
      if (serial !== state.compile.serial || capturedRevision !== state.revision) return;
      state.compile.status = 'ready';
      state.compile.operations = Array.isArray(data.operations) ? data.operations : [];
      state.compile.dictionary = data.dictionary || null;
      state.compile.files = data.files || null;
      state.compile.identity = data.identity || data.dictionary?.identity || null;
      state.compile.compiledAt = new Date();
      setServerState('online');
      reconcileLabSelection();
      reconcileLabForm(false);
      renderWorkspaceMeta();
      renderCompileStatus();
      renderIdentity();
      renderLab();
      if (manual) showToast(`编译完成：${state.compile.operations.length} 条指令`);
    } catch (error) {
      if (serial !== state.compile.serial || capturedRevision !== state.revision) return;
      state.compile.status = 'error';
      state.compile.operations = [];
      state.compile.dictionary = null;
      state.compile.identity = null;
      state.compile.error = { code: error.code || 'CONFIG_INVALID', message: error.message || '编译失败' };
      showWorkspaceError(state.compile.error);
      setServerState(error instanceof ApiError && error.status === 0 ? 'offline' : 'online');
      renderCompileStatus();
      renderIdentity();
      if (state.activeTab === 'lab') renderLab();
    }
  }

  function downloadJson(filename, data) {
    const safeName = String(filename || 'ble-codec.json')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\.json$/i, '');
    const blob = new Blob([`${pretty(data)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeName}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPair() {
    if (!hasCompiledDictionary() || !state.compile.files) return;
    const files = clone(state.compile.files);
    $('downloadModelBtn').onclick = () => { downloadJson('thing-model', files.model); showToast('已下载物模型；请继续下载本次配套的BLE映射。'); };
    $('downloadMappingBtn').onclick = () => { downloadJson('ble-mapping', files.mapping); showToast('已下载BLE映射；请与同次导出的物模型配套使用。'); };
    $('exportPairDialog').showModal();
  }

  async function importPair() {
    if (state.importBusy) return;
    const model = $('pairModel').files?.[0], mapping = $('pairMapping').files?.[0];
    const errorBox = $('importError');
    if (!model || !mapping) { errorBox.textContent = '请选择物模型和BLE映射两个JSON文件。'; errorBox.hidden = false; return; }
    state.importBusy = true;
    $('importPairBtn').disabled = true;
    $('importBusy').hidden = false;
    errorBox.hidden = true;
    try {
      if (model.size + mapping.size > 2 * 1024 * 1024) throw new ApiError('BODY_LENGTH', '两个文件合计须在2MiB以内', 400);
      const modelText = await model.text(), mappingText = await mapping.text();
      for (const [label, text] of [['物模型', modelText], ['BLE映射', mappingText]]) {
        try { JSON.parse(text.replace(/^\uFEFF/, '')); }
        catch (error) { throw new ApiError('IMPORT_JSON', `${label}文件不是有效JSON（读取到${text.length}个字符，${error.message}）；请重新选择完整的UTF-8 JSON文件`, 400); }
      }
      const result = await postJson(API.import, {kind: 'pair', modelText, text: mappingText});
      applyWorkspace(result.workspace, '导入 · 物模型与BLE映射');
      closeImportDialog(); activateTab('config'); showToast('物模型与映射导入成功。');
    } catch (error) {
      errorBox.textContent = `${error.code || 'IMPORT_FAILED'} · ${error.message}；当前工作区未改变。`;
      errorBox.hidden = false;
    } finally {
      state.importBusy = false; $('importPairBtn').disabled = false; $('importBusy').hidden = true;
    }
  }

  function exportWorkspace() {
    const product = state.compile.identity?.product_id || 'ble-codec-workspace';
    downloadJson(`${product}-workspace`, state.workspace);
    showToast(state.modelJsonDirty ? '已导出当前工作区；模型 JSON 中未应用的内容未包含。' : '已导出当前工作区 JSON。');
  }

  function exportDictionary() {
    if (!hasCompiledDictionary()) {
      showToast('需要先成功编译，才能导出机器字典。', 'warning');
      return;
    }
    const product = state.compile.identity?.product_id || 'ble-codec-dictionary';
    downloadJson(`${product}-dictionary`, state.compile.dictionary);
    showToast('已导出当前编译快照的机器字典。');
  }

  function closedObjectSchema(properties = {}) {
    return { type: 'object', properties, required: [], additionalProperties: false };
  }

  function defaultSchemaForType(type) {
    if (type === 'object') return closedObjectSchema();
    if (type === 'array') return { type: 'array', items: { type: 'string' } };
    if (type === 'integer' || type === 'number') return { type, minimum: 0 };
    if (type === 'boolean') return { type };
    return { type: 'string' };
  }

  function modelCategoryLabel(category) {
    return category === 'properties' ? '属性 PROPERTIES' : category === 'methods' ? '服务 SERVICES' : '事件 EVENTS';
  }

  function typeLabel(schema) {
    if (!isObject(schema)) return 'unknown';
    if (schema.type === 'array') return `array<${schema.items?.type || '?'}>`;
    return schema.type || 'object';
  }

  function schemaConstraintText(schema) {
    if (!isObject(schema)) return '—';
    const parts = [];
    if (schema.type === 'object') {
      const count = Object.keys(schema.properties || {}).length;
      parts.push(`${count} 字段 · closed`);
    } else if (schema.type === 'array') {
      parts.push(`元素 ${typeLabel(schema.items)}`);
      if (schema.minItems != null) parts.push(`≥${schema.minItems}`);
      if (schema.maxItems != null) parts.push(`≤${schema.maxItems}`);
    } else {
      if (schema.minimum != null && schema.maximum != null) parts.push(`${schema.minimum}…${schema.maximum}`);
      else if (schema.minimum != null) parts.push(`≥${schema.minimum}`);
      else if (schema.maximum != null) parts.push(`≤${schema.maximum}`);
      if (schema.minLength != null && schema.maxLength != null) parts.push(`${schema.minLength}…${schema.maxLength} 字符`);
      else if (schema.maxLength != null) parts.push(`≤${schema.maxLength} 字符`);
      if (schema.multipleOf != null) parts.push(`×${schema.multipleOf}`);
      if (Array.isArray(schema.enum)) parts.push(`枚举 ${schema.enum.length}`);
      if (schema.format === 'hex') parts.push('HEX 字节');
    }
    return parts.length ? parts.join(' · ') : '—';
  }

  function buildModelNodes() {
    const nodes = [];
    const model = state.workspace.model;

    function pushSchema(context) {
      const id = `n${nodes.length}`;
      const node = { id, ...context };
      nodes.push(node);

      if (context.schema?.type === 'array') {
        const itemSchema = isObject(context.schema.items) ? context.schema.items : { type: 'string' };
        const itemId = `n${nodes.length}`;
        const itemNode = {
          id: itemId,
          kind: 'array-item',
          category: context.category,
          name: '[]',
          displayName: '数组元素',
          pathLabel: `${context.pathLabel}[]`,
          schema: itemSchema,
          depth: context.depth + 1,
          parentSchema: context.schema,
          parentKey: null,
          parentRequired: false,
          deletable: false,
          nameEditable: false,
          fixedObject: false,
          canAddChild: itemSchema.type === 'object',
          arrayOwner: context.schema,
          ownerMethodName: context.ownerMethodName,
          virtualRole: null
        };
        nodes.push(itemNode);
        if (itemSchema.type === 'object') {
          for (const [name, childSchema] of Object.entries(itemSchema.properties || {})) {
            pushSchema({
              kind: 'schema',
              category: context.category,
              name,
              displayName: childSchema?.title || name,
              pathLabel: `${itemNode.pathLabel}.${name}`,
              schema: childSchema,
              depth: itemNode.depth + 1,
              parentSchema: itemSchema,
              parentKey: name,
              parentRequired: (itemSchema.required || []).includes(name),
              deletable: true,
              nameEditable: true,
              fixedObject: false,
              canAddChild: childSchema?.type === 'object',
              ownerMethodName: context.ownerMethodName,
              virtualRole: null
            });
          }
        }
      }

      if (context.schema?.type === 'object') {
        for (const [name, childSchema] of Object.entries(context.schema.properties || {})) {
          pushSchema({
            kind: 'schema',
            category: context.category,
            name,
            displayName: childSchema?.title || name,
            pathLabel: `${context.pathLabel}.${name}`,
            schema: childSchema,
            depth: context.depth + 1,
            parentSchema: context.schema,
            parentKey: name,
            parentRequired: (context.schema.required || []).includes(name),
            deletable: true,
            nameEditable: true,
            fixedObject: false,
            canAddChild: childSchema?.type === 'object',
            ownerMethodName: context.ownerMethodName,
            virtualRole: null
          });
        }
      }
    }

    for (const [name, schema] of Object.entries(model.properties || {})) {
      pushSchema({
        kind: 'schema',
        category: 'properties',
        name,
        displayName: schema?.title || name,
        pathLabel: `properties.${name}`,
        schema,
        depth: 0,
        parentSchema: null,
        parentKey: null,
        parentRequired: false,
        deletable: true,
        nameEditable: true,
        fixedObject: false,
        canAddChild: schema?.type === 'object',
        ownerMethodName: null,
        virtualRole: null
      });
    }

    for (const [name, method] of Object.entries(model.methods || {})) {
      const id = `n${nodes.length}`;
      nodes.push({
        id,
        kind: 'method',
        category: 'methods',
        name,
        displayName: method?.name || name,
        pathLabel: `methods.${name}`,
        method,
        schema: null,
        depth: 0,
        deletable: true,
        fixedObject: false
      });
      for (const role of ['input', 'output']) {
        const schema = method?.[role] || closedObjectSchema();
        const virtualId = `n${nodes.length}`;
        nodes.push({
          id: virtualId,
          kind: 'virtual-schema',
          category: 'methods',
          name: role,
          displayName: role === 'input' ? '服务输入 input' : '方法输出 output',
          pathLabel: `methods.${name}.${role}`,
          schema,
          depth: 1,
          parentSchema: null,
          parentKey: null,
          parentRequired: false,
          deletable: false,
          nameEditable: false,
          fixedObject: true,
          canAddChild: schema?.type === 'object',
          ownerMethodName: name,
          virtualRole: role
        });
        for (const [childName, childSchema] of Object.entries(schema?.properties || {})) {
          pushSchema({
            kind: 'schema',
            category: 'methods',
            name: childName,
            displayName: childSchema?.title || childName,
            pathLabel: `methods.${name}.${role}.${childName}`,
            schema: childSchema,
            depth: 2,
            parentSchema: schema,
            parentKey: childName,
            parentRequired: (schema.required || []).includes(childName),
            deletable: true,
            nameEditable: true,
            fixedObject: false,
            canAddChild: childSchema?.type === 'object',
            ownerMethodName: name,
            virtualRole: role
          });
        }
      }
    }

    for (const [name, schema] of Object.entries(model.events || {})) {
      pushSchema({
        kind: 'schema',
        category: 'events',
        name,
        displayName: schema?.title || name,
        pathLabel: `events.${name}`,
        schema,
        depth: 0,
        parentSchema: null,
        parentKey: null,
        parentRequired: false,
        deletable: true,
        nameEditable: true,
        fixedObject: false,
        canAddChild: schema?.type === 'object',
        ownerMethodName: null,
        virtualRole: null
      });
    }

    return nodes;
  }

  function renderModelEditor() {
    state.modelNodes = buildModelNodes();
    renderModelTree();
    configUI?.renderModel();
    if (!state.modelJsonDirty) syncModelJsonText();
  }

  function treeRowHtml(node) {
    let type = node.kind === 'method' ? 'method' : typeLabel(node.schema);
    let typeClass = node.kind === 'method' ? 'method' : node.schema?.type === 'array' ? 'array' : node.schema?.type === 'object' ? 'object' : 'leaf';
    let icon = node.kind === 'method' ? 'M' : node.kind === 'array-item' ? '[]' : node.schema?.type === 'object' ? '{}' : node.schema?.type === 'array' ? '[]' : '·';
    let required = '—';
    if (node.kind === 'schema' || node.kind === 'array-item') {
      required = node.parentSchema
        ? node.parentRequired ? '<span class="required-mark">必填</span>' : '<span class="optional-mark">可选</span>'
        : '<span class="optional-mark">根节点</span>';
    }
    const constraint = node.kind === 'method'
      ? `input ${Object.keys(node.method?.input?.properties || {}).length} · output ${Object.keys(node.method?.output?.properties || {}).length}`
      : schemaConstraintText(node.schema);
    let actions = '';
    if (node.kind === 'method') {
      actions = `<button class="tree-action" type="button" data-action="edit-method" data-node-id="${node.id}">编辑</button><button class="tree-action danger" type="button" data-action="delete-method" data-node-id="${node.id}">删除</button>`;
    } else {
      if (node.canAddChild) actions += `<button class="tree-action" type="button" data-action="add-child" data-node-id="${node.id}">＋子字段</button>`;
      actions += `<button class="tree-action" type="button" data-action="edit-node" data-node-id="${node.id}">编辑</button>`;
      if (node.deletable) actions += `<button class="tree-action danger" type="button" data-action="delete-node" data-node-id="${node.id}">删除</button>`;
    }
    return `
      <div class="tree-row ${node.kind === 'method' ? 'is-method' : node.kind === 'virtual-schema' ? 'is-virtual' : ''}" role="treeitem" aria-level="${Math.min(node.depth + 1, 6)}" style="--depth:${node.depth}">
        <div class="tree-main">
          <div class="tree-label-line">
            <span class="tree-node-icon ${typeClass}">${escapeHtml(icon)}</span>
            <span class="tree-name">${escapeHtml(node.name)}</span>
            <span class="tree-title">${escapeHtml(node.displayName || '')}</span>
          </div>
          <div class="tree-path" title="${escapeHtml(node.pathLabel)}">${escapeHtml(node.pathLabel)}</div>
        </div>
        <span class="type-pill ${typeClass}" title="${escapeHtml(type)}">${escapeHtml(type)}</span>
        <span>${required}</span>
        <span class="tree-constraint" title="${escapeHtml(constraint)}">${escapeHtml(constraint)}</span>
        <div class="tree-actions">${actions}</div>
      </div>
    `;
  }

  function renderModelTree() {
    const container = $('modelTree');
    if (!container) return;
    const categories = ['properties', 'methods', 'events'];
    container.innerHTML = categories.map((category) => {
      const rows = state.modelNodes.filter((node) => node.category === category);
      const head = `<div class="tree-category-head"><span>${modelCategoryLabel(category)}</span><span>${rows.length}</span></div>`;
      const body = rows.length
        ? rows.map((node) => treeRowHtml(node)).join('')
        : `<div class="tree-category-empty">${category === 'methods' ? '还没有服务；添加后配置 input / output。' : category === 'properties' ? '没有属性节点。属性需经实际指令映射才参与转换。' : '没有事件节点。事件需经实际指令映射才参与转换。'}</div>`;
      return `<section class="tree-category">${head}${body}</section>`;
    }).join('');
  }

  function syncModelJsonText() {
    const editor = $('modelJson');
    if (!editor) return;
    const model = {...clone(state.workspace.model_metadata || {}), ...clone(state.workspace.model)};
    model.services = model.methods;
    delete model.methods;
    editor.value = pretty(model);
    state.modelJsonDirty = false;
    setModelJsonMessage('');
  }

  function setModelJsonMessage(message, success = false) {
    const node = $('modelJsonStatus');
    node.textContent = message || '';
    node.hidden = !message;
    node.classList.toggle('is-success', Boolean(success));
  }

  function guardJsonDraft() {
    if (!state.modelJsonDirty) return true;
    const proceed = window.confirm('模型 JSON 中有未应用的修改。继续使用结构树会丢弃这些文本，是否继续？');
    if (proceed) {
      state.modelJsonDirty = false;
      syncModelJsonText();
    }
    return proceed;
  }

  async function applyModelJson() {
    const text = $('modelJson').value;
    const revision = state.revision;
    $('applyModelJsonBtn').disabled = true;
    try {
      const imported = await postJson(API.import, {kind: 'model', text, workspace: workspaceSnapshot()});
      const candidate = imported.workspace;
      if (candidate.commands.length) await postJson(API.compile, {workspace: candidate});
      if (revision !== state.revision || text !== $('modelJson').value) throw new Error('校验期间内容已变化，请重新应用');
      state.workspace = normalizeWorkspace(candidate);
      state.modelJsonDirty = false;
      markWorkspaceEdited();
      renderModelEditor();
      renderTable();
      setModelJsonMessage('JSON及映射引用校验通过，已应用。', true);
      showToast('模型 JSON 已应用。');
    } catch (error) {
      setModelJsonMessage(`JSON 未应用：${error.message}。当前有效模型保持原样。`);
    } finally {
      $('applyModelJsonBtn').disabled = false;
    }
  }

  function formatModelJson() {
    try {
      const parsed = JSON.parse($('modelJson').value);
      $('modelJson').value = pretty(parsed);
      state.modelJsonDirty = true;
      setModelJsonMessage('已格式化，点击“应用 JSON”后写入工作区。', true);
    } catch (error) {
      setModelJsonMessage(`无法格式化：${error.message}`);
    }
  }

  function nodeById(id) {
    return state.modelNodes.find((node) => node.id === id) || null;
  }

  function openNodeDialog(editor) {
    state.nodeEditor = editor;
    const dialog = $('nodeDialog');
    const schemaMode = editor.mode !== 'method';
    $('nodeDialogEyebrow').textContent = schemaMode ? 'MODEL NODE' : 'METHOD';
    $('nodeDialogTitle').textContent = schemaMode ? (editor.intent === 'create' ? '添加模型节点' : '配置模型节点') : (editor.intent === 'create' ? '添加物模型服务' : '编辑物模型服务');
    $('nodeDialogSubtitle').textContent = schemaMode
      ? '维护业务定义；修改标识符会同步更新明确关联的BLE映射。'
      : '修改服务标识符会保留输入／输出，并同步更新指令引用。';
    $('nodeMode').value = editor.mode;
    $('nodeNameLabel').textContent = schemaMode ? '字段键名' : '方法键名';
    $('nodeKey').value = editor.intent === 'create' ? '' : editor.oldKey || '';
    $('nodeTitle').value = schemaMode ? (editor.schema?.title || '') : (editor.method?.name || '');
    $('nodeDescription').value = schemaMode ? (editor.schema?.description || '') : (editor.method?.description || '');
    $('nodeKey').disabled = !editor.nameEditable;
    $('nodeSchemaFields').hidden = !schemaMode;
    $('nodeWarning').hidden = false;
    $('nodeFormError').hidden = true;
    $('nodeFormError').textContent = '';
    $('propertyAccessWrap').hidden = !(schemaMode && editor.bucket === 'properties');
    $('propertyAccess').value = editor.schema?.access || 'rw';

    if (schemaMode) {
      const schema = editor.schema || defaultSchemaForType('string');
      $('nodeType').value = schema.type || 'object';
      $('nodeType').disabled = Boolean(editor.fixedObject);
      $('arrayItemType').value = schema.items?.type || 'object';
      $('nodeRequired').checked = Boolean(editor.parentSchema && editor.intent === 'create' ? true : editor.parentRequired);
      $('nodeMinimum').value = schema.minimum ?? '';
      $('nodeMaximum').value = schema.maximum ?? '';
      $('nodeMinLength').value = schema.minLength ?? '';
      $('nodeMaxLength').value = schema.maxLength ?? '';
      $('nodeMinItems').value = schema.minItems ?? '';
      $('nodeMaxItems').value = schema.maxItems ?? '';
      $('nodeMultipleOf').value = schema.multipleOf ?? '';
      $('nodeEnum').value = Array.isArray(schema.enum) ? schema.enum.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n') : '';
      updateNodeDialogVisibility();
    }

    if (dialog.open) dialog.close();
    dialog.showModal();
    window.setTimeout(() => {
      if (!$('nodeKey').disabled) $('nodeKey').focus();
      else $('nodeType').focus();
    }, 0);
  }

  function updateNodeDialogVisibility() {
    const editor = state.nodeEditor;
    if (!editor || editor.mode === 'method') return;
    const type = $('nodeType').value;
    $('arrayItemTypeWrap').hidden = type !== 'array';
    $('requiredFieldWrap').hidden = !editor.parentSchema;
    $('nodeConstraintFields').hidden = type === 'object';
    const applicable = {
      nodeMinimum: ['integer','number'], nodeMaximum: ['integer','number'],
      nodeMultipleOf: ['integer','number'], nodeMinLength: ['string'], nodeMaxLength: ['string'],
      nodeMinItems: ['array'], nodeMaxItems: ['array'], nodeEnum: ['integer','number','boolean','string']
    };
    for (const [id, types] of Object.entries(applicable)) {
      const control = $(id);
      control.closest('label').hidden = !types.includes(type);
      control.disabled = !types.includes(type);
    }
  }

  function openCreateRoot(category) {
    if (!guardJsonDraft()) return;
    openNodeDialog({
      mode: 'schema',
      intent: 'create',
      category,
      bucket: category,
      schema: defaultSchemaForType(category === 'events' ? 'object' : 'string'),
      parentSchema: null,
      parentRequired: false,
      oldKey: '',
      nameEditable: true,
      fixedObject: false
    });
  }

  function openAddChild(id) {
    const node = nodeById(id);
    if (!node || node.schema?.type !== 'object') return;
    if (!guardJsonDraft()) return;
    openNodeDialog({
      mode: 'schema',
      intent: 'create',
      category: node.category,
      bucket: null,
      schema: defaultSchemaForType('string'),
      parentSchema: node.schema,
      parentRequired: true,
      oldKey: '',
      nameEditable: true,
      fixedObject: false,
      ownerMethodName: node.ownerMethodName,
      virtualRoot: false,
      arrayItemRoot: false
    });
  }

  function openEditNode(id) {
    const node = nodeById(id);
    if (!node || node.kind === 'method') return;
    if (!guardJsonDraft()) return;
    openNodeDialog({
      mode: 'schema',
      intent: 'edit',
      category: node.category,
      bucket: node.kind === 'schema' && !node.parentSchema ? node.category : null,
      schema: node.schema,
      parentSchema: node.parentSchema,
      parentRequired: node.parentRequired,
      oldKey: node.name,
      nameEditable: node.nameEditable,
      fixedObject: node.fixedObject,
      arrayOwner: node.kind === 'array-item' ? node.arrayOwner : null,
      arrayItemRoot: node.kind === 'array-item',
      virtualRoot: node.kind === 'virtual-schema',
      ownerMethodName: node.ownerMethodName,
      referencePath: node.pathLabel
    });
  }

  function openCreateMethod() {
    if (!guardJsonDraft()) return;
    openNodeDialog({ mode: 'method', intent: 'create', nameEditable: true, oldKey: '' });
  }

  function openEditMethod(id) {
    const node = nodeById(id);
    if (!node || node.kind !== 'method' || !guardJsonDraft()) return;
    openNodeDialog({ mode: 'method', intent: 'edit', method: node.method, oldKey: node.name, nameEditable: true, referencePath: node.pathLabel, kind: 'method' });
  }

  function parseOptionalNumber(value, integer = false) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const number = Number(text);
    if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) throw new Error('约束值必须是有效数字');
    return number;
  }

  function parseEnumLines(value) {
    const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;
    return lines.map((line) => {
      try { return JSON.parse(line); } catch { return line; }
    });
  }

  function removeSchemaKeys(schema, keys) {
    for (const key of keys) delete schema[key];
  }

  function normalizeSchemaForType(schema, type) {
    if (type === 'object') {
      removeSchemaKeys(schema, ['items', 'minimum', 'maximum', 'multipleOf', 'minItems', 'maxItems', 'minLength', 'maxLength', 'format']);
      schema.properties = isObject(schema.properties) ? schema.properties : {};
      schema.required = Array.isArray(schema.required) ? schema.required.filter((name) => Object.hasOwn(schema.properties, name)) : [];
      schema.additionalProperties = false;
    } else if (type === 'array') {
      removeSchemaKeys(schema, ['properties', 'required', 'additionalProperties', 'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'format']);
      if (!isObject(schema.items)) schema.items = { type: 'string' };
      if (schema.items.type === 'object') {
        schema.items.properties = isObject(schema.items.properties) ? schema.items.properties : {};
        schema.items.required = Array.isArray(schema.items.required) ? schema.items.required : [];
        schema.items.additionalProperties = false;
      }
    } else {
      removeSchemaKeys(schema, ['properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems']);
      if (type === 'string') removeSchemaKeys(schema, ['minimum', 'maximum', 'multipleOf']);
      else {
        removeSchemaKeys(schema, ['minLength', 'maxLength']);
        if (type === 'boolean') removeSchemaKeys(schema, ['minimum', 'maximum', 'multipleOf']);
      }
      if (type !== 'string') delete schema.format;
      else if (schema.format != null && schema.format !== 'hex') delete schema.format;
    }
  }

  function replaceObjectContents(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
  }

  function saveSchemaNode(editor, name) {
    const type = editor.fixedObject ? 'object' : $('nodeType').value;
    const next = clone(isObject(editor.schema) ? editor.schema : {});
    if (editor.bucket === 'properties') next.access = $('propertyAccess').value;
    next.type = type;
    const title = $('nodeTitle').value.trim();
    const description = $('nodeDescription').value.trim();
    if (title) next.title = title; else delete next.title;
    if (description) next.description = description; else delete next.description;

    const minimum = parseOptionalNumber($('nodeMinimum').disabled ? '' : $('nodeMinimum').value);
    const maximum = parseOptionalNumber($('nodeMaximum').disabled ? '' : $('nodeMaximum').value);
    const minLength = parseOptionalNumber($('nodeMinLength').disabled ? '' : $('nodeMinLength').value, true);
    const maxLength = parseOptionalNumber($('nodeMaxLength').disabled ? '' : $('nodeMaxLength').value, true);
    const minItems = parseOptionalNumber($('nodeMinItems').disabled ? '' : $('nodeMinItems').value, true);
    const maxItems = parseOptionalNumber($('nodeMaxItems').disabled ? '' : $('nodeMaxItems').value, true);
    const multipleOf = parseOptionalNumber($('nodeMultipleOf').disabled ? '' : $('nodeMultipleOf').value);
    if ((minLength != null && minLength < 0) || (maxLength != null && maxLength < 0) || (minItems != null && minItems < 0) || (maxItems != null && maxItems < 0)) {
      throw new Error('长度与项数不能为负数');
    }
    if (minimum != null && maximum != null && minimum > maximum) throw new Error('最小值不能大于最大值');
    if (minLength != null && maxLength != null && minLength > maxLength) throw new Error('最小长度不能大于最大长度');
    if (minItems != null && maxItems != null && minItems > maxItems) throw new Error('最小项数不能大于最大项数');
    if (multipleOf != null && multipleOf <= 0) throw new Error('multipleOf 必须大于 0');

    normalizeSchemaForType(next, type);
    const numericFields = [
      ['minimum', minimum], ['maximum', maximum], ['minLength', minLength], ['maxLength', maxLength],
      ['minItems', minItems], ['maxItems', maxItems], ['multipleOf', multipleOf]
    ];
    for (const [key, value] of numericFields) {
      if (value == null) delete next[key];
      else next[key] = value;
    }
    const enumValues = parseEnumLines($('nodeEnum').disabled ? '' : $('nodeEnum').value);
    if (enumValues) next.enum = enumValues; else delete next.enum;

    if (type === 'array') {
      const itemType = $('arrayItemType').value;
      const item = isObject(next.items) ? next.items : {};
      item.type = itemType;
      if (itemType === 'object') {
        item.properties = isObject(item.properties) ? item.properties : {};
        item.required = Array.isArray(item.required) ? item.required : [];
        item.additionalProperties = false;
      } else {
        removeSchemaKeys(item, ['properties', 'required', 'additionalProperties']);
      }
      if (itemType === 'array' && !isObject(item.items)) item.items = { type: 'string' };
      next.items = item;
    }

    const shouldBeRequired = Boolean(editor.parentSchema && $('nodeRequired').checked);
    if (editor.arrayItemRoot) {
      replaceObjectContents(editor.schema, next);
      markWorkspaceEdited();
      return;
    }
    if (editor.virtualRoot) {
      replaceObjectContents(editor.schema, next);
      markWorkspaceEdited();
      return;
    }

    if (editor.bucket) {
      const bucket = state.workspace.model[editor.bucket];
      if (editor.intent === 'create' || editor.oldKey !== name) {
        if (Object.hasOwn(bucket, name)) throw new Error(`键名 ${name} 已存在`);
        if (editor.intent === 'edit') delete bucket[editor.oldKey];
        bucket[name] = next;
      } else {
        bucket[editor.oldKey] = next;
      }
    } else if (editor.parentSchema) {
      const properties = editor.parentSchema.properties || (editor.parentSchema.properties = {});
      const required = Array.isArray(editor.parentSchema.required) ? editor.parentSchema.required : (editor.parentSchema.required = []);
      if (editor.intent === 'create' || editor.oldKey !== name) {
        if (Object.hasOwn(properties, name)) throw new Error(`同级字段 ${name} 已存在`);
        if (editor.intent === 'edit') delete properties[editor.oldKey];
      }
      properties[name] = next;
      const oldIndex = required.indexOf(editor.oldKey);
      if (oldIndex >= 0) required.splice(oldIndex, 1);
      const newIndex = required.indexOf(name);
      if (shouldBeRequired && newIndex < 0) required.push(name);
      if (!shouldBeRequired && newIndex >= 0) required.splice(newIndex, 1);
      editor.parentSchema.additionalProperties = false;
    }
    configUI?.rename(editor, name);
    markWorkspaceEdited();
  }

  function saveMethod(editor, name) {
    const title = $('nodeTitle').value.trim() || name;
    const description = $('nodeDescription').value.trim();
    const methods = state.workspace.model.methods;
    if (editor.intent === 'create' || editor.oldKey !== name) {
      if (Object.hasOwn(methods, name)) throw new Error(`方法 ${name} 已存在`);
      if (editor.intent === 'edit') delete methods[editor.oldKey];
      methods[name] = editor.intent === 'edit' ? clone(editor.method) : { input: closedObjectSchema(), output: closedObjectSchema() };
      methods[name].name = title;
      if (description) methods[name].description = description; else delete methods[name].description;
    } else {
      const method = methods[editor.oldKey];
      method.name = title;
      if (description) method.description = description; else delete method.description;
    }
    configUI?.rename(editor, name);
    markWorkspaceEdited();
  }

  function saveNodeDialog(event) {
    event.preventDefault();
    const editor = state.nodeEditor;
    if (!editor) return;
    const errorBox = $('nodeFormError');
    errorBox.hidden = true;
    try {
      let name = $('nodeKey').value.trim();
      if (editor.arrayItemRoot) name = '[]';
      else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error('键名必须以字母或下划线开头，只能包含字母、数字和下划线');
      }
      configUI?.validateRename(editor, name);
      if (editor.mode === 'method') saveMethod(editor, name);
      else saveSchemaNode(editor, name);
      if (editor.mode === 'schema' && !editor.arrayItemRoot && !editor.virtualRoot && editor.intent === 'create' && editor.parentSchema && $('nodeRequired').checked) {
        const required = editor.parentSchema.required || (editor.parentSchema.required = []);
        if (!required.includes(name)) required.push(name);
      }
      state.nodeEditor = null;
      state.modelJsonDirty = false;
      $('nodeDialog').close();
      renderModelEditor();
      renderTable();
      showToast('模型结构已更新，正在重新编译。');
    } catch (error) {
      errorBox.textContent = error.message || '节点保存失败';
      errorBox.hidden = false;
    }
  }

  function deleteNodeById(id) {
    const node = nodeById(id);
    if (!node || !node.deletable || !guardJsonDraft()) return;
    const refs = configUI?.references(node) || [];
    if (refs.length) {
      showWorkspaceError({code: 'MODEL_IN_USE', message: `不能删除 ${node.pathLabel}，仍被引用：${refs.join('；')}。请先处理相关映射。`});
      return;
    }
    const label = node.pathLabel;
    if (!window.confirm(`删除模型节点 ${label}？`)) return;
    if (node.kind === 'method') {
      delete state.workspace.model.methods[node.name];
    } else if (!node.parentSchema && node.category) {
      delete state.workspace.model[node.category][node.name];
    } else if (node.parentSchema?.properties) {
      delete node.parentSchema.properties[node.name];
      if (Array.isArray(node.parentSchema.required)) {
        node.parentSchema.required = node.parentSchema.required.filter((name) => name !== node.name);
      }
    }
    markWorkspaceEdited();
    renderModelEditor();
    renderTable();
    showToast('未被引用的节点已删除。');
  }

  function renderTable() {
    if (configUI) { configUI.renderMappings(); return; }
    const tableName = state.activeTable;
    const columns = state.columns[tableName] || FALLBACK_COLUMNS[tableName];
    const rows = state.workspace[tableName] || [];
    const meta = TABLE_META[tableName];
    for (const button of document.querySelectorAll('[data-table-tab]')) {
      const active = button.dataset.tableTab === tableName;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
    $('commandsCount').textContent = String(state.workspace.commands.length);
    $('bindingsCount').textContent = String(state.workspace.bindings.length);
    $('groupsCount').textContent = String(state.workspace.groups.length);
    $('tableTitle').textContent = meta.title;
    $('tableDescription').textContent = meta.description;
    $('tableHint').textContent = meta.hint;
    $('tableCount').textContent = `${rows.length} 行`;
    $('tableEmpty').hidden = rows.length > 0;
    $('tableScroll').hidden = rows.length === 0;

    const head = $('workspaceTableHead');
    const body = $('workspaceTableBody');
    const widths = columns.map((column) => COLUMN_META[column]?.[1] || 120);
    $('workspaceTableCols').innerHTML = `<col style="width:46px">${widths.map((width) => `<col style="width:${width}px">`).join('')}<col style="width:52px">`;
    head.innerHTML = `<tr><th class="row-index-cell">#</th>${columns.map((column) => `<th title="${escapeHtml(column)}"><span class="column-heading"><span>${escapeHtml(COLUMN_META[column]?.[0] || column)}</span><code>${escapeHtml(column)}</code></span></th>`).join('')}<th class="row-action-cell"></th></tr>`;
    body.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="row-index-cell">${index + 1}</td>
        ${columns.map((column) => `<td><input class="cell-input" type="text" spellcheck="false" value="${escapeHtml(row[column] || '')}" data-row-index="${index}" data-column="${escapeHtml(column)}" aria-label="${escapeHtml(COLUMN_META[column]?.[0] || column)} 第 ${index + 1} 行"></td>`).join('')}
        <td class="row-action-cell"><button class="row-delete" type="button" data-delete-row="${index}" aria-label="删除第 ${index + 1} 行" title="删除此行">×</button></td>
      </tr>
    `).join('');
  }

  function newRowForTable(tableName) {
    const row = {};
    for (const column of state.columns[tableName]) row[column] = '';
    if (tableName === 'commands') row.availability = 'active';
    const firstOperation = state.workspace.commands[0]?.operation || '';
    if ((tableName === 'bindings' || tableName === 'groups') && firstOperation) {
      row.operation = firstOperation;
      row.role = 'request';
      if (tableName === 'bindings') row.required = 'O';
    }
    return row;
  }

  function addTableRow() {
    if (configUI) { configUI.addRow(); return; }
    const row = newRowForTable(state.activeTable);
    state.workspace[state.activeTable].push(row);
    markWorkspaceEdited();
    renderTable();
  }

  function removeTableRow(index) {
    const rows = state.workspace[state.activeTable];
    if (!rows[index]) return;
    if (!window.confirm(`删除${TABLE_META[state.activeTable].title}第 ${index + 1} 行？`)) return;
    rows.splice(index, 1);
    markWorkspaceEdited();
    renderTable();
  }

  function handleTableInput(event) {
    const input = event.target.closest('.cell-input');
    if (!input) return;
    const rowIndex = Number(input.dataset.rowIndex);
    const column = input.dataset.column;
    const row = state.workspace[state.activeTable][rowIndex];
    if (!row || !Object.hasOwn(row, column)) return;
    row[column] = input.value;
    markWorkspaceEdited();
  }

  function reconcileLabSelection() {
    const operations = state.compile.operations;
    const exists = operations.some((item) => item.operation === state.lab.operation);
    if (!exists) {
      state.lab.operation = state.lab.mode === 'decode' ? 'auto' : (operations[0]?.operation || '');
    }
    if (state.lab.mode === 'encode' && state.lab.operation === 'auto') {
      state.lab.operation = operations[0]?.operation || '';
    }
  }

  function activeOperation() {
    return state.compile.operations.find((item) => item.operation === state.lab.operation) || null;
  }

  function activeSchema() {
    if (state.lab.mode === 'decode' && state.lab.operation === 'auto') return null;
    const operation = activeOperation();
    if (!operation) return null;
    return state.lab.direction === 'down' ? operation.request_schema : operation.incoming_schema;
  }

  function schemaSignature(schema) {
    try { return schema ? JSON.stringify(schema) : ''; } catch { return ''; }
  }

  function defaultForSchema(schema) {
    if (!isObject(schema)) return null;
    if (Array.isArray(schema.enum) && schema.enum.length) return clone(schema.enum[0]);
    if (schema.type === 'object') {
      const value = {};
      for (const name of schema.required || []) {
        if (isObject(schema.properties?.[name])) value[name] = defaultForSchema(schema.properties[name]);
      }
      return value;
    }
    if (schema.type === 'array') {
      const count = Math.max(0, Number(schema.minItems) || 0);
      return Array.from({ length: count }, () => defaultForSchema(schema.items));
    }
    if (schema.type === 'integer' || schema.type === 'number') return Number.isFinite(Number(schema.minimum)) ? Number(schema.minimum) : 0;
    if (schema.type === 'boolean') return false;
    return '';
  }

  function reconcileLabForm(forceReset = false) {
    const schema = activeSchema();
    const signature = schemaSignature(schema);
    if (!schema) {
      state.lab.schemaSignature = '';
      if (forceReset) {
        state.lab.formData = {};
        state.lab.formJsonText = '{}';
      }
      return;
    }
    if (forceReset || signature !== state.lab.schemaSignature || !isObject(state.lab.formData)) {
      state.lab.formData = defaultForSchema(schema) || {};
      state.lab.formJsonText = pretty(state.lab.formData);
      state.lab.schemaSignature = signature;
    }
  }

  function clearLabResult(freshness = 'stale') {
    state.lab.requestSerial += 1;
    state.lab.result = null;
    state.lab.error = null;
    state.lab.busy = false;
    state.lab.freshness = freshness;
    renderResult();
  }

  function noteLabInputChanged() {
    state.labRevision += 1;
    state.lab.requestSerial += 1;
    state.lab.result = null;
    state.lab.error = null;
    state.lab.freshness = 'stale';
    renderResult();
  }

  function hexByte(value) {
    if (typeof value === 'number') return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
    const text = String(value ?? '').replace(/^0x/i, '').toUpperCase();
    return /^[0-9A-F]{1,2}$/.test(text) ? `0x${text.padStart(2, '0')}` : String(value ?? '');
  }

  function operationMetaHtml(operation) {
    if (!operation) return '<span>尚未选择有效指令</span>';
    return [
      `<span>SID ${escapeHtml(hexByte(operation.sid))}</span>`,
      `<span>CID ${escapeHtml(hexByte(operation.cid))}</span>`,
      `<span>${escapeHtml(operation.method)}</span>`,
      `<span>${operation.availability === 'suspended' ? '规范挂起' : !operation.can_encode_down ? '仅上行' : operation.can_encode_up ? '上下行布局' : operation.interaction === 'one_way' ? '仅下行，无应用回包' : '下行及响应'}</span>`
    ].join('');
  }

  function renderOperationOptions() {
    const select = $('operationSelect');
    const previous = state.lab.operation;
    const options = [];
    if (state.lab.mode === 'decode') options.push({ value: 'auto', label: '自动识别（仅按 SID/CID）' });
    for (const operation of state.compile.operations) {
      options.push({
        value: operation.operation,
        label: `${operation.availability === 'suspended' ? '[挂起] ' : !operation.can_encode_down ? '[仅上行] ' : ''}${operation.operation}  ·  ${hexByte(operation.sid)}/${hexByte(operation.cid)}`
      });
    }
    if (!options.length) {
      options.push({ value: '', label: state.compile.status === 'compiling' ? '正在编译…' : '没有可用指令' });
    }
    select.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
    if (options.some((option) => option.value === previous)) select.value = previous;
    else select.value = options[0].value;
    state.lab.operation = select.value;
    select.disabled = state.compile.status !== 'ready' || state.compile.operations.length === 0;
  }

  function renderLab() {
    const directionButtons = document.querySelectorAll('[data-direction]');
    directionButtons.forEach((button) => {
      const active = button.dataset.direction === state.lab.direction;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const modeButtons = document.querySelectorAll('[data-mode]');
    modeButtons.forEach((button) => {
      const active = button.dataset.mode === state.lab.mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    renderOperationOptions();
    const operation = activeOperation();
    $('operationHelp').textContent = state.lab.mode === 'decode'
      ? '自动识别只按前 2 字节 SID/CID 唯一匹配；也可明确选择指令。'
      : '编码必须明确选择指令，不能使用自动识别。';
    $('operationMeta').innerHTML = operationMetaHtml(operation);

    const schema = activeSchema();
    const isAuto = state.lab.mode === 'decode' && state.lab.operation === 'auto';
    const scopeLabel = isAuto ? '自动识别' : state.lab.direction === 'down' ? '业务输入 request' : '方法输出 incoming';
    $('labScopeBadge').textContent = scopeLabel;
    $('labScopeDescription').textContent = isAuto
      ? '按 PDU 的 SID/CID 在当前字典中查找唯一指令。'
      : state.lab.direction === 'down'
        ? '表单依据所选指令的 request_schema 生成，对应 APP → 设备。'
        : operation?.can_encode_up
          ? '表单依据所选指令的 incoming_schema 生成，对应设备 → APP。'
          : '该指令没有标为可编码的上行数据布局；仍可尝试解码上行 PDU。';

    const encodeMode = state.lab.mode === 'encode';
    $('encodePane').hidden = !encodeMode;
    $('decodePane').hidden = encodeMode;
    $('formViewSwitch').hidden = !encodeMode;
    $('inputEyebrow').textContent = encodeMode ? 'MODEL INPUT' : 'PDU HEX';
    $('inputPanelTitle').textContent = encodeMode ? '采用模型表单填写' : '粘贴完整应用 PDU';
    $('labTitle').textContent = encodeMode ? '构造应用层 PDU' : '解析应用层 PDU';
    $('labSubtitle').textContent = state.presetHint || (encodeMode
      ? '按物模型输入生成 HEX，并在提交前核对转换值。'
      : '把 HEX 转成物模型 JSON，交互元数据单独展示。');
    $('formScopeText').textContent = schema
      ? `${state.lab.direction === 'down' ? 'request' : 'incoming'} schema · 表单由当前模型生成`
      : isAuto ? '自动识别模式不使用表单' : '等待有效指令与 schema';
    $('encodeActionNote').textContent = operation?.availability === 'suspended' ? '规范挂起：保留定义，不执行编解码。' : operation && state.lab.direction === 'down' && !operation.can_encode_down ? '此指令只定义上行数据，请切换为上行。' : operation && state.lab.direction === 'up' && !operation.can_encode_up
      ? '当前指令未声明可编码的上行数据布局。'
      : '编码请求会携带当前全部编辑，由浏览器引擎重新编译。';
    $('encodeBtn').disabled = state.compile.status !== 'ready' || !operation || isAuto || operation.availability === 'suspended' || (state.lab.direction === 'up' ? !operation.can_encode_up : !operation.can_encode_down);
    $('decodeBtn').disabled = state.compile.status !== 'ready' || !state.lab.operation || operation?.availability === 'suspended' || (operation && state.lab.direction === 'down' && !operation.can_encode_down);

    renderFormArea();
    renderResult();
    updateHexInputMeta();
  }

  function renderFormArea() {
    const schema = activeSchema();
    const formRoot = $('generatedForm');
    const empty = $('formEmpty');
    const jsonShell = $('formJsonShell');
    const useJson = state.lab.formView === 'json';
    document.querySelectorAll('[data-form-view]').forEach((button) => {
      const active = button.dataset.formView === state.lab.formView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (!schema) {
      formRoot.hidden = true;
      jsonShell.hidden = true;
      empty.hidden = false;
      $('formEmptyText').textContent = state.lab.operation === 'auto'
        ? '自动识别只用于解码；切换到编码或明确选择指令后生成表单。'
        : state.compile.status === 'ready'
          ? '当前指令和方向没有可用的模型 schema。'
          : '编译成功后根据所选服务生成表单。';
      return;
    }
    empty.hidden = true;
    formRoot.hidden = useJson;
    jsonShell.hidden = !useJson;
    if (useJson) {
      $('formJson').value = state.lab.formJsonText;
      return;
    }
    renderGeneratedForm(formRoot, schema, state.lab.formData);
  }

  function createTextElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderGeneratedForm(root, schema, data) {
    root.replaceChildren();
    if (schema.type !== 'object') {
      const note = createTextElement('div', 'form-no-schema', '服务输入／输出当前不是对象，无法生成字段表单。可使用 JSON 编辑并检查模型。');
      root.append(note);
      return;
    }
    if (!isObject(data)) {
      state.lab.formData = defaultForSchema(schema) || {};
      data = state.lab.formData;
    }
    const editor = createObjectEditor(schema, data, '输入对象', () => renderFormArea());
    root.append(editor);
  }

  function createObjectEditor(schema, value, label, rerender) {
    const wrapper = createTextElement('div', 'form-object');
    const head = createTextElement('div', 'form-object-head');
    head.append(createTextElement('strong', '', label || schema.title || '对象'));
    const fields = Object.keys(schema.properties || {});
    head.append(createTextElement('span', '', `${fields.length} 个字段`));
    wrapper.append(head);
    if (!fields.length) {
      wrapper.append(createTextElement('div', 'array-empty-note', '该对象没有子字段。可在结构树中添加。'));
      return wrapper;
    }
    for (const key of fields) {
      const childSchema = schema.properties[key];
      const required = (schema.required || []).includes(key);
      wrapper.append(createFieldEditor(key, childSchema, value, required, rerender));
    }
    return wrapper;
  }

  function createFieldEditor(key, schema, parentValue, required, rerender) {
    const field = createTextElement('div', 'form-field');
    const present = required || Object.hasOwn(parentValue, key);
    field.classList.toggle('is-included', present);
    const label = createTextElement('div', 'form-field-label');
    if (!required) {
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'include-check';
      toggle.checked = present;
      toggle.setAttribute('aria-label', `包含可选字段 ${key}`);
      toggle.addEventListener('change', () => {
        if (toggle.checked) parentValue[key] = defaultForSchema(schema);
        else delete parentValue[key];
        noteLabInputChanged();
        rerender();
      });
      label.append(toggle);
    }
    const titleWrap = createTextElement('div', 'field-title-wrap');
    titleWrap.append(createTextElement('span', 'field-title', schema.title || key));
    titleWrap.append(createTextElement('span', 'field-key', key));
    titleWrap.append(createTextElement('span', 'field-type', typeLabel(schema)));
    label.append(titleWrap);
    field.append(label);

    const control = createTextElement('div', 'field-control');
    if (!present) {
      control.append(createTextElement('div', 'array-empty-note', '可选字段未包含'));
    } else if (schema.type === 'object') {
      field.classList.add('is-nested-object');
      if (!isObject(parentValue[key])) parentValue[key] = defaultForSchema(schema) || {};
      control.append(createObjectEditor(schema, parentValue[key], schema.title || key, rerender));
    } else if (schema.type === 'array') {
      field.classList.add('is-nested-object');
      if (!Array.isArray(parentValue[key])) parentValue[key] = defaultForSchema(schema) || [];
      control.append(createArrayEditor(key, schema, parentValue[key], rerender));
    } else {
      control.append(createScalarControl(key, schema, parentValue));
    }
    field.append(control);
    return field;
  }

  function createArrayEditor(key, schema, array, rerender) {
    const block = createTextElement('div', 'array-block');
    const head = createTextElement('div', 'array-head');
    const title = createTextElement('strong', '', schema.title || key);
    title.append(createTextElement('span', '', `array · ${array.length}`));
    head.append(title);
    if (schema.maxItems == null || array.length < schema.maxItems) {
      const add = createTextElement('button', 'button button-small button-outline', '＋ 添加元素');
      add.type = 'button';
      add.addEventListener('click', () => {
        if (schema.maxItems != null && array.length >= schema.maxItems) return;
        array.push(defaultForSchema(schema.items));
        noteLabInputChanged();
        rerender();
      });
      head.append(add);
    }
    block.append(head);
    const items = createTextElement('div', 'array-items');
    if (!array.length) items.append(createTextElement('div', 'array-empty-note', '空数组。需要数据时添加元素。'));
    array.forEach((itemValue, index) => {
      const item = createTextElement('div', 'array-item');
      const itemHead = createTextElement('div', 'array-item-head');
      itemHead.append(createTextElement('span', '', `[${index}] · ${typeLabel(schema.items)}`));
      if (schema.minItems == null || array.length > schema.minItems) {
        const remove = createTextElement('button', 'text-button text-button-muted', '移除');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          array.splice(index, 1);
          noteLabInputChanged();
          rerender();
        });
        itemHead.append(remove);
      }
      item.append(itemHead);
      const body = createTextElement('div', 'array-item-body');
      if (schema.items.type === 'object') {
        if (!isObject(itemValue)) array[index] = itemValue = defaultForSchema(schema.items) || {};
        body.append(createObjectEditor(schema.items, itemValue, `元素 ${index + 1}`, rerender));
      } else if (schema.items.type === 'array') {
        const nested = { value: itemValue };
        const nestedEditor = createArrayValueEditor(schema.items, nested, rerender);
        body.append(nestedEditor);
      } else {
        body.append(createScalarControl(`items[${index}]`, schema.items, { value: itemValue }, (next) => { array[index] = next; }));
      }
      item.append(body);
      items.append(item);
    });
    block.append(items);
    return block;
  }

  function createArrayValueEditor(schema, holder, rerender) {
    if (!Array.isArray(holder.value)) holder.value = [];
    const block = createTextElement('div', 'array-block');
    const head = createTextElement('div', 'array-head');
    head.append(createTextElement('strong', '', `嵌套数组 · ${holder.value.length}`));
    const add = createTextElement('button', 'button button-small button-outline', '＋');
    add.type = 'button';
    add.addEventListener('click', () => {
      holder.value.push(defaultForSchema(schema.items));
      noteLabInputChanged();
      rerender();
    });
    head.append(add);
    block.append(head);
    for (let index = 0; index < holder.value.length; index += 1) {
      const wrap = createTextElement('div', 'array-item');
      const itemHead = createTextElement('div', 'array-item-head');
      itemHead.append(createTextElement('span', '', `[${index}]`));
      wrap.append(itemHead);
      const body = createTextElement('div', 'array-item-body');
      body.append(createScalarControl(`nested[${index}]`, schema.items, { value: holder.value[index] }, (next) => { holder.value[index] = next; }));
      wrap.append(body);
      block.append(wrap);
    }
    return block;
  }

  function createScalarControl(label, schema, parent, setter = null) {
    const wrap = createTextElement('div');
    const holderMode = typeof setter === 'function';
    const value = holderMode ? parent.value : parent[label];
    let input;
    if (Array.isArray(schema.enum) && schema.enum.length) {
      input = document.createElement('select');
      for (const optionValue of schema.enum) {
        const option = document.createElement('option');
        option.value = JSON.stringify(optionValue);
        option.textContent = typeof optionValue === 'string' ? optionValue : JSON.stringify(optionValue);
        input.append(option);
      }
      const matching = schema.enum.find((optionValue) => JSON.stringify(optionValue) === JSON.stringify(value));
      input.value = JSON.stringify(matching !== undefined ? matching : schema.enum[0]);
    } else if (schema.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(value);
    } else if (schema.type === 'integer' || schema.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.step = schema.multipleOf != null ? String(schema.multipleOf) : schema.type === 'integer' ? '1' : 'any';
      if (schema.minimum != null) input.min = String(schema.minimum);
      if (schema.maximum != null) input.max = String(schema.maximum);
      input.value = value == null ? '' : String(value);
    } else if (schema.format === 'hex') {
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '偶数位 HEX，例如 00 A1';
      input.value = value == null ? '' : String(value);
    } else if (schema.maxLength != null && schema.maxLength > 120) {
      input = document.createElement('textarea');
      input.rows = 3;
      input.value = value == null ? '' : String(value);
    } else {
      input = document.createElement('input');
      input.type = 'text';
      if (schema.minLength != null) input.minLength = schema.minLength;
      if (schema.maxLength != null) input.maxLength = schema.maxLength;
      input.value = value == null ? '' : String(value);
    }
    input.setAttribute('aria-label', schema.title || label);
    const update = () => {
      let next;
      if (Array.isArray(schema.enum)) {
        try { next = JSON.parse(input.value); } catch { next = input.value; }
      } else if (schema.type === 'boolean') next = input.checked;
      else if (schema.type === 'integer' || schema.type === 'number') next = input.value === '' ? '' : Number(input.value);
      else next = input.value;
      if (holderMode) setter(next);
      else parent[label] = next;
      noteLabInputChanged();
    };
    input.addEventListener(schema.type === 'boolean' || Array.isArray(schema.enum) ? 'change' : 'input', update);
    wrap.append(input);
    const meta = [];
    if (schema.minimum != null || schema.maximum != null) meta.push(`范围 ${schema.minimum ?? '−∞'}…${schema.maximum ?? '∞'}`);
    if (schema.minLength != null || schema.maxLength != null) meta.push(`长度 ${schema.minLength ?? 0}…${schema.maxLength ?? '不限'}`);
    if (meta.length) wrap.append(createTextElement('div', 'field-meta', meta.join(' · ')));
    return wrap;
  }

  function renderResult() {
    const empty = $('resultEmpty');
    const errorBox = $('resultError');
    const busy = $('resultBusy');
    const panel = $('resultPanel');
    const freshness = $('resultFreshness');
    const clearButton = $('clearResultBtn');
    empty.hidden = true;
    errorBox.hidden = true;
    busy.hidden = true;
    panel.hidden = true;
    clearButton.hidden = true;

    let label = '等待输入';
    let stateClass = '';
    if (state.lab.busy) {
      busy.hidden = false;
      label = '转换中';
      stateClass = '';
    } else if (state.lab.error) {
      errorBox.hidden = false;
      $('resultErrorCode').textContent = state.lab.error.code || 'CONVERT_FAILED';
      $('resultErrorMessage').textContent = state.lab.error.message || '转换失败';
      label = '转换失败';
      stateClass = 'is-stale';
      clearButton.hidden = false;
    } else if (state.lab.result) {
      panel.hidden = false;
      renderResultContent(state.lab.result);
      label = '结果有效';
      stateClass = 'is-fresh';
      clearButton.hidden = false;
    } else if (state.compile.status === 'error' && state.compile.error) {
      errorBox.hidden = false;
      $('resultErrorCode').textContent = state.compile.error.code || 'CONFIG_INVALID';
      $('resultErrorMessage').textContent = state.compile.error.message || '当前工作区编译失败';
      label = '编译失败';
      stateClass = 'is-stale';
    } else {
      empty.hidden = false;
      if (state.lab.freshness === 'stale') {
        label = '旧结果已作废';
        stateClass = 'is-stale';
      } else if (state.compile.status === 'compiling') {
        label = '等待编译';
      }
    }
    freshness.textContent = label;
    freshness.classList.toggle('is-fresh', stateClass === 'is-fresh');
    freshness.classList.toggle('is-stale', stateClass === 'is-stale');
  }

  function renderResultContent(result) {
    const encodeMode = state.lab.mode === 'encode';
    $('resultByteCount').textContent = `${result.byte_length ?? '—'} B`;
    $('resultBitCount').textContent = `${(result.byte_length || 0) * 8} bit`;
    $('resultDirection').textContent = state.lab.direction === 'down' ? '下行' : '上行';
    $('resultHex').textContent = result.hex || '';
    $('resultBits').textContent = result.bits || '';
    $('resultModelJson').textContent = pretty(result.thing_model_json ?? result.model_json ?? null);
    $('hexResultLabel').textContent = encodeMode ? '应用层 HEX · 编码结果' : '应用层 HEX · 原始 PDU';
    $('modelResultLabel').textContent = encodeMode ? '转换复核 JSON' : '物模型数据 JSON';
    $('modelResultHint').textContent = result.operation ? `指令：${result.operation}` : '由当前工作区重新编译后解析';

    const metadata = isObject(result.metadata) ? result.metadata : {};
    const entries = Object.entries(metadata);
    $('resultMetadata').innerHTML = entries.length
      ? entries.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(typeof value === 'string' ? value : pretty(value))}</dd>`).join('')
      : '<dt>metadata</dt><dd>无附加元数据</dd>';
    const note = typeof metadata.note === 'string' ? metadata.note : '';
    const autoNote = state.lab.operation === 'auto' && result.operation ? ` 自动识别结果：${result.operation}。` : '';
    $('resultFootnote').textContent = `${note}${autoNote} 仅完成浏览器本地应用层 PDU 转换，不连接或操作蓝牙设备。`.trim();
  }

  function updateHexInputMeta() {
    const input = $('decodeInput');
    const meta = $('hexInputMeta');
    if (!input || !meta) return;
    const text = input.value.trim();
    if (!text) {
      meta.textContent = '包含 SID/CID，允许空白分隔';
      return;
    }
    const compact = text.replace(/\s+/g, '');
    if (!/^[0-9a-fA-F]+$/.test(compact)) {
      meta.textContent = 'HEX 只能包含 0-9、A-F 和空白';
      return;
    }
    if (compact.length % 2 !== 0) {
      meta.textContent = 'HEX 位数必须成对';
      return;
    }
    const bytes = compact.length / 2;
    meta.textContent = `${bytes} 字节${bytes < 2 ? ' · 至少包含 SID/CID' : bytes > 2048 ? ' · 超过 2048B 上限' : ''}`;
  }

  function formatHexInput() {
    const input = $('decodeInput');
    const compact = input.value.replace(/\s+/g, '');
    if (!/^[0-9a-fA-F]+$/.test(compact) || compact.length % 2 !== 0) {
      showToast('HEX 格式不合法：只能包含成对十六进制数字。', 'error');
      updateHexInputMeta();
      return;
    }
    input.value = compact.match(/.{1,2}/g)?.map((part) => part.toUpperCase()).join(' ') || '';
    state.lab.hex = input.value;
    noteLabInputChanged();
    updateHexInputMeta();
  }

  async function runConversion() {
    if (state.compile.status !== 'ready') {
      showToast('请先成功编译当前工作区。', 'warning');
      return;
    }
    if (state.lab.busy) return;
    const operation = state.lab.operation;
    if (!operation) {
      showToast('请选择一条已配置指令。', 'warning');
      return;
    }
    if (state.lab.mode === 'encode' && operation === 'auto') {
      showToast('编码必须明确选择指令，不能使用自动识别。', 'warning');
      return;
    }

    let data;
    if (state.lab.mode === 'encode') {
      if (state.lab.formView === 'json') {
        try {
          data = JSON.parse($('formJson').value);
          if (!isObject(data)) throw new Error('编码数据必须是 JSON 对象');
          state.lab.formData = data;
          state.lab.formJsonText = pretty(data);
          $('formJsonError').hidden = true;
        } catch (error) {
          const message = `待编码 JSON 无效：${error.message}`;
          $('formJsonError').textContent = message;
          $('formJsonError').hidden = false;
          state.lab.error = { code: 'FORM_JSON', message };
          state.lab.freshness = 'stale';
          renderResult();
          return;
        }
      } else {
        data = state.lab.formData;
      }
      if (state.lab.direction === 'up' && !activeOperation()?.can_encode_up) {
        showToast('当前指令没有可编码的上行数据布局。', 'warning');
        return;
      }
    } else {
      const hex = $('decodeInput').value.trim();
      if (!hex) {
        state.lab.error = { code: 'FRAME_HEX', message: '请输入完整应用层 PDU HEX' };
        state.lab.freshness = 'stale';
        renderResult();
        return;
      }
      state.lab.hex = hex;
    }

    const body = {
      workspace: workspaceSnapshot(),
      mode: state.lab.mode,
      direction: state.lab.direction,
      operation
    };
    if (state.lab.mode === 'encode') body.data = data;
    else body.hex = state.lab.hex;

    const capturedWorkspaceRevision = state.revision;
    const capturedLabRevision = state.labRevision;
    const serial = ++state.lab.requestSerial;
    state.lab.busy = true;
    state.lab.result = null;
    state.lab.error = null;
    state.lab.freshness = 'busy';
    renderResult();

    try {
      const result = await postJson(API.convert, body);
      if (serial !== state.lab.requestSerial || capturedWorkspaceRevision !== state.revision || capturedLabRevision !== state.labRevision) return;
      state.lab.result = result;
      state.lab.error = null;
      state.lab.busy = false;
      state.lab.freshness = 'fresh';
      if (state.lab.mode === 'decode') {
        state.lab.hex = result.hex || state.lab.hex;
        $('decodeInput').value = state.lab.hex;
        updateHexInputMeta();
      }
      setServerState('online');
      renderResult();
    } catch (error) {
      if (serial !== state.lab.requestSerial || capturedWorkspaceRevision !== state.revision || capturedLabRevision !== state.labRevision) return;
      state.lab.busy = false;
      state.lab.result = null;
      state.lab.error = { code: error.code || 'CONVERT_FAILED', message: error.message || '转换失败' };
      state.lab.freshness = 'stale';
      setServerState(error instanceof ApiError && error.status === 0 ? 'offline' : 'online');
      renderResult();
    }
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (copied) showToast(successMessage);
      else showToast('复制失败，请手动选择文本。', 'error');
    }
  }

  function openImportDialog() {
    if (state.server !== 'online' && state.bootstrap.examples.length === 0) {
      setGlobalNotice('浏览器引擎尚未就绪，请等待加载完成。');
    }
    $('importError').hidden = true;
    $('importError').textContent = '';
    renderExamples();
    renderDraftStatus();
    const dialog = $('importDialog');
    if (!dialog.open) dialog.showModal();
  }

  function closeImportDialog() {
    const dialog = $('importDialog');
    if (dialog.open) dialog.close();
  }

  function loadExampleById(id) {
    if (state.importBusy) {
      showToast('请等待当前导入完成。', 'warning');
      return;
    }
    const example = state.bootstrap.examples.find((item) => item.id === id);
    if (!example || !isObject(example.workspace)) {
      showToast('找不到这条预置实验。', 'error');
      return;
    }
    const presetHint = example.id === 'simple'
      ? '合成预置：下行编码 level=5 应得到 80 01 06 01 05（不是真实设备报文）。'
      : example.id === 'synthetic'
        ? '合成实验：SID22/CID31，用于验证对象数组、倍率、UTF-8 与简单数组。'
        : '';
    applyWorkspace(example.workspace, example.label || example.id, { presetHint });
    closeImportDialog();
    activateTab('lab');
    showToast(`已载入${example.label || example.id}，正在编译。`);
  }

  async function handleUpload(input) {
    const file = input.files?.[0];
    if (!file) return;
    const kind = input.dataset.uploadKind;
    const kindLabels = {
      workspace: '完整工作区',
      dictionary: '机器字典',
      model: '物模型',
      commands: 'commands.csv',
      bindings: 'bindings.csv',
      groups: 'groups.csv'
    };
    if (state.importBusy) {
      showToast('另一个导入正在处理中。', 'warning');
      return;
    }
    state.importBusy = true;
    const errorBox = $('importError');
    errorBox.hidden = true;
    $('importBusy').hidden = false;
    $('importBusyText').textContent = `正在校验 ${file.name}…`;
    document.querySelectorAll('[data-upload-kind]').forEach((element) => { element.disabled = true; });

    try {
      const text = await file.text();
      const body = { kind, text };
      if (!['workspace', 'dictionary'].includes(kind)) body.workspace = workspaceSnapshot();
      const result = await postJson(API.import, body);
      applyWorkspace(result.workspace, `导入 · ${kindLabels[kind] || file.name}`);
      setServerState('online');
      closeImportDialog();
      activateTab('config');
      showToast(`${kindLabels[kind] || file.name} 导入成功。`);
    } catch (error) {
      const message = `${error.code || 'IMPORT_FAILED'} · ${error.message || '导入失败'}；当前工作区未改变。`;
      errorBox.textContent = message;
      errorBox.hidden = false;
      showToast(message, 'error');
      setServerState(error instanceof ApiError && error.status === 0 ? 'offline' : 'online');
    } finally {
      state.importBusy = false;
      $('importBusy').hidden = true;
      document.querySelectorAll('[data-upload-kind]').forEach((element) => { element.disabled = false; });
      input.value = '';
    }
  }

  function readStoredDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!isObject(parsed) || !isObject(parsed.workspace) || parsed.workspace.format !== WORKSPACE_FORMAT) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function renderDraftStatus() {
    const draft = state.draft || readStoredDraft();
    state.draft = draft;
    const title = $('draftTitle');
    const meta = $('draftMeta');
    const restore = $('restoreDraftBtn');
    const remove = $('deleteDraftBtn');
    if (!draft) {
      title.textContent = '尚未保存草稿';
      meta.textContent = '点击页头“保存草稿”后才会写入当前浏览器。';
      restore.disabled = true;
      remove.disabled = true;
      return;
    }
    const commands = Array.isArray(draft.workspace.commands) ? draft.workspace.commands.length : 0;
    title.textContent = `本地草稿 · ${commands} 条指令`;
    meta.textContent = `保存于 ${dateTimeLabel(draft.savedAt)}，只存在于当前浏览器；不会自动覆盖当前工作区。`;
    restore.disabled = false;
    remove.disabled = false;
  }

  function saveDraft() {
    const workspace = workspaceSnapshot();
    const savedAt = new Date().toISOString();
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, savedAt, workspace }));
      state.draft = { version: 1, savedAt, workspace };
      renderDraftStatus();
      showToast(state.modelJsonDirty
        ? '工作区草稿已保存到本浏览器；模型 JSON 中未应用的内容未保存。'
        : '工作区草稿已保存到本浏览器。');
    } catch (error) {
      showToast(`草稿保存失败：${error.message}；当前工作区未改变。`, 'error');
    }
  }

  function restoreDraft() {
    const draft = state.draft || readStoredDraft();
    if (!draft) {
      showToast('没有可恢复的本地草稿。', 'warning');
      return;
    }
    applyWorkspace(draft.workspace, '本地草稿');
    closeImportDialog();
    activateTab('config');
    showToast(`已恢复 ${dateTimeLabel(draft.savedAt)} 的本地草稿。`);
  }

  function deleteDraft() {
    if (!window.confirm('删除当前浏览器中的本地草稿？当前工作区不会被删除。')) return;
    try {
      localStorage.removeItem(DRAFT_KEY);
      state.draft = null;
      renderDraftStatus();
      showToast('本地草稿已删除。');
    } catch (error) {
      showToast(`删除失败：${error.message}`, 'error');
    }
  }

  function setDirection(direction) {
    if (!['down', 'up'].includes(direction) || direction === state.lab.direction) return;
    state.lab.direction = direction;
    state.labRevision += 1;
    state.lab.requestSerial += 1;
    state.lab.result = null;
    state.lab.error = null;
    state.lab.busy = false;
    state.lab.freshness = 'stale';
    reconcileLabSelection();
    reconcileLabForm(true);
    renderLab();
  }

  function setMode(mode) {
    if (!['encode', 'decode'].includes(mode) || mode === state.lab.mode) return;
    const previousOperation = state.lab.operation;
    state.lab.mode = mode;
    state.labRevision += 1;
    state.lab.requestSerial += 1;
    state.lab.result = null;
    state.lab.error = null;
    state.lab.busy = false;
    state.lab.freshness = 'stale';
    reconcileLabSelection();
    if (mode === 'decode' && !previousOperation) state.lab.operation = 'auto';
    reconcileLabForm(previousOperation !== state.lab.operation);
    renderLab();
  }

  function setOperation(operation) {
    if (operation === state.lab.operation) return;
    state.lab.operation = operation;
    state.labRevision += 1;
    state.lab.requestSerial += 1;
    state.lab.result = null;
    state.lab.error = null;
    state.lab.busy = false;
    state.lab.freshness = 'stale';
    reconcileLabForm(true);
    renderLab();
  }

  function setFormView(view) {
    if (!['form', 'json'].includes(view) || view === state.lab.formView) return;
    if (view === 'json') {
      state.lab.formJsonText = pretty(state.lab.formData);
      state.lab.formView = 'json';
      $('formJsonError').hidden = true;
      renderFormArea();
      window.setTimeout(() => $('formJson').focus(), 0);
      return;
    }
    try {
      const parsed = JSON.parse($('formJson').value);
      if (!isObject(parsed)) throw new Error('编码数据必须是 JSON 对象');
      const before = JSON.stringify(state.lab.formData);
      state.lab.formData = parsed;
      state.lab.formJsonText = pretty(parsed);
      state.lab.formView = 'form';
      $('formJsonError').hidden = true;
      renderFormArea();
      if (JSON.stringify(parsed) !== before) noteLabInputChanged();
    } catch (error) {
      $('formJsonError').textContent = `JSON 无法回到表单：${error.message}`;
      $('formJsonError').hidden = false;
    }
  }

  function resetGeneratedForm() {
    const schema = activeSchema();
    if (!schema) return;
    state.lab.formData = defaultForSchema(schema) || {};
    state.lab.formJsonText = pretty(state.lab.formData);
    state.lab.schemaSignature = schemaSignature(schema);
    noteLabInputChanged();
    renderFormArea();
  }

  function applyFormJson() {
    try {
      const parsed = JSON.parse($('formJson').value);
      if (!isObject(parsed)) throw new Error('编码数据必须是 JSON 对象');
      state.lab.formData = parsed;
      state.lab.formJsonText = pretty(parsed);
      state.lab.formView = 'form';
      $('formJsonError').hidden = true;
      noteLabInputChanged();
      renderFormArea();
    } catch (error) {
      $('formJsonError').textContent = `JSON 无效：${error.message}`;
      $('formJsonError').hidden = false;
    }
  }

  function bindDialogBackdrop(dialog) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) dialog.close();
    });
  }

  function bindEvents() {
    $('configTabBtn').addEventListener('click', () => activateTab('config'));
    $('labTabBtn').addEventListener('click', () => activateTab('lab'));
    $('compileBtn').addEventListener('click', () => compileWorkspace(true));
    $('exportWorkspaceBtn').addEventListener('click', exportWorkspace);
    $('exportPairBtn').addEventListener('click', exportPair);
    $('closeExportPairBtn').addEventListener('click', () => $('exportPairDialog').close());
    $('doneExportPairBtn').addEventListener('click', () => $('exportPairDialog').close());
    $('importPairBtn').addEventListener('click', importPair);
    for (const id of ['pairModel', 'pairMapping']) $(id).addEventListener('change', () => { $(id + 'Name').textContent = $(id).files?.[0]?.name || '请选择JSON文件'; });
    $('exportDictionaryBtn').addEventListener('click', exportDictionary);
    $('saveDraftBtn').addEventListener('click', saveDraft);
    $('openImportBtn').addEventListener('click', openImportDialog);
    $('onboardingImportBtn').addEventListener('click', openImportDialog);
    $('onboardingExampleBtn').addEventListener('click', openImportDialog);
    $('closeImportBtn').addEventListener('click', closeImportDialog);
    $('doneImportBtn').addEventListener('click', closeImportDialog);
    $('workspaceErrorDismiss').addEventListener('click', () => showWorkspaceError(null));
    $('restoreDraftBtn').addEventListener('click', restoreDraft);
    $('deleteDraftBtn').addEventListener('click', deleteDraft);

    document.querySelectorAll('[data-upload-kind]').forEach((input) => {
      input.addEventListener('change', () => handleUpload(input));
    });

    for (const container of [$('quickExamples'), $('exampleGrid')]) {
      container.addEventListener('click', (event) => {
        const button = event.target.closest('[data-example-id]');
        if (button) loadExampleById(button.dataset.exampleId);
      });
    }

    for (const button of document.querySelectorAll('[data-table-tab]')) {
      button.addEventListener('click', () => {
        state.activeTable = button.dataset.tableTab;
        renderTable();
      });
    }
    $('addTableRowBtn').addEventListener('click', addTableRow);
    $('emptyAddRowBtn').addEventListener('click', addTableRow);
    $('workspaceTableBody').addEventListener('input', handleTableInput);
    $('workspaceTableBody').addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-row]');
      if (button) removeTableRow(Number(button.dataset.deleteRow));
    });

    $('addPropertyBtn').addEventListener('click', () => openCreateRoot('properties'));
    $('addMethodBtn').addEventListener('click', openCreateMethod);
    $('addEventBtn').addEventListener('click', () => openCreateRoot('events'));
    $('modelTree').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const id = button.dataset.nodeId;
      if (action === 'add-child') openAddChild(id);
      else if (action === 'edit-node') openEditNode(id);
      else if (action === 'delete-node') deleteNodeById(id);
      else if (action === 'edit-method') openEditMethod(id);
      else if (action === 'delete-method') deleteNodeById(id);
    });
    $('modelJson').addEventListener('input', () => {
      state.modelJsonDirty = true;
      setModelJsonMessage('模型 JSON 有未应用修改。');
    });
    $('applyModelJsonBtn').addEventListener('click', applyModelJson);
    $('formatModelJsonBtn').addEventListener('click', formatModelJson);
    $('discardModelJsonBtn').addEventListener('click', () => {
      state.modelJsonDirty = false;
      syncModelJsonText();
      showToast('已还原为当前工作区中的模型。');
    });

    $('nodeType').addEventListener('change', updateNodeDialogVisibility);
    $('nodeForm').addEventListener('submit', saveNodeDialog);
    $('cancelNodeBtn').addEventListener('click', () => $('nodeDialog').close());
    $('closeNodeBtn').addEventListener('click', () => $('nodeDialog').close());

    document.querySelectorAll('[data-direction]').forEach((button) => {
      button.addEventListener('click', () => setDirection(button.dataset.direction));
    });
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => setMode(button.dataset.mode));
    });
    $('operationSelect').addEventListener('change', (event) => setOperation(event.target.value));
    document.querySelectorAll('[data-form-view]').forEach((button) => {
      button.addEventListener('click', () => setFormView(button.dataset.formView));
    });
    $('resetFormBtn').addEventListener('click', resetGeneratedForm);
    $('formJson').addEventListener('input', () => {
      state.lab.formJsonText = $('formJson').value;
      noteLabInputChanged();
    });
    $('applyFormJsonBtn').addEventListener('click', applyFormJson);
    $('decodeInput').addEventListener('input', () => {
      state.lab.hex = $('decodeInput').value;
      updateHexInputMeta();
      noteLabInputChanged();
    });
    $('formatHexBtn').addEventListener('click', formatHexInput);
    $('clearHexBtn').addEventListener('click', () => {
      $('decodeInput').value = '';
      state.lab.hex = '';
      updateHexInputMeta();
      noteLabInputChanged();
    });
    $('encodeBtn').addEventListener('click', runConversion);
    $('decodeBtn').addEventListener('click', runConversion);
    $('copyHexBtn').addEventListener('click', () => {
      if (state.lab.result?.hex) copyText(state.lab.result.hex, 'HEX 已复制。');
    });
    $('copyModelBtn').addEventListener('click', () => {
      if (state.lab.result) copyText(pretty(state.lab.result.thing_model_json ?? state.lab.result.model_json ?? null), '模型 JSON 已复制。');
    });
    $('clearResultBtn').addEventListener('click', () => clearLabResult('idle'));

    bindDialogBackdrop($('importDialog'));
    bindDialogBackdrop($('nodeDialog'));
  }

  function init() {
    state.draft = readStoredDraft();
    configUI = window.BleConfigUI.create({state, $, showToast, guardJsonDraft, markWorkspaceEdited, renderModelEditor, renderTable, nodeById, openCreateRoot, openCreateMethod, openEditNode, openEditMethod, openAddChild, deleteNodeById, bindDialogBackdrop, typeLabel, schemaConstraintText});
    bindEvents();
    renderAll();
    loadBootstrap();
  }

  init();
})();
