import {csvCell, clean} from './rules.mjs';
import {resultFacets,matchesResultFilters,remarkKinds} from './result-filters.mjs';
import {createPackageEvaluator,contextKey} from './package.mjs';
import {PackageWorkspace,esc} from './workspace.mjs';
import {CollectionPanel} from './collection.mjs';
import {initPages} from './navigation.mjs';
import {PKController} from './pk-ui.mjs';
import {evidenceHTML,commonCards} from './evidence.mjs';
import {resultLabels} from './presentation.mjs';
const $=id=>document.getElementById(id);
const profileKeys=['education','degree','majorName','majorCode','fresh','graduationYear','freshException','experience','sex','party','serviceIdentity','lawQualification','studyMode','serviceCommitment','applicantCategory','shHukou','highestEducation','shResidenceSince','shResidenceUntil','shPointsNotice'];
let data=null,filtered=[],page=1,cache=[],saved=new Set(),supplementalAnswers={},suggestedConditions=[];
const pageSize=30;
const resultFilters={scope:'all',remarkState:'all',kind:'',blocked:new Set()};
$('resultScopes').onclick=e=>{const button=e.target.closest('[data-result-scope]');if(button){resultFilters.scope=button.dataset.resultScope;apply();}};
$('remarkState').onchange=()=>{resultFilters.remarkState=$('remarkState').value;apply();};
$('remarkKind').onchange=()=>{resultFilters.kind=$('remarkKind').value;apply();};
$('remarkExclusions').onchange=e=>{const kind=e.target.dataset.remarkKind;if(!kind)return;e.target.checked?resultFilters.blocked.add(kind):resultFilters.blocked.delete(kind);apply();};
$('resetResultFilters').onclick=()=>{Object.assign(resultFilters,{scope:'all',remarkState:'all',kind:''});resultFilters.blocked.clear();$('remarkState').value='all';apply();};
function renderResultFilters(rows){
 const total=rows.length,three=rows.filter(x=>x.facets.three).length,unlimited=rows.filter(x=>x.facets.unlimited).length;
 const scopes=[['all','全部',total],['hideThree','隐藏三不限',total-three],['onlyThree','只看三不限',three],['hideUnlimited','隐藏不限专业',total-unlimited]];
 $('resultScopes').innerHTML=scopes.map(([value,label,count])=>`<button class="quiet" data-result-scope="${value}" aria-pressed="${resultFilters.scope===value}">${label} <b>${count.toLocaleString()}</b></button>`).join('');
 const remarkRows=rows.filter(item=>matchesResultFilters(item,{scope:resultFilters.scope,remarkState:resultFilters.remarkState}));
 const counts=new Map(remarkKinds.map(k=>[k,remarkRows.filter(x=>x.facets.groups.some(g=>g.kind===k)).length]));
 $('remarkKind').innerHTML='<option value="">全部类别</option>'+remarkKinds.filter(k=>counts.get(k)||resultFilters.kind===k).map(k=>`<option value="${esc(k)}" ${resultFilters.kind===k?'selected':''}>${esc(k)}（${counts.get(k)}）</option>`).join('');
 $('remarkExclusions').innerHTML=remarkKinds.filter(k=>counts.get(k)||resultFilters.blocked.has(k)).map(k=>`<label class="check"><input type="checkbox" data-remark-kind="${esc(k)}" ${resultFilters.blocked.has(k)?'checked':''}>隐藏${esc(k)} <span>${counts.get(k)}</span></label>`).join('')||'<p class="hint">当前范围没有识别到岗位备注类别。</p>';
 $('blockedRemarkCount').textContent=resultFilters.blocked.size?`· 已隐藏 ${resultFilters.blocked.size} 类`:'';
}

