import {roles,contextKey,fileConfirmed,contextMismatch,buildDataset,validateSnapshot} from './package.mjs';
import {inferPack,prepareFiles,readingGap} from './auto-package.mjs';
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
export function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export class PackageWorkspace{
 constructor(onChange){
  this.files=[];this.onChange=onChange;this.busy=false;this.draft=null;
  $('packProvince').innerHTML+=[...'广东 江苏 上海 四川 浙江 山东 北京 天津 重庆 河北 河南 湖北 湖南 安徽 福建 江西 广西 海南 贵州 云南 西藏 陕西 山西 甘肃 青海 宁夏 新疆 辽宁 吉林 黑龙江 内蒙古'.split(' ')].map(s=>`<option>${s}</option>`).join('');
  for(const id of ['packProvince','packYear','packExamType'])$(id).addEventListener('change',()=>{for(const f of this.files)f.contextOverride=false;this.emit('已按新的考试归属重新分析；归属冲突的文件会单独提示。');});
  $('packName').addEventListener('change',()=>this.emit());
  $('file').addEventListener('change',async()=>{const chosen=[...$('file').files];await this.importBatch(chosen);$('file').value='';});
  $('sample').onclick=async()=>{
   if(this.files.length)return this.message('请先保存并清空现有资料包，再加载体验表，避免混合考试。');
   $('packProvince').value='广东';$('packYear').value='2027';$('packExamType').value='普通省考';$('packName').value='广东2027 · 演示资料';
   try{this.setBusy(true);const res=await fetch('/api/sample');const result=await res.json();if(!res.ok)throw Error(result.error);this.add(result.files);for(const f of this.files)if(f.kind==='jobs'){f.confirmed=true;f.contextKey=contextKey(this.pack);}this.emit(result.sampleKind==='fictional'?'已载入虚构演示职位表，仅用于体验软件，不是真实招录信息。':'已载入本机真实职位表副本，未验证为官方最新版；主公告、指南及目录仍需补齐。');}catch(e){this.message(e.message);}finally{this.setBusy(false);}
  };
  $('clearPackage').onclick=()=>{if(this.busy)return;this.files=[];for(const id of ['packName','packProvince','packYear','packExamType'])$(id).value='';this.emit('已清空当前资料包。已下载的备份和原文件不受影响。');};
  $('savePackage').onclick=()=>download((this.pack.name||'考试资料包')+'.json',JSON.stringify({format:'xuan-zhi-package',version:1,pack:this.pack,files:this.files},null,2),'application/json');
  $('restorePackage').onchange=async()=>{
   const f=$('restorePackage').files[0];if(!f)return;
   try{if(f.size>50*1024*1024)throw Error('备份不能超过50MB');const s=validateSnapshot(JSON.parse(await f.text()));
    this.files=s.files;
    for(const [id,k] of [['packName','name'],['packProvince','province'],['packYear','year'],['packExamType','examType']])$(id).value=s.pack[k];
    this.emit('已恢复资料包，并自动应用可读文件。备份不包含个人档案。');
   }catch(e){this.message('恢复失败：'+e.message+'。原资料包已保留。');}finally{$('restorePackage').value='';}
  };
  $('files').addEventListener('click',e=>{const review=e.target.closest('[data-review]'),remove=e.target.closest('[data-remove]');if(review)this.review(review.dataset.review);if(remove&&!this.busy){this.files=this.files.filter(f=>f.id!==remove.dataset.remove);this.emit('文件已移除，相关岗位和规则已重算。');}});
  $('dialogbody').addEventListener('change',e=>{
   if(!this.draft)return;
   const box=e.target.closest('[data-block]');if(box){box.checked?this.draft.selected.add(box.dataset.block):this.draft.selected.delete(box.dataset.block);$('selectedCount').textContent=this.draft.selected.size;}
  });
  $('dialogbody').addEventListener('input',e=>{if(this.draft&&e.target.id==='blockQuery')this.renderBlocks();});
  $('dialogbody').addEventListener('click',e=>{if(e.target.id==='moreBlocks'){this.draft.limit+=100;this.renderBlocks();}if(e.target.id==='applyFile')this.confirmDraft();});
  $('pasteDocument').onclick=()=>this.paste();
  fetch('/api/info').then(r=>r.ok?r.json():null).then(info=>{if(info?.version!=='package-v1')this.message('当前连接的可能是旧版服务。请关闭旧终端并重新双击启动器；新版会自动选择可用端口。');}).catch(()=>this.message('本机服务未连接，请重新启动分析器。'));
 }
 get pack(){return {name:$('packName').value.trim(),province:$('packProvince').value,year:$('packYear').value,examType:$('packExamType').value};}
 message(s){$('message').textContent=s;}
 setBusy(value){this.busy=value;for(const id of ['file','sample','restorePackage','clearPackage','pasteDocument'])$(id).disabled=value;}
 add(entries){if(!Array.isArray(entries))throw Error('后端版本不匹配，请关闭旧服务并重新启动资料包版本');let duplicates=0;for(const f of entries){if(this.files.some(x=>x.id===f.id)){duplicates++;continue;}if(this.files.length>=100)throw Error('资料包最多100份文件，请先移除不需要的文件');const n=this.files.reduce((s,f)=>s+(f.jobs?.length||0),0)+(f.jobs?.length||0);if(n>100000)throw Error('资料包总岗位记录超过10万');this.files.push(f);}return duplicates;}
 async importBatch(chosen){
  if(this.busy||!chosen.length)return;
  this.setBusy(true);let duplicates=0,failures=0;
  for(let i=0;i<chosen.length;i++){
   const f=chosen[i];this.message(`正在读取 ${i+1}/${chosen.length}：${f.name}，已有资料保留…`);
   try{if(f.size>20*1024*1024)throw Error('单文件超过20MB');const res=await fetch('/api/import?name='+encodeURIComponent(f.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:f});const result=await res.json();if(!res.ok)throw Error(result.error);duplicates+=this.add(result.files);failures+=(result.files||[]).filter(f=>f.status==='error').length;}
   catch(e){failures++;const error=`${f.name}：${e.message}`;this.message(error);if(this.files.length<100){const token=crypto.randomUUID().replaceAll('-','');this.files.push({id:token+token,filename:f.name,kind:'error',role:'unknown',status:'error',error,size:f.size,confirmed:false,context:{},warnings:[],scope:{city:'',system:'',codes:''}});}}
   this.emit();
  }
  this.setBusy(false);this.emit(`导入结束，重复文件跳过 ${duplicates} 份，失败 ${failures} 份。可读文件已自动参与分析；只有异常项需要处理。`);
 }
 emit(text){
  const inferred=inferPack(this.files,this.pack);for(const [id,k] of [['packProvince','province'],['packYear','year'],['packExamType','examType']])$(id).value=inferred[k]||'';
  prepareFiles(this.files,this.pack);this.renderFiles();if(this.files.some(f=>f.autoIssue||readingGap(f)))$('packageDetails').open=true;this.onChange(buildDataset(this.files,this.pack));if(text)this.message(text);
 }
 renderFiles(){
  $('fileCount').textContent=`${this.files.length} 份文件`;
  $('packageSummary').textContent=`${this.files.length} 份资料${this.files.filter(f=>f.autoIssue||readingGap(f)).length?' · 存在异常':''}`;
  const active=this.files.filter(f=>fileConfirmed(f,this.pack)).length;
  $('files').innerHTML=this.files.map(f=>`<div class="fileRow"><div><b>${esc(f.filename)}</b>${f.archive?`<span class="sub">ZIP：${esc(f.archive)}</span>`:''}<span class="sub">${roles[f.role]||'其他资料'} · ${f.kind==='jobs'?`${f.jobs.length} 条岗位`:f.kind==='document'?`${f.blocks.length} 段文字`:'未读入内容'}${f.context?.province||f.context?.year?` · ${esc(f.context.province)} ${esc(f.context.year)}`:''}</span>${f.error?`<span class="errorText">${esc(f.error)}</span>`:''}${f.autoIssue&&f.kind!=='error'?`<span class="errorText">${esc(f.autoIssue)}</span>`:''}${f.warnings?.length?`<details><summary>读取说明</summary><span class="sub">${esc(f.warnings.join('；'))}</span></details>`:''}</div><span class="badge ${f.status==='error'?'fail':f.autoIssue||readingGap(f)?'review':''}">${f.status==='error'?'读取失败':f.autoIssue?'需处理异常':readingGap(f)?'部分读取':f.role==='reference'?'参考资料':'已自动应用'}</span><div><button class="quiet" data-review="${f.id}">${f.kind==='error'?'查看错误':f.autoIssue?'处理异常':'查看 / 调整'}</button><button class="text" data-remove="${f.id}">移除</button></div></div>`).join('')||'<p class="hint">上传职位表、公告、指南或ZIP即可开始，系统自动识别并应用，不需要逐份确认。</p>';
  const issues=this.files.filter(f=>f.autoIssue||readingGap(f)).length;
  $('packageHealth').textContent=this.files.length?`已自动应用 ${active} 份文件${issues?`，${issues} 份存在异常或读取缺失`:'，无需逐份确认'}。${!this.pack.province||!this.pack.year?'考试省份或年度尚未识别，可选填补充；不影响查看岗位。':''}`:'资料导入后自动识别用途、考试归属和候选限制。';
 }
 review(id){
  const f=this.files.find(f=>f.id===id);if(!f)return;
  $('dialogtitle').textContent=f.filename;
  if(f.kind==='error'){$('dialogbody').innerHTML=`<p class="errorText">${esc(f.error)}</p><p>原有文件保留。可移除此条目，解密、转存为支持的格式或粘贴正文后重试。</p>`;$('dialog').showModal();this.draft=null;return;}
  this.draft={file:f,selected:new Set(f.selectionInitialized?f.selectedBlockIds:(f.blocks||[]).filter(b=>b.candidate).map(b=>b.id)),limit:100};
  const cities=[...new Set(this.files.flatMap(f=>f.jobs||[]).map(j=>j.city).filter(Boolean))].sort();
  const systems=[...new Set(this.files.flatMap(f=>f.jobs||[]).map(j=>j.sheet).filter(Boolean))].sort();
  const options=(vs,sel,label)=>`<option value="">${label}</option>`+vs.map(s=>`<option ${s===sel?'selected':''}>${esc(s)}</option>`).join('');
  const mismatch=contextMismatch(f,this.pack);
  $('dialogbody').innerHTML=`<p class="hint">考试归属：${esc(this.pack.province)} ${esc(this.pack.year)} ${esc(this.pack.examType)}。${mismatch?'检测到'+esc(mismatch)+'，可调整本包归属，或在此保留本文件。':''}</p>${mismatch?'<label class="check"><input id="overrideContext" type="checkbox">已核对原文，以当前资料包归属为准</label>':''}<label>文件用途<select id="fileRole">${Object.entries(roles).map(([k,v])=>`<option value="${k}" ${f.role===k?'selected':''} ${f.kind==='jobs'&&!['jobs','reference'].includes(k)||f.kind==='document'&&k==='jobs'?'disabled':''}>${v}</option>`).join('')}</select></label><label>官方来源链接（选填，仅记录，不自动访问）<input id="fileUrl" value="${esc(f.sourceUrl||'')}" placeholder="https://…"></label>`+
   (f.kind==='document'?`<div class="twocol"><label>适用考区/地区<select id="scopeCity">${options(cities,f.scope?.city,'整个资料包')}</select></label><label>适用工作表/系统<select id="scopeSystem">${options(systems,f.scope?.system,'全部系统')}</select></label></div><label>仅适用这些职位代码（选填，逗号分隔）<input id="scopeCodes" value="${esc(f.scope?.codes||'')}"></label><p class="hint">地区按岗位表“考区/地区”字段匹配，不等同于实际工作地点。专项文件请缩小范围，不应直接套给全包岗位。</p><details><summary>查看提取全文（含位置）</summary><textarea class="documentText" readonly>${esc(f.blocks.map(b=>`[${b.location}] ${b.text}`).join('\n\n'))}</textarea></details><h3 class="detailhead">选择本次需要判断的条款 · 已选 <span id="selectedCount">${this.draft.selected.size}</span> 条</h3><p class="hint">候选条款按关键词建议，可能漏选或多选。请对照全文核对；含复杂例外的整段会保留待核对。专业目录用于专业对应证据，参考资料不参与资格条件。</p><input id="blockQuery" placeholder="搜索全文段落，空白显示全部"><div id="blockList"></div><p class="hint">条款已自动提取并参与筛选，不需要确认全文覆盖。可以在此调整；复杂例外仍会在岗位结果中显示。</p>${readingGap(f)?'<p class="errorText">文档存在缺页或下载缺失，已读部分仍参与分析；缺失内容需补充。</p>':''}`:
    `<p>共读取 ${f.jobs.length} 条岗位记录、${f.sheets.length} 个工作表。已自动加入本包岗位，保留来源。</p>`+f.sheets.map(s=>`<div class="schema"><b>${esc(s.sheet)} · ${s.count}条</b><p>${esc(s.warning||Object.values(s.mapping).join(' / '))}</p></div>`).join(''))+
   `<div class="reviewFooter"><button id="applyFile" class="quiet">保存调整</button><p id="fileError" class="errorText" role="status"></p></div>`;
  if(f.contextOverride&&$('overrideContext'))$('overrideContext').checked=true;
  if(f.kind==='document')this.renderBlocks();$('dialog').showModal();
 }
 renderBlocks(){const d=this.draft;if(!d||d.file.kind!=='document')return;const q=$('blockQuery').value.trim();const blocks=d.file.blocks.filter(b=>!q||b.text.includes(q));$('blockList').innerHTML=blocks.slice(0,d.limit).map(b=>`<label class="blockChoice"><input type="checkbox" data-block="${esc(b.id)}" ${d.selected.has(b.id)?'checked':''}><span><small>${esc(b.location)}${b.candidate?' · 建议候选':''}</small>${esc(b.text)}</span></label>`).join('')+(blocks.length>d.limit?`<button id="moreBlocks" class="quiet">再显示100段（还有${blocks.length-d.limit}段）</button>`:'');}
 confirmDraft(){
  const d=this.draft;if(!d)return;const f=d.file;const role=$('fileRole').value;
  const error=s=>{$('fileError').textContent=s;};
  if(role==='unknown')return error('请确认文件用途');
  if(role==='special'&&!f.autoTarget&&!$('scopeSystem')?.value&&!$('scopeCodes')?.value.trim())return error('专项简章请指定适用系统或职位代码，避免套用到无关岗位');
  if(role==='local'&&!$('scopeCity')?.value&&!$('scopeCodes')?.value.trim())return error('地方公告请指定适用考区/地区或职位代码');
  if(contextMismatch(f,this.pack)&&!$('overrideContext')?.checked)return error('检测到省份/年度不同，请核对归属或另建资料包');
  const url=$('fileUrl').value.trim();if(url&&!/^https?:\/\//i.test(url))return error('来源链接仅支持http或https');
  if(role!=='special'||$('scopeSystem')?.value||$('scopeCodes')?.value.trim())delete f.autoTarget;
  Object.assign(f,{role,sourceUrl:url,confirmed:true,settingsEdited:true,applicationMode:'auto',contextOverride:Boolean($('overrideContext')?.checked)||Boolean(f.contextOverride),contextKey:contextKey(this.pack),selectedBlockIds:[...d.selected],selectionInitialized:true,coverageConfirmed:false,scope:f.kind==='document'?{city:$('scopeCity').value,system:$('scopeSystem').value,codes:$('scopeCodes').value.trim()}:{city:'',system:'',codes:''}});
  this.draft=null;$('dialog').close();this.emit('调整已保存，相关结果已重新计算。');
 }
 paste(){
  $('dialogtitle').textContent='粘贴公告或指南正文';this.draft=null;
  $('dialogbody').innerHTML='<label>文件名<input id="pasteName" placeholder="如：广东2027主公告.txt"></label><label>核对后的正文<textarea id="pasteText" class="documentText"></textarea></label><button id="pasteSubmit" class="quiet">作为新文档添加</button><p id="pasteError" class="errorText"></p>';
  $('dialog').showModal();$('pasteSubmit').onclick=async()=>{const text=$('pasteText').value;if(!text.trim())return $('pasteError').textContent='请填写正文';const entered=$('pasteName').value.trim()||'粘贴公告';const name=/\.txt$/i.test(entered)?entered:entered+'.txt';$('dialog').close();await this.importBatch([new File([text],name,{type:'text/plain'})]);};
 }
}
