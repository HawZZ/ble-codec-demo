/* Maintenance views over the existing workspace; no additional exchange format. */
(() => {
  'use strict';
  const copy = value => structuredClone(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const prefix = (path, base) => path === base || path.startsWith(base + '.') || path.startsWith(base + '[]');
  const replacePath = (path, oldPath, newPath) => prefix(path, oldPath) ? newPath + path.slice(oldPath.length) : path;
  const parseTarget = row => {
    const parts = (row.method || '').split(':');
    return parts.length === 1 ? {kind:'service', identifier:parts[0]} : {kind:parts[0], identifier:parts[1], behavior:parts[2]};
  };
  const labels = {properties:'属性', events:'事件', methods:'服务（方法）'};
  const interactionLabels = {request_response:'请求与响应', query_and_report:'请求响应及主动上报', one_way:'仅下发，无应用响应', receive_only:'仅接收上行'};
  const width = {u8:1,i8:1,bool:1,u16:2,i16:2,u32:4,i32:4,f32:4,f64:8};
  function nodeScope(node) {
    const path = node.referencePath || node.pathLabel || '';
    const match = /^(properties|events|methods)\.([A-Za-z_][A-Za-z0-9_]*)(.*)$/.exec(path);
    if (!match) return null;
    const [,category,identifier,tail] = match;
    const serviceTail = category === 'methods' ? /^\.(input|output)(.*)$/.exec(tail) : null;
    const role = serviceTail?.[1];
    const remainder = serviceTail ? serviceTail[2] : tail;
    return {category,identifier,role,relative:category === 'properties' ? identifier + tail : remainder.replace(/^\./,''), root:node.kind === 'method' || (!node.parentSchema && !node.virtualRoot && !node.arrayItemRoot && !tail)};
  }

  function matchesScope(row, scope) {
    const t = parseTarget(row);
    return t.kind === ({properties:'property',methods:'service',events:'event'}[scope.category]) && t.identifier === scope.identifier;
  }
  function references(workspace, node) {
    const s = nodeScope(node); if (!s) return [];
    const refs = [];
    for (const c of workspace.commands) {
      if (matchesScope(c,s)) {
        if (s.root) refs.push(`${c.sid}/${c.cid}：功能引用`);
        else for (const b of workspace.bindings) if (b.operation === c.operation && (!s.role || b.role === (s.role === 'input' ? 'request':'incoming')) && prefix(b.model_path,s.relative)) refs.push(`${c.sid}/${c.cid}：${b.role === 'request' ? '下行':'上行'}字段 ${b.model_path}`);
        if (s.role !== 'input') for (const u of workspace.command_metadata?.[c.operation]?.propertyUpdates || []) if (s.relative && (prefix(u.from,s.relative) || prefix(s.relative,u.from))) refs.push(`${c.sid}/${c.cid}：上行属性更新 ${u.from}`);
      }
      if (s.category === 'properties') for (const u of workspace.command_metadata?.[c.operation]?.propertyUpdates || []) if (u.to === s.identifier) refs.push(`${c.sid}/${c.cid}：更新属性 ${u.to}`);
    }
    return [...new Set(refs)];
  }
  function renameReferences(workspace, node, name) {
    if (!node.oldKey || node.oldKey === name || node.intent !== 'edit') return;
    const s = nodeScope(node); if (!s) return;
    const next = s.root ? (s.category === 'properties' ? name : '') : s.relative.replace(/[A-Za-z_][A-Za-z0-9_]*$/,name);
    const oldParent = s.relative.replace(/(?:\.)?[A-Za-z_][A-Za-z0-9_]*$/,'');
    for (const c of workspace.commands) {
      if (matchesScope(c,s)) {
        if (!(s.root && s.category !== 'properties')) {
          for (const g of workspace.groups) {
            if (g.operation !== c.operation || (s.role && g.role !== (s.role === 'input' ? 'request':'incoming'))) continue;
            const container = workspace.bindings.find(b => b.operation === g.operation && b.role === g.role && b.tlv_path === g.container_path);
            if (container?.model_path === oldParent) g.fields = g.fields.split('|').map(f => f === node.oldKey ? name:f).join('|');
          }
          for (const b of workspace.bindings) if (b.operation === c.operation && (!s.role || b.role === (s.role === 'input' ? 'request':'incoming'))) b.model_path = replacePath(b.model_path,s.relative,next);
          if (s.role !== 'input') for (const u of workspace.command_metadata?.[c.operation]?.propertyUpdates || []) u.from = replacePath(u.from,s.relative,next);
        }
        if (s.root) {
          const t = parseTarget(c);t.identifier = name;
          c.method = t.kind === 'service' && !c.method.includes(':') ? name : [t.kind,name,t.behavior].filter(Boolean).join(':');
          if (workspace.targets?.[c.operation]) workspace.targets[c.operation].identifier = name;
        }
      }
      if (s.category === 'properties' && s.root) for (const u of workspace.command_metadata?.[c.operation]?.propertyUpdates || []) if (u.to === s.identifier) u.to = name;
    }
  }
  // Only explicit whole-structure projections link model shapes. Matching names do not.
  function linkedRenamePaths(workspace, node) {
    const first=node.referencePath || node.pathLabel;
    const paths=new Set([first]);
    let changed=true;
    while(changed) {
      changed=false;
      for(const c of workspace.commands) {
        const t=parseTarget(c);
        for(const u of workspace.command_metadata?.[c.operation]?.propertyUpdates || []) {
          const source=t.kind==='service'?`methods.${t.identifier}.output.${u.from}`:t.kind==='event'?`events.${t.identifier}.${u.from}`:`properties.${u.from}`;
          const destination=`properties.${u.to}`;
          for(const path of [...paths])for(const [from,to]of[[source,destination],[destination,source]])if(path!==from&&prefix(path,from)) {
            const linked=to+path.slice(from.length);
            if(!paths.has(linked)){if(paths.size>=2048)throw Error('属性更新关系过多或形成循环，请先检查关联配置');paths.add(linked);changed=true;}
          }
        }
      }
    }
    return [...paths];
  }
  function modelSlot(workspace,path) {
    const tokens=path.replace(/\[\]/g,'.[]').split('.');
    const category=tokens.shift(),root=tokens.shift();
    let schema=workspace.model[category]?.[root];
    if(!tokens.length)return {holder:workspace.model[category],key:root,parent:null,category};
    if(category==='methods')schema=schema?.[tokens.shift()];
    while(tokens.length>1){const token=tokens.shift();schema=token==='[]'?schema?.items:schema?.properties?.[token];}
    return {holder:schema?.properties,key:tokens[0],parent:schema,category};
  }
  function create(bridge) {
    const {state, $, showToast, guardJsonDraft} = bridge;
    let view = 'table', category = 'properties', operation = '', role = 'request', editing = null;
    const touch = () => {bridge.markWorkspaceEdited();bridge.renderModelEditor();bridge.renderTable();};
    const options = (items, current, placeholder) => (placeholder ? `<option value="">${esc(placeholder)}</option>`:'') + items.map(([value,label]) => `<option value="${esc(value)}"${value === current ? ' selected':''}>${esc(label)}</option>`).join('');
    const field = (label, control) => `<label class="form-control"><span>${label}</span>${control}</label>`;
    const input = (id,value='',extra='') => `<input class="input" id="${id}" value="${esc(value)}" ${extra}>`;
    const select = (id,items,current,placeholder) => `<select class="select" id="${id}">${options(items,current,placeholder)}</select>`;
    const targetName = c => {const t=parseTarget(c);const schema=t.kind==='service'?state.workspace.model.methods[t.identifier]:state.workspace.model[t.kind==='event'?'events':'properties'][t.identifier];return `${schema?.title || schema?.name || t.identifier}${t.behavior ? ' · '+({read:'读取',write:'设置',report:'上报'}[t.behavior] || t.behavior):''}`;};
    const commandName = c => `${c.sid}/${c.cid} · ${targetName(c)}`;
    function schemaSummary(schema) {
      if (!schema) return '未定义';
      if (schema.type === 'object') {const keys=Object.keys(schema.properties || {});return keys.length ? `${keys.length} 个字段：${keys.slice(0,3).join('、')}${keys.length>3?'…':''}`:'无参数';}
      if (schema.type === 'array') return `${schema.items?.type==='object'?'对象':schema.items?.platformType||schema.items?.type||'未定义'}数组${schema.items?.properties?' · 每项 '+Object.keys(schema.items.properties).length+' 个字段':''}${schema.maxItems!=null?' · 最多 '+schema.maxItems+' 项':''}`;
      const parts=[];
      if(schema.enum)parts.push('枚举：'+schema.enum.slice(0,6).map(v=>typeof v==='string'?v:JSON.stringify(v)).join('、')+(schema.enum.length>6?'…':''));
      else if(schema.minimum!=null||schema.maximum!=null)parts.push('范围：'+(schema.minimum??'不限')+'～'+(schema.maximum??'不限'));
      if(schema.multipleOf!=null)parts.push('步长：'+schema.multipleOf);
      if(schema.minLength!=null||schema.maxLength!=null)parts.push((schema.format==='hex'?'HEX字符数：':'字符数：')+(schema.minLength??0)+'～'+(schema.maxLength??'不限'));
      return parts.join('；') || '未设置额外约束';
    }
    function bindCount(bucket,key) {
      const node={pathLabel:`${bucket}.${key}`,kind:bucket==='methods'?'method':'schema'};
      const refs=references(state.workspace,node);
      const commands=state.workspace.commands.filter(c=>matchesScope(c,nodeScope(node)) || (bucket==='properties' && (state.workspace.command_metadata?.[c.operation]?.propertyUpdates || []).some(u=>u.to===key)));
      return {count:commands.length,op:commands[0]?.operation,refs};
    }
    function renderModel() {
      for (const b of document.querySelectorAll('[data-model-view]')) {const active=b.dataset.modelView===view;b.classList.toggle('is-active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
      for(const id of ['addPropertyBtn','addMethodBtn','addEventBtn'])$(id).hidden=view==='table';
      $('modelTablePanel').hidden=view!=='table';$('modelTreePanel').hidden=view!=='tree';$('modelJsonPanel').hidden=view!=='json';
      for (const b of document.querySelectorAll('[data-model-category]')) {const active=b.dataset.modelCategory===category;b.classList.toggle('is-active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
      const categories={properties:'propertyTableCount',events:'eventTableCount',methods:'serviceTableCount'};
      for (const [key,id] of Object.entries(categories)) $(id).textContent=Object.keys(state.workspace.model[key]).length;
      $('modelFeatureContent').setAttribute('aria-labelledby',{properties:'modelCategoryProperties',events:'modelCategoryEvents',methods:'modelCategoryMethods'}[category]);
      $('modelCategoryDescription').textContent={properties:'维护业务属性及读写权限；BLE地址在下方映射中配置。',events:'维护设备上行事件及其参数。',methods:'维护业务方法的输入和输出；不要求每个属性建立一个方法。'}[category];
      $('addFeatureBtn').textContent='新增'+labels[category];
      const columns=category==='properties'?['名称','标识符','数据类型','数据定义','读写权限','BLE绑定','操作']:category==='events'?['名称','标识符','输出参数','BLE绑定','操作']:['名称','标识符','输入参数','输出参数','BLE绑定','操作'];
      $('modelFeatureHead').innerHTML='<tr>'+columns.map(c=>`<th>${c}</th>`).join('')+'</tr>';
      const entries=Object.entries(state.workspace.model[category]);$('modelFeatureEmpty').hidden=entries.length>0;
      $('modelFeatureBody').innerHTML=entries.map(([key,schema])=>{
        const n=state.modelNodes.find(n=>n.pathLabel===`${category}.${key}`), binding=bindCount(category,key);
        const action=(text,kind)=>`<button class="tree-action" type="button" data-feature-action="${kind}" data-node-id="${n?.id}">${text}</button>`;
        const summary=(schema,virtual)=>`<button type="button" class="definition-link" data-feature-action="${virtual?'parameters':'definition'}" data-node-id="${n?.id}" ${virtual?`data-parameter-role="${virtual}"`:''}>${esc(schemaSummary(schema))}</button>`;
        let cells=[esc(schema.title||schema.name||key),`<code>${esc(key)}</code>`];
        if(category==='properties')cells.push(esc(bridge.typeLabel(schema)),summary(schema),esc({r:'只读',w:'只写',rw:'读写'}[schema.access]||'未配置'));
        else if(category==='events')cells.push(summary(schema));
        else cells.push(summary(schema.input,'input'),summary(schema.output,'output'));
        cells.push(binding.count?`<button type="button" class="definition-link" data-binding-jump="${esc(binding.op)}">${binding.count} 条指令</button>`:'<span class="muted">未绑定</span>');
        cells.push(action('编辑','edit')+action('删除','delete'));
        return `<tr data-feature-key="${esc(key)}">${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`;
      }).join('');
    }
    function currentCommand() {
      if (!state.workspace.commands.some(c=>c.operation===operation)) operation=state.workspace.commands[0]?.operation||'';
      return state.workspace.commands.find(c=>c.operation===operation);
    }
    function renderMappings() {
      const c=currentCommand(),table=state.activeTable;
      for(const b of document.querySelectorAll('[data-table-tab]')) {const active=b.dataset.tableTab===table;b.classList.toggle('is-active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
      $('commandsCount').textContent=state.workspace.commands.length;$('bindingsCount').textContent=state.workspace.bindings.length;$('groupsCount').textContent=state.workspace.groups.length;
      $('mappingContext').hidden=table==='commands';
      $('mappingOperation').innerHTML=options(state.workspace.commands.map(c=>[c.operation,commandName(c)]),operation,!c?'请先新增指令':null);
      for(const b of document.querySelectorAll('[data-binding-role]')){const active=b.dataset.bindingRole===role;b.classList.toggle('is-active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
      const headings={commands:['物模型功能','SID','CID','交互方式','操作'],bindings:['业务字段','TLV地址','线上类型','是否必带','操作'],groups:['容器地址','组合规则','字段','操作']};
      $('tableTitle').textContent={commands:'指令',bindings:'字段绑定',groups:'组合约束'}[table];
      $('tableDescription').textContent={commands:'内部ID由系统生成。选择功能后，配置协议已定义的地址和交互。',bindings:'字段从物模型选择；容器、换算和特殊长度在编辑详情中配置。',groups:'高级规则保留原有校验语义，不由字段名称推断。'}[table];
      $('tableHint').textContent=table==='commands'?'来源与通信限制放在详情；停用操作不会删除原定义。':table==='bindings'?'TLV长度由引擎计算。线上类型必须按设备协议选择，不能只凭物模型的整数类型推断。':'只支持已有的“至少一个”和“全有或全无”规则。';
      $('addTableRowBtn').textContent=table==='commands'?'＋ 新增指令':table==='bindings'?'＋ 新增字段':'＋ 新增约束';
      $('addTableRowBtn').disabled=table!=='commands'&&!c;
      const indexed=state.workspace[table].map((row,index)=>({row,index})).filter(({row})=>table==='commands'||(row.operation===operation&&row.role===role));
      $('tableCount').textContent=`${indexed.length} 行`;$('tableEmpty').hidden=indexed.length>0;$('tableScroll').hidden=indexed.length===0;
      $('workspaceTableCols').innerHTML='';$('workspaceTableHead').innerHTML='<tr>'+headings[table].map(x=>`<th>${x}</th>`).join('')+'</tr>';
      $('workspaceTableBody').innerHTML=indexed.map(({row,index})=>{
        let cells;
        if(table==='commands') cells=[`${esc(targetName(row))}${row.availability==='suspended'?'<span class="status-label">已停用</span>':''}<small class="cell-detail">${esc(row.method)}</small>`,`<code>${esc(row.sid)}</code>`,`<code>${esc(row.cid)}</code>`,`${esc(interactionLabels[row.interaction]||row.interaction)}<small class="cell-detail">${esc(row.receive_variants.split('|').filter(Boolean).map(v=>({incoming:'业务数据',result:'结果码',empty:'空回包'}[v]||v)).join('、')||'无应用回包')}</small>`];
        else if(table==='bindings')cells=[`<code>${esc(row.model_path)||'当前对象（容器）'}</code>`,`<code>${esc(row.tlv_path)}</code>`,`${esc(row.wire_type)}${width[row.wire_type]?`<small class="cell-detail">${width[row.wire_type]} B</small>`:''}`,row.required==='M'?'必带':'可选'];
        else cells=[esc(row.container_path),row.rule==='at_least_one'?'至少一个':'全有或全无',esc(row.fields.split('|').join('、'))];
        let actions=`<button class="tree-action" type="button" data-mapping-edit="${index}">编辑</button>`;
        if(table==='commands')actions+=`<button class="tree-action" type="button" data-mapping-bind="${esc(row.operation)}">字段</button><button class="tree-action" type="button" data-mapping-toggle="${index}">${row.availability==='suspended'?'启用':'停用'}</button>`;
        actions+=`<button class="tree-action danger" type="button" data-mapping-delete="${index}">删除</button>`;
        return `<tr>${cells.map(x=>`<td>${x}</td>`).join('')}<td class="mapping-actions">${actions}</td></tr>`;
      }).join('');
    }
    function rootsFor(row, direction) {
      if(!row)return null;
      const t=parseTarget(row),m=state.workspace.model;
      if(t.kind==='service')return m.methods[t.identifier]?.[direction==='request'?'input':'output'];
      if(t.kind==='event')return direction==='incoming'?m.events[t.identifier]:null;
      return {type:'object',properties:{[t.identifier]:m.properties[t.identifier]}};
    }
    function schemaPaths(schema,base='',out=[]) {
      if(!schema)return out;
      out.push([base,base||'当前对象（外层容器）']);
      if(schema.type==='object')for(const [key,child]of Object.entries(schema.properties||{}))schemaPaths(child,base?base+'.'+key:key,out);
      if(schema.type==='array')schemaPaths(schema.items,base+'[]',out);
      return out;
    }
    function showDialog(table,index=null) {
      if(!guardJsonDraft())return;
      editing={table,index};const old=index===null?null:state.workspace[table][index];
      $('mappingFormError').hidden=true;$('mappingDialogTitle').textContent=(old?'编辑':'新增')+({commands:'指令',bindings:'字段绑定',groups:'组合约束'}[table]);
      $('mappingDialogSubtitle').textContent=table==='commands'?'明确配置真实协议中的交互，内部ID自动维护。':commandName(currentCommand());
      let html='';
      if(table==='commands') {
        const t=old?parseTarget(old):{},refs=[];
        for(const bucket of ['properties','events','methods'])for(const [key,schema]of Object.entries(state.workspace.model[bucket]))refs.push([({properties:'property',events:'event',methods:'service'}[bucket])+':'+key,`${labels[bucket]} · ${schema.title||schema.name||key} (${key})`]);
        html='<div class="form-grid">'+field('物模型功能',select('mapTarget',refs,t.kind?`${t.kind}:${t.identifier}`:'','请选择功能'))+field('属性行为',select('mapBehavior',[['read','读取'],['write','设置'],['report','上报']],t.behavior||'read'))+field('SID',input('mapSid',old?.sid||'', 'placeholder="例如 0x11"'))+field('CID',input('mapCid',old?.cid||'','placeholder="例如 0x02"'))+field('交互方式',select('mapInteraction',Object.entries(interactionLabels),old?.interaction||'request_response'))+'</div>';
        html+='<fieldset class="reply-choices"><legend>应用层回包形式（可多选）</legend>'+['incoming','result','empty'].map(v=>`<label><input type="checkbox" data-reply="${v}" ${old?.receive_variants.split('|').includes(v)?'checked':''}>${{incoming:'业务数据',result:'结果码',empty:'空回包'}[v]}</label>`).join('')+'</fieldset>';
        const meta=state.workspace.command_metadata?.[old?.operation]||{};
        html+='<details class="editor-advanced"><summary>高级配置与说明</summary>'+field('成功结果码（仅在协议明确时填写）',input('mapSuccess',meta.resultSuccessCode??'','inputmode="numeric"'))+'<h3>上行数据更新属性</h3><p>明确选择数据来源和目标属性；不会按同名自动建立更新关系。</p><div id="projectionRows"></div><button class="button button-small button-outline" type="button" id="addProjectionBtn">新增更新关系</button>'+field('来源',`<textarea class="input textarea-small" id="mapSource">${esc(old?.source||'')}</textarea>`)+field('备注（每行一条）',`<textarea class="input textarea-small" id="mapNotes">${esc((meta.notes||[]).join('\n'))}</textarea>`)+`<p class="readonly-note">关联方式：${esc(old?.correlation||'由当前交互生成')}；本引擎不保证精确匹配某次请求。${old?.timeout_ms?' 已有超时 '+esc(old.timeout_ms)+' ms（保留，Demo不执行计时）。':''}</p></details>`;
        $('mappingFields').innerHTML=html;
        const refresh=()=>{const property=$('mapTarget').value.startsWith('property:');$('mapBehavior').closest('label').hidden=!property;};
        $('mapTarget').addEventListener('change',refresh);refresh();
        for(const u of meta.propertyUpdates||[])addProjection(u);
        $('addProjectionBtn').onclick=()=>addProjection({from:'',to:''});
      } else if(table==='bindings') {
        const cmd=currentCommand();const paths=schemaPaths(rootsFor(cmd,role));
        const types=state.wireTypes.map(t=>[t,t]);
        html='<div class="form-grid">'+field('业务字段',select('mapField',paths,old?.model_path??(paths[1]?.[0]||'')))+field('TLV地址',input('mapTlv',old?.tlv_path||'','placeholder="例如 01 或 01/02"'))+field('线上类型',select('mapWire',types,old?.wire_type||'u8'))+field('是否必带',select('mapRequired',[['M','必带'],['O','可选']],old?.required||'M'))+'</div><p class="readonly-note" id="mapWidth"></p>';
        html+='<details class="editor-advanced"><summary>换算、长度与特殊结构</summary><div class="form-grid">'+field('倍率（默认1）',input('mapScale',old?.scale||'','placeholder="1"'))+field('数值偏移（默认0）',input('mapOffset',old?.offset||'','placeholder="0"'))+field('最大Value字节数（变长字段）',input('mapMaxBytes',old?.max_bytes||'','inputmode="numeric"'))+'</div><p>对象、数组、重复对象及分组仍使用已有容器编码。每一级容器需有明确映射；业务字段不能代替线上类型。</p></details>';
        $('mappingFields').innerHTML=html;
        const update=()=>{$('mapWidth').textContent=width[$('mapWire').value]?`固定宽度 ${width[$('mapWire').value]} B，TLV Length自动生成。`:'变长或容器类型：Length按实际编码内容生成。';};$('mapWire').onchange=update;update();
      } else {
        const cmd=currentCommand();const containers=state.workspace.bindings.filter(b=>b.operation===cmd.operation&&b.role===role&&['object','group'].includes(b.wire_type));
        html=field('容器地址',select('mapContainer',containers.map(b=>[b.tlv_path,b.tlv_path+' · '+(b.model_path||'当前对象')]),old?.container_path||'','请选择容器'))+field('组合规则',select('mapRule',[['at_least_one','至少携带一个'],['all_or_none','全有或全无']],old?.rule||'at_least_one'))+field('字段（用英文逗号分隔）',input('mapGroupFields',(old?.fields||'').split('|').join(', ')));
        $('mappingFields').innerHTML=html;
      }
      $('mappingDialog').showModal();
    }
    function addProjection(u) {
      const div=document.createElement('div');div.className='projection-row';
      const chosen=$('mapTarget').value;const temp={method:chosen};
      const available=schemaPaths(rootsFor(temp,'incoming')).filter(([p])=>p&&!p.includes('[]'));
      if(u.from&&!available.some(([p])=>p===u.from))available.push([u.from,u.from]);
      const props=Object.keys(state.workspace.model.properties).map(k=>[k,k]);
      if(u.to&&!props.some(([p])=>p===u.to))props.push([u.to,u.to]);
      div.innerHTML=`<label class="form-control"><span>上行数据字段</span><select class="select" data-projection-from>${options(available,u.from,'选择来源')}</select></label><label class="form-control"><span>更新到属性</span><select class="select" data-projection-to>${options(props,u.to,'选择属性')}</select></label><button class="tree-action danger" type="button" data-remove-projection>移除</button>`;
      div.querySelector('[data-remove-projection]').onclick=()=>div.remove();$('projectionRows').append(div);
    }
    function hex(value) {if(!/^(?:0x)?[0-9a-f]{1,2}$/i.test(value.trim()))throw Error('SID/CID必须为一个字节的十六进制地址');return '0x'+parseInt(value,16).toString(16).toUpperCase().padStart(2,'0');}
    function saveMapping(e) {
      e.preventDefault();const {table,index}=editing,rows=state.workspace[table],old=index===null?null:rows[index];
      try {
        let next,metadata;
        if(table==='commands') {
          const target=$('mapTarget').value;if(!target)throw Error('请选择物模型功能');
          const sid=hex($('mapSid').value),cid=hex($('mapCid').value);
          if(parseInt(sid,16)<16||parseInt(sid,16)>254)throw Error('业务SID仅允许0x10～0xFE，公共及保留地址不能由业务字典占用');
          if(rows.some((r,i)=>i!==index&&parseInt(r.sid,16)===parseInt(sid,16)&&parseInt(r.cid,16)===parseInt(cid,16)))throw Error('SID/CID已被其他指令使用');
          const interaction=$('mapInteraction').value,variants=[...document.querySelectorAll('[data-reply]:checked')].map(b=>b.dataset.reply);
          if(interaction==='one_way'&&variants.length)throw Error('仅下发指令不能定义应用回包');
          if(target.startsWith('event:')&&interaction!=='receive_only')throw Error('事件只能配置为仅接收上行');
          const behavior=$('mapBehavior').value;
          if(target.startsWith('property:')) {const p=state.workspace.model.properties[target.split(':')[1]],access=p.access||'';if((behavior==='write'&&!access.includes('w'))||(behavior!=='write'&&!access.includes('r')))throw Error('属性行为不符合物模型读写权限');if(behavior==='report'&&interaction!=='receive_only')throw Error('属性上报必须为仅接收上行');if(behavior==='read'&&interaction==='receive_only')throw Error('读取属性需要下行查询');if(behavior!=='write'&&!variants.includes('incoming'))throw Error('读取或上报属性需要业务数据形式');}
          let id=old?.operation;if(!id){const stem='cmd_'+sid.slice(2).toLowerCase()+'_'+cid.slice(2).toLowerCase();id=stem;let n=2;while(rows.some(r=>r.operation===id))id=stem+'_'+n++;}
          next={...(old||Object.fromEntries(state.columns.commands.map(k=>[k,'']))),operation:id,method:target+(target.startsWith('property:')?':'+behavior:''),sid,cid,interaction,receive_variants:variants.join('|'),correlation:old?.correlation||(interaction==='one_way'||interaction==='receive_only'?'none':'unmarked'),source:$('mapSource').value,availability:old?.availability||'active'};
          metadata=copy(state.workspace.command_metadata?.[id]||{});
          const success=$('mapSuccess').value.trim();if(success){const num=Number(success);if(!Number.isInteger(num)||num<0||num>4294967295)throw Error('成功码必须为uint32整数');metadata.resultSuccessCode=num;}else delete metadata.resultSuccessCode;
          const updates=[...document.querySelectorAll('.projection-row')].map(row=>({from:row.querySelector('[data-projection-from]').value,to:row.querySelector('[data-projection-to]').value}));
          if(updates.some(u=>!u.from||!u.to))throw Error('请完整选择每条属性更新关系，或移除该行');
          if(updates.length)metadata.propertyUpdates=updates;else delete metadata.propertyUpdates;
          const notesText=$('mapNotes').value;
          if(notesText!==(metadata.notes||[]).join('\n')) {const notes=notesText.split('\n').map(x=>x.trim()).filter(Boolean);if(notes.length)metadata.notes=notes;else delete metadata.notes;}
        } else if(table==='bindings') {
          if(!currentCommand())throw Error('请先创建指令');
          const path=$('mapTlv').value.trim();if(!/^(?:[0-9a-f]{1,2})(?:\/[0-9a-f]{1,2})*$/i.test(path)||path.split('/').some(x=>parseInt(x,16)>127))throw Error('TLV地址使用逻辑Type路径，每段0x00～0x7F，例如01/02');
          if(rows.some((r,i)=>i!==index&&r.operation===operation&&r.role===role&&r.tlv_path.toUpperCase().split('/').map(x=>parseInt(x,16)).join('/')===path.toUpperCase().split('/').map(x=>parseInt(x,16)).join('/')))throw Error('当前方向的TLV地址重复');
          next={...(old||Object.fromEntries(state.columns.bindings.map(k=>[k,'']))),operation,role,model_path:$('mapField').value,tlv_path:path.toUpperCase().split('/').map(x=>x.padStart(2,'0')).join('/'),wire_type:$('mapWire').value,required:$('mapRequired').value,scale:$('mapScale').value.trim(),offset:$('mapOffset').value.trim(),max_bytes:$('mapMaxBytes').value.trim()};
          for(const key of ['scale','offset'])if(next[key]&&!Number.isFinite(Number(next[key])))throw Error('倍率和偏移必须为有效数字');
          if(next.scale&&Number(next.scale)===0)throw Error('倍率不能为0');
          if(next.max_bytes&&(!/^\d+$/.test(next.max_bytes)||Number(next.max_bytes)<1||Number(next.max_bytes)>16383))throw Error('最大字节数应为1～16383的整数');
        } else {
          const names=$('mapGroupFields').value.split(',').map(s=>s.trim()).filter(Boolean);
          if(!$('mapContainer').value||!names.length||names.some(s=>!(/^[A-Za-z_][A-Za-z0-9_]*$/).test(s))||new Set(names).size!==names.length)throw Error('请选择容器，并填写不重复的英文字段标识符');
          next={operation,role,container_path:$('mapContainer').value,rule:$('mapRule').value,fields:names.join('|')};
        }
        if(old)rows[index]=next;else rows.push(next);
        if(metadata){(state.workspace.command_metadata||(state.workspace.command_metadata={}))[next.operation]=metadata;delete state.workspace.targets?.[next.operation];}
        $('mappingDialog').close();touch();showToast('配置已保存，正在重新校验。');
      } catch(error){$('mappingFormError').textContent=error.message;$('mappingFormError').hidden=false;}
    }
    function deleteMapping(index) {
      const table=state.activeTable,row=state.workspace[table][index];if(!row)return;
      if(table==='commands'&&(state.workspace.bindings.some(b=>b.operation===row.operation)||state.workspace.groups.some(g=>g.operation===row.operation))) {showToast('请先删除该指令的字段绑定和组合约束，再删除指令。','warning');return;}
      if(table==='bindings') {
        const children=state.workspace.bindings.some((b,i)=>i!==index&&b.operation===row.operation&&b.role===row.role&&b.tlv_path.startsWith(row.tlv_path+'/'));
        const groups=state.workspace.groups.some(g=>g.operation===row.operation&&g.role===row.role&&(g.container_path===row.tlv_path||g.container_path.startsWith(row.tlv_path+'/')));
        if(children||groups){showToast('该容器仍有子字段或组合约束，请先处理引用。','warning');return;}
      }
      if(!window.confirm('删除这条配置？'))return;
      state.workspace[table].splice(index,1);
      if(table==='commands'){delete state.workspace.command_metadata?.[row.operation];delete state.workspace.targets?.[row.operation];}
      touch();
    }
    function jump(op) {operation=op;state.activeTable='bindings';renderMappings();$('tablesSection').scrollIntoView({block:'start',behavior:'smooth'});}
    function featureAction(e) {
      const jumpButton=e.target.closest('[data-binding-jump]');if(jumpButton){jump(jumpButton.dataset.bindingJump);return;}
      const b=e.target.closest('[data-feature-action]');if(!b)return;
      const n=bridge.nodeById(b.dataset.nodeId);if(!n)return;
      if(b.dataset.featureAction==='delete')bridge.deleteNodeById(n.id);
      else if(b.dataset.featureAction==='parameters') {
        view='tree';renderModel();const virtual=state.modelNodes.find(x=>x.pathLabel===`${n.pathLabel}.${b.dataset.parameterRole}`);
        if(virtual){
          if(!Object.keys(virtual.schema.properties||{}).length)bridge.openAddChild(virtual.id);
          else revealNode(virtual);
        }
      } else if(b.dataset.featureAction==='definition'&&['object','array'].includes(n.schema?.type)) {view='tree';renderModel();revealNode(n);}
      else if(n.kind==='method')bridge.openEditMethod(n.id);else bridge.openEditNode(n.id);
    }
    function revealNode(node) {
      const row=$('modelTree').querySelector(`[data-node-id="${node.id}"]`)?.closest('.tree-row');
      if(row){row.scrollIntoView({block:'center'});row.classList.add('is-reference-target');window.setTimeout(()=>row.classList.remove('is-reference-target'),2200);}
    }
    function tabKeyboard(selector) {
      for(const b of document.querySelectorAll(selector)) b.addEventListener('keydown',e=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
        e.preventDefault();const buttons=[...b.parentElement.querySelectorAll(selector)],index=buttons.indexOf(b);
        const next=buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length];next.focus();next.click();
      });
    }
    for(const b of document.querySelectorAll('[data-model-view]'))b.onclick=()=>{view=b.dataset.modelView;renderModel();};
    for(const b of document.querySelectorAll('[data-model-category]'))b.onclick=()=>{category=b.dataset.modelCategory;renderModel();};
    $('addFeatureBtn').onclick=()=>category==='methods'?bridge.openCreateMethod():bridge.openCreateRoot(category);
    $('modelFeatureBody').onclick=featureAction;
    $('mappingOperation').onchange=e=>{operation=e.target.value;renderMappings();};
    for(const b of document.querySelectorAll('[data-binding-role]'))b.onclick=()=>{role=b.dataset.bindingRole;renderMappings();};
    $('openGroupsBtn').onclick=()=>{state.activeTable='groups';renderMappings();};
    $('workspaceTableBody').addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-mapping-edit'))showDialog(state.activeTable,Number(b.dataset.mappingEdit));
      else if(b.hasAttribute('data-mapping-delete'))deleteMapping(Number(b.dataset.mappingDelete));
      else if(b.hasAttribute('data-mapping-bind'))jump(b.dataset.mappingBind);
      else if(b.hasAttribute('data-mapping-toggle')){const c=state.workspace.commands[Number(b.dataset.mappingToggle)];c.availability=c.availability==='suspended'?'active':'suspended';touch();}
    });
    $('mappingForm').onsubmit=saveMapping;
    for(const id of ['closeMappingBtn','cancelMappingBtn'])$(id).onclick=()=>$('mappingDialog').close();
    bridge.bindDialogBackdrop($('mappingDialog'));
    for(const selector of ['[data-model-view]','[data-model-category]','[data-binding-role]','[data-table-tab]'])tabKeyboard(selector);
    function validateRename(node,name) {
      if(node.intent!=='edit'||node.oldKey===name||node.virtualRoot||node.arrayItemRoot)return;
      for(const path of linkedRenamePaths(state.workspace,node)) {
        const slot=modelSlot(state.workspace,path);
        if(!slot.holder || !Object.hasOwn(slot.holder,slot.key))throw Error('无法定位关联字段：'+path);
        if(slot.key!==name&&Object.hasOwn(slot.holder,name))throw Error('关联结构已存在同名字段：'+path+' → '+name);
      }
    }
    function renameAll(node,name) {
      if(node.intent!=='edit'||node.oldKey===name||node.virtualRoot||node.arrayItemRoot)return;
      const first=node.referencePath || node.pathLabel;
      const paths=linkedRenamePaths(state.workspace,node);
      for(const path of paths) {
        if(path!==first) {
          const slot=modelSlot(state.workspace,path);
          slot.holder[name]=slot.holder[slot.key];delete slot.holder[slot.key];
          if(Array.isArray(slot.parent?.required))slot.parent.required=slot.parent.required.map(k=>k===slot.key?name:k);
        }
        renameReferences(state.workspace,{...node,referencePath:path,parentSchema:path===first?node.parentSchema:{},oldKey:node.oldKey},name);
      }
    }
    return {renderModel,renderMappings,addRow:()=>showDialog(state.activeTable),validateRename,rename:renameAll,references:node=>references(state.workspace,node)};
  }
  window.BleConfigUI={create,parseTarget,references,renameReferences,nodeScope,linkedRenamePaths,modelSlot};
})();