try{saved=new Set(JSON.parse(localStorage.getItem('jobFavorites')||'[]')); const p=JSON.parse(localStorage.getItem('jobProfile')||'null');if(p){if(/20\d{2}届/.test(p.fresh||'')){p.graduationYear=p.fresh.slice(0,4);p.fresh='应届';}if(p.fresh==='其他应届')p.fresh='应届';profileKeys.forEach(k=>{if(p[k]!==undefined)$(k).value=p[k]});supplementalAnswers=p.supplementalAnswers||{};$('saveProfile').checked=true;}}catch{}
const profile=()=>({...Object.fromEntries(profileKeys.map(k=>[k,$(k).value])),supplementalAnswers});
const key=j=>contextKey(workspace.pack)+'|'+j.sourceFileId+'|'+j.identity;
function message(text){$('message').textContent=text;}
function updateDataset(d){
  data=d;
  $('filename').textContent=d.filename;
  $('sourceinfo').textContent=`${workspace.files.length} 份文件 · ${d.total.toLocaleString()} 条岗位记录 · ${d.recruits.toLocaleString()} 个名额（疑似冲突可能重复） · 合并相同记录 ${d.merged} 条`;
  const opts=(id,label,values)=>{const old=$(id).value;$(id).innerHTML=`<option value="">${label}</option>`+[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(v=>`<option>${esc(v)}</option>`).join('');if([...$(id).options].some(o=>o.value===old))$(id).value=old;};
  opts('city','全部考区',d.jobs.map(j=>j.city));opts('sheet','全部系统',d.jobs.map(j=>j.sheet));
  const majors=[...new Set(d.jobs.flatMap(j=>[j.majorBachelor,j.majorGrad,j.majorCollege,j.major]).join(',').split(/[,，;；]/).filter(v=>v&&v!=='不限'))].slice(0,1500);
  $('majors').innerHTML=majors.map(v=>`<option value="${esc(v)}"></option>`).join('');
  recompute();
}
function recompute(){
 if(!data)return;
 const p=profile(),evaluateJob=createPackageEvaluator(p,workspace.files,workspace.pack);cache=data.jobs.map(j=>{const r=evaluateJob(j);return {j,r,facets:resultFacets(j,r)};});
 try{if($('saveProfile').checked)localStorage.setItem('jobProfile',JSON.stringify(p));else localStorage.removeItem('jobProfile');}catch{}
 apply();
}
function apply(){
 if(!data)return;
 const query=$('query').value.trim().toLowerCase(),city=$('city').value,sheet=$('sheet').value,mode=$('majorMode').value,status=$('status').value;
 let base=cache.filter(({j,r})=>{
  if(city&&j.city!==city||sheet&&j.sheet!==sheet)return false;
  if(query&&!Object.values(j.raw).join(' ').toLowerCase().includes(query))return false;
  if(mode==='unlimited'&&!r.flags.major)return false;
  if(mode==='three'&&!Object.values(r.flags).every(Boolean))return false;
  if(mode==='code'&&!r.majorCodeHit)return false;
  if(mode==='name'&&!r.flags.major&&(!clean($('majorName').value)||!clean(r.major).includes(clean($('majorName').value))))return false;
  if(mode==='hit'&&!r.flags.major&&!r.majorCodeHit)return false;
  return true;
 });
 renderCommon(base);
 $('total').textContent=data.total.toLocaleString();$('recruits').textContent=`录用 ${data.recruits.toLocaleString()} 人`;
 const requirements=new Map();
 // Derive from the range before status filtering: excluded answers remain editable.
 for(const {r} of ($('conditionScope').value==='all'?cache:base))for(const c of r.conditions.filter(c=>c.manualEligible)){
  const entry=requirements.get(c.answerKey)||{...c,count:0};entry.count++;requirements.set(c.answerKey,entry);
 }
 suggestedConditions=[...requirements.values()];renderSupplemental();
 const statusRows=base.filter(({j,r})=>status==='all'||status==='candidate'&&r.status!=='fail'||status===r.status||status==='saved'&&saved.has(key(j)));
 renderResultFilters(statusRows);
 filtered=statusRows.filter(item=>matchesResultFilters(item,resultFilters));
 $('passes').textContent=filtered.filter(x=>x.r.status==='pass').length.toLocaleString();$('reviews').textContent=filtered.filter(x=>x.r.status==='review').length.toLocaleString();
 $('resultFilterSummary').textContent=`本组筛选前 ${statusRows.length.toLocaleString()} 个岗位 → 当前 ${filtered.length.toLocaleString()} 个；隐藏 ${(statusRows.length-filtered.length).toLocaleString()} 个。类别数量可重叠；没有备注不代表资格完整通过。`;
 const sort=$('sort').value;
 filtered.sort((a,b)=>sort==='count'?Number(b.j.count)-Number(a.j.count):sort==='city'?a.j.city.localeCompare(b.j.city,'zh-CN'):({pass:0,review:1,fail:2}[a.r.status]-{pass:0,review:1,fail:2}[b.r.status]));
 page=1;render();
}
const labels=resultLabels;
const compareKey=j=>key(j)+'|'+j.id;
function renderCommon(base){
 const rules=new Map(),coverage=new Map(),fields=new Set();
 const rows=base.length?base:cache.slice(0,1);
 for(const {j,r} of rows){
  if(workspace.pack.province==='上海'&&r.conditions.some(c=>c.kind==='户籍/生源'))fields.add('shHukou');
  for(const n of r.coverageNotes||[])coverage.set(n.field+'|'+n.reason,n);
  for(const c of r.commonChecks||[]){
   const entry=rules.get(c.id)||{...c,reasons:new Map(),fail:new Set(),review:new Set(),pass:new Set()};
   entry.reasons.set(c.reason,c.state);entry[c.state].add(j.id);rules.set(c.id,entry);
   for(const field of c.profileFields||[])fields.add(field);
  }
 }
 $('commonContent').hidden=!workspace.files.length;
 $('commonInputs').hidden=!fields.size;
 const region=$('regionProfile');region.hidden=!fields.size;if(fields.size&&!region.dataset.used){region.open=true;region.dataset.used='true';}
 $('commonNotice').hidden=!workspace.files.length;
 document.querySelectorAll('[data-common-field]').forEach(el=>el.hidden=!fields.has(el.dataset.commonField));
 const items=[...rules.values()],failed=items.filter(c=>c.fail.size).length,pending=items.filter(c=>c.review.size&&!c.unparsed).length,unparsed=items.filter(c=>c.review.size&&c.unparsed).length;
 $('commonCount').textContent=items.length+' 项适用条件';
 $('commonSummary').innerHTML=(failed?`<p class="errorText">${failed} 项共性条件存在明确冲突，已排除适用岗位。详见具体条件。</p>`:'')+(pending?`<p class="hint">${pending} 项可判断的地区条件需要补充个人信息或明确适用身份，填写左侧档案即可重新匹配。</p>`:failed?'<p class="hint">其余具体条款保留原文，见下方来源；没有要求逐份核对公告。</p>':items.length&&items.length===unparsed?'<p class="hint">公告补充已提炼为要点，未计入自动匹配的部分保留对应原文。</p>':items.length?'<p class="health">可自动判断的共性条件已按自报信息匹配。其余具体条款保留原文，岗位附件仍分别检查。</p>':'<p class="hint">当前没有提取到需匹配的共性限制，先按职位附件筛选。读取范围见下方说明。</p>');
 $('commonRulesLabel').textContent=`具体条件与来源（${items.length} 项${unparsed?'，其中 '+unparsed+' 项尚未自动判断':''}）`;
 $('commonRules').innerHTML=commonCards(items.flatMap(c=>[...c.reasons].map(([reason,state])=>({...c,reason,state}))))||'<p class="hint">没有具体共性限制。</p>';
 $('commonNotice').innerHTML=(failed?`<span>${failed}项公告关键条件存在冲突，已排除相应岗位。</span>`:pending?'<span>部分地区条件待补充，可在左侧档案填写；先查看岗位筛选结果。</span>':'<span>岗位按附件条件筛选，公告关键补充列在清单之后。</span>')+'<button id="jumpCommon" class="text">查看关键补充 ↓</button>';
 $('jumpCommon').onclick=()=>$('commonContent').scrollIntoView({behavior:'smooth',block:'start'});
 $('commonCoverage').innerHTML=[...coverage.values()].map(n=>`<p class="hint">${esc(n.field)}：${esc(n.reason)}</p>`).join('')||'<p class="hint">按当前已读取的附件和已提取条件判断；未将报名流程、问答标题和时间安排当作岗位限制。</p>';
}
function renderSupplemental(){
 const query=clean($('conditionSearch').value);
 $('conditionCount').textContent=`${suggestedConditions.length} 条`;
 const entries=suggestedConditions.filter(c=>!query||clean(c.text+c.kind+c.source).includes(query));
 $('supplementalFields').innerHTML=entries.map(c=>`<label class="supplementalField"><span>${esc(c.kind)} · 涉及 ${c.count} 岗位</span><p>【${esc(c.source)}】${esc(c.text)}</p><select data-condition-key="${esc(c.answerKey)}" aria-label="${esc(c.text)}"><option value="">未核对 / 不确定</option><option value="yes" ${supplementalAnswers[c.answerKey]==='yes'?'selected':''}>本人符合整条（含例外及适用范围）</option><option value="no" ${supplementalAnswers[c.answerKey]==='no'?'selected':''}>本人不符合整条</option></select>${supplementalAnswers[c.answerKey]?'<small>用户自行确认；原文仍保留在清单与导出中</small>':''}</label>`).join('')||'<p class="hint">当前范围没有需要补充确认的条款。可切换专业范围或系统查看其他条件。</p>';
}
function majorRequirements(j,education=''){
 const columns=[['研究生','majorGrad'],['本科','majorBachelor'],['大专','majorCollege']];
 const key={博士:'majorGrad',硕士:'majorGrad',本科:'majorBachelor',大专:'majorCollege'}[education];
 if(key)return [{label:j[key]?education+'专业':j.major?'统一专业要求':education+'专业',text:j[key]||j.major||'对应专业未提供'}];
 const entries=columns.filter(([,k])=>j[k]).map(([label,k])=>({label:label+'专业',text:j[k]}));
 if(j.major)entries.push({label:'统一专业要求',text:j.major});
 return entries.length?entries:[{label:'专业要求',text:'未提供'}];
}
function majorHTML(j,education,result){
 const match=result?.majorMatch?.matched?result.majorMatch:null;
 return (match?`<div class="majorRequirement"><small>本次专业命中依据</small><b>${esc(match.reason)}</b></div>`:'')+majorRequirements(j,education).map(item=>`<div class="majorRequirement"><small>${esc(item.label)}</small><span>${esc(item.text)}</span></div>`).join('');
}
function render(){
 $('candidates').textContent=filtered.length.toLocaleString();$('shown').textContent=`${filtered.length.toLocaleString()} 个岗位`;
 const start=(page-1)*pageSize;
 $('rows').innerHTML=filtered.slice(start,start+pageSize).map(({j,r},i)=>{
  const reasons=r.checks.filter(c=>c.state!=='pass');
  const clause=c=>`<div class="remarkline ${c.state}"><b>${c.manual?'用户自行确认 · ':''}${c.state==='fail'?'不符':c.state==='pass'?'已匹配':'待核对'} · ${esc(c.kind)}</b><span>【${esc(c.source)}】${esc(c.text)}</span></div>`;
  const facets=resultFacets(j,r);
  const tags=facets.groups.map(g=>`<span class="remarkTag ${g.state}">${esc(g.kind)}${g.state==='review'?' · 待核对':g.state==='fail'?' · 不符':' · 已匹配'}</span>`).join('');
  const remarks=tags+(r.conditions.length?`<details class="remarkDetails"><summary>查看 ${r.conditions.length} 条备注原文</summary>${r.conditions.map(clause).join('')}</details>`:'');
  return `<tr><td data-label="职位 / 来源"><span class="jobtitle">${esc(j.title)}</span><span class="sub">${esc(j.agency)}</span><div class="code">${esc(j.code)} · ${esc(j.sourceName)} · 原表第 ${j.row} 行${j.sources.length>1?` · ${j.sources.length}个来源`:''}</div>${j.versionConflict?'<span class="badge review">疑似版本冲突</span>':''}${facets.three?'<span class="tag">三不限 · 备注另审</span>':r.flags.major?'<span class="tag">专业不限 · 备注另审</span>':''}</td><td data-label="考区 / 系统">${esc(j.city||'未提供')}<span class="sub">${esc(j.sheet)}</span></td><td data-label="要求 / 人数">${esc(j.education||'未提供')}<span class="sub">${esc(j.degree||'学位待核对')} · 录用 ${esc(j.count||'待核对')} 人</span></td><td data-label="对应专业要求" class="majorcell">${majorHTML(j,$('education').value,r)}</td><td data-label="备注与关联文档" class="remarkcell">${remarks||(facets.unknown?'<span class="sub">备注列未识别，需核对原表</span>':'<span class="sub">未发现岗位备注</span>')}${j.notes?.filter(n=>/最低服务|年限|条件|配套/.test(n)).map(n=>`<div class="remarkline review"><b>待核对 · 整表说明</b><span>${esc(n)}</span></div>`).join('')||''}</td><td data-label="判断与资料缺口"><span class="badge ${r.status}">${labels[r.status]}</span><span class="sub">${esc(reasons.filter(c=>!c.remark).map(c=>c.field+': '+c.reason).join('；')||'基础字段无已识别冲突')}</span>${r.conditions.some(c=>c.state!=='pass')?'<span class="sub">另见岗位备注限制</span>':''}</td><td data-label="操作" class="actions"><label class="pkRowSelect"><input type="checkbox" data-pk="${esc(compareKey(j))}" ${pk.selection.ids.has(compareKey(j))?'checked':''} ${r.status==='fail'&&!pk.selection.ids.has(compareKey(j))?'disabled':''}>加入PK</label><button data-detail="${start+i}">查看依据 ↗</button><button data-save="${start+i}">${saved.has(key(j))?'★ 已收藏':'☆ 收藏'}</button></td></tr>`;
 }).join('');
 pk.render();
 $('empty').hidden=filtered.length>0;$('range').textContent=filtered.length?`第 ${start+1}–${Math.min(start+pageSize,filtered.length)} 条`:'0 条结果';
 $('page').textContent=`${page} / ${Math.max(1,Math.ceil(filtered.length/pageSize))}`;$('prev').disabled=page<=1;$('next').disabled=page*pageSize>=filtered.length;$('export').disabled=!filtered.length;
}
function openDialog(title,html){workspace.draft=null;$('dialog').classList.remove('pkDialog');delete $('dialog').dataset.mode;$('dialogtitle').textContent=title;$('dialogbody').innerHTML=html;if(!$('dialog').open)$('dialog').showModal();$('dialog').scrollTop=0;$('dialogbody').scrollTop=0;}
function showEvidence(item,back=false){openDialog(item.j.title,(back?'<button id="backToPK" class="quiet">← 返回PK对比</button>':'')+evidenceHTML(item,majorHTML));}
$('rows').addEventListener('change',e=>{const input=e.target.closest('[data-pk]');if(input)pk.toggle(input.dataset.pk);});
$('rows').addEventListener('click',e=>{
 const detail=e.target.closest('[data-detail]'),save=e.target.closest('[data-save]');
 if(detail){const item=filtered[Number(detail.dataset.detail)];if(item)showEvidence(item);}
 if(save){const j=filtered[Number(save.dataset.save)].j,k=key(j);saved.has(k)?saved.delete(k):saved.add(k);try{localStorage.setItem('jobFavorites',JSON.stringify([...saved]));}catch{}if($('status').value==='saved')apply();else render();}
});
$('schema').onclick=()=>{if(!data)return;openDialog('字段识别与数据来源',`<p class="hint">不同考试表头可能不同。未识别或空白字段会保留为待核对；复杂多层合并表头建议先整理为单行表头。考区不等同于实际工作地点。</p>`+data.sheets.map(s=>`<div class="schema"><b>${esc(s.sheet)} · ${s.count} 岗位</b><p>表头位于第 ${s.headerRow||'—'} 行${s.warning?' · '+esc(s.warning):''}</p><p>识别字段：${esc(Object.values(s.mapping).join(' / '))}</p><p>同时读取的限制列：${esc((s.conditionColumns||[]).join(' / ')||'未识别')}</p><p>缺失基础字段：${esc((s.missing||[]).join(' / ')||'无')}</p></div>`).join(''));};
$('dialog').addEventListener('close',()=>{$('dialog').classList.remove('pkDialog');delete $('dialog').dataset.mode;});
$('close').onclick=()=>$('dialog').close();$('dialog').addEventListener('click',e=>{if(e.target===$('dialog')){const r=$('dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('dialog').close();}});
profileKeys.forEach(k=>$(k).addEventListener('input',()=>{
 if(Object.keys(supplementalAnswers).length){supplementalAnswers={};message('个人档案已更改，补充条款需重新核对。');}
 if(k==='majorName'){
  // Editing the name must never silently retain a different profession's code.
  const picked=$('majorName').value.match(/([ABC]\d{2}(?:\d{2}){0,2})/i);
  $('majorCode').value=picked?picked[1].toUpperCase():'';
  $('majorMode').value=picked||workspace.files.some(f=>f.majorPolicy&&f.role==='catalog'&&f.confirmed)?'code':'name';
 }
 if(k==='majorCode'&&$('majorCode').value)$('majorMode').value='code';
 recompute();
}));$('saveProfile').onchange=recompute;
['query','city','sheet','majorMode','status','sort'].forEach(k=>$(k).addEventListener('input',apply));
$('conditionSearch').addEventListener('input',renderSupplemental);
$('conditionScope').addEventListener('change',apply);
$('supplementalFields').addEventListener('change',e=>{const input=e.target.closest('[data-condition-key]');if(!input)return;const k=input.dataset.conditionKey;if(input.value)supplementalAnswers[k]=input.value;else delete supplementalAnswers[k];recompute();});
$('reset').onclick=()=>{profileKeys.forEach(k=>$(k).value='');supplementalAnswers={};$('saveProfile').checked=false;recompute();};
$('clearLocal').onclick=()=>{saved=new Set();try{localStorage.removeItem('jobFavorites');localStorage.removeItem('jobProfile');}catch{}$('reset').click();$('exportProfile').checked=false;message('已清除本工具保存的个人档案和收藏。资料包及原文件保留。');};
$('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};
$('export').onclick=()=>{
 const headers=['资料包','来源文件与位置','职位代码','单位','职位','考区','录用人数','学历','学位','对应专业（原文及代码）','应届要求','基层经历要求','原始备注','岗位初筛结果','综合判断范围','全部依据与资料缺口','条款逐项核对','来源文件指纹'];
 const withProfile=$('exportProfile').checked;if(withProfile)headers.push('本次筛选档案（主动附带）');
 const p=profile();const records=filtered.map(({j,r})=>{const row=[data.filename,j.sources.map(s=>`${s.archive?s.archive+'/':''}${s.file} / ${s.sheet} / ${s.row}`).join('；'),j.code,j.agency,j.title,j.city,j.count,j.education,j.degree,r.major,j.fresh,j.experience,j.other,labels[r.status],r.qualificationStatus==='pass'?'已提取条件未发现冲突':r.qualificationStatus==='fail'?'已发现明确冲突':'仅供附件初筛，仍有具体条件或资料未覆盖',[...r.checks,...(r.commonChecks||[]),...(r.coverageNotes||[]).map(n=>({...n,state:'说明'}))].map(c=>`${c.field}[${c.state}] ${c.reason}${c.common||c.field==='专业'&&c.source?'【来源】'+c.source+'【原文】'+c.text+(c.url?'【链接】'+c.url:''):''}`).join('；'),r.conditions.map(c=>`${c.manual?'用户自行确认 · ':''}${c.reason}`).join('\n'),j.sources.map(s=>s.fileId).join('；')];if(withProfile)row.push(JSON.stringify(p));return row;});
 const content='\uFEFF'+[headers,...records].map(row=>row.map(csvCell).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='职位初筛结果.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const workspace=new PackageWorkspace(updateDataset);
const pk=new PKController({rows:()=>cache,key:compareKey,isSaved:j=>saved.has(key(j)),openDialog,openEvidence:showEvidence,onChange:render});
new CollectionPanel(workspace);
initPages();
workspace.emit();
