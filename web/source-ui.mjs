import {esc} from './workspace.mjs';
import {openMaterials} from './materials-ui.mjs';
const $=id=>document.getElementById(id);
const fields=[['province','省 / 自治区 / 直辖市'],['city','城市（选填）'],['publisher','发布机构'],['examType','考试类型'],['publicationMethod','发布方式'],['note','维护备注']];
export function setupSourceUI(panel){
 $('collectorCatalog').onclick=()=>catalog(panel);
 $('collectorMaterials').onclick=()=>openMaterials(panel);
 $('collectorLinkForm').onsubmit=async e=>{
  e.preventDefault();if(panel.state?.job?.status==='running')return;
  $('collectorLinkSubmit').disabled=true;
  try{await panel.prefQueue;panel.state=await panel.request('/link',{url:$('collectorLink').value.trim(),mode:$('collectorLinkMode').value});panel.render();panel.timer=setTimeout(()=>panel.refresh(),1000);}
  catch(err){$('collectorStatus').textContent=err.message;}
  finally{$('collectorLinkSubmit').disabled=panel.state?.job?.status==='running';}
 };
}
export function editSources(panel){
 if(!panel.state)return;panel.workspace.draft=null;
 const editing=panel.state.sources.map(s=>({...s}));
 $('dialogtitle').textContent='我的公告来源';
 $('dialogbody').innerHTML='<p class="hint">最多保存200个来源，同时启用10个。每次联网更新仅检查已启用的栏目；粘贴栏目链接可以单独检查。目录文件仅包含来源配置，不包含报考档案或下载资料。导入的新来源默认停用，同网址保留已有配置。</p><div class="packageActions"><button id="sourceExport" class="quiet">导出来源目录</button><label class="quiet">导入目录文件<input id="sourceImport" type="file" accept=".json" style="max-width:200px"></label></div><div id="sourceEditor"></div><button id="addCollectorSource" class="quiet">＋ 添加来源</button><button id="saveCollectorSources" class="quiet">保存来源</button><p id="sourceError" class="errorText" role="status"></p>';
 const draw=()=>{$('sourceEditor').innerHTML=editing.map((s,i)=>`<div class="sourceEdit"><label class="check"><input type="checkbox" data-key="enabled" data-i="${i}" ${s.enabled?'checked':''}>随联网更新检查</label>${[['name','名称'],['url','公告栏目网址'],['keywords','标题关键词（逗号分隔）'],...fields].map(([k,label])=>`<label>${label}<input data-key="${k}" data-i="${i}" value="${esc(s[k]||'')}"></label>`).join('')}<button class="text" data-remove="${i}">移除来源</button></div>`).join('');};
 $('sourceEditor').oninput=e=>{const k=e.target.dataset.key;if(k)editing[Number(e.target.dataset.i)][k]=k==='enabled'?e.target.checked:e.target.value;};
 $('sourceEditor').onclick=e=>{if(e.target.dataset.remove!==undefined){editing.splice(Number(e.target.dataset.remove),1);draw();}};
 $('addCollectorSource').onclick=()=>{if(editing.length>=200)return $('sourceError').textContent='最多保存200个来源';editing.push({name:'',url:'',keywords:'公告,招聘,录用,招考,更正,延期',enabled:false});draw();};
 $('saveCollectorSources').onclick=async()=>{try{panel.state=await panel.request('/sources',{sources:editing});$('dialog').close();panel.render();}catch(e){$('sourceError').textContent=e.message;}};
 $('sourceExport').onclick=()=>{
  const blob=new Blob([JSON.stringify({format:'gongkao-source-book',version:1,sources:editing},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='公考来源目录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 $('sourceImport').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>1024*1024)throw Error('目录文件需在1MB以内');panel.state=await panel.request('/source-pack',JSON.parse(await file.text()));$('dialog').close();panel.render();editSources(panel);}catch(err){$('sourceError').textContent=err.message;}};
 draw();$('dialog').showModal();
}
async function catalog(panel){
 panel.workspace.draft=null;$('dialogtitle').textContent='省市信息来源目录';
 $('dialogbody').innerHTML='<p role="status">读取来源目录…</p>';$('dialog').showModal();
 try{
  const data=await panel.request('/catalog'),entries=data.entries;
  $('dialogbody').innerHTML=`<p class="hint">${esc(data.coverage)}。导航入口需进入具体招考栏目；市级来源可在“管理来源”增补并分享目录文件。</p><label>搜索省市、机构或考试类型<input id="catalogSearch" placeholder="如：广东、南京、事业单位"></label><div id="catalogRows"></div><p id="catalogStatus" role="status"></p>`;
  const draw=()=>{
   const q=$('catalogSearch').value.trim().toLowerCase(),filtered=entries.filter(s=>[s.province,s.city,s.name,s.examType,s.publicationMethod].join(' ').toLowerCase().includes(q));
   $('catalogRows').innerHTML=filtered.map(s=>{const i=entries.indexOf(s),added=panel.state.sources.some(x=>x.url===s.url);return `<article class="noticeRow"><div><b>${esc(s.name)}</b><span class="sub">${esc([s.province,s.city,s.examType].filter(Boolean).join(' · '))}</span><p>${esc(s.publicationMethod)}</p><span class="sub">${s.fetchMode==='http'?'可尝试直接采集':s.fetchMode==='browser'?'需浏览器加载':'官网导航入口'} · ${esc(s.verification)} · 收录 ${esc(s.checkedAt)}</span><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.url)} ↗</a></div>${s.fetchMode==='http'?`<button class="quiet" data-add="${i}" ${added||panel.state.job?.status==='running'?'disabled':''}>${added?'已加入':'加入我的来源'}</button>`:''}</article>`;}).join('')||'<p>没有匹配入口，可在“管理来源”添加当地栏目。</p>';
  };
  $('catalogSearch').oninput=draw;
  $('catalogRows').onclick=async e=>{if(e.target.dataset.add===undefined)return;const s=entries[Number(e.target.dataset.add)];try{panel.state=await panel.request('/source-pack',{format:'gongkao-source-book',version:1,sources:[s]});panel.render();draw();$('catalogStatus').textContent='已加入，默认停用；可在管理来源启用，或粘贴该栏目链接单独抓取。';}catch(err){$('catalogStatus').textContent=err.message;}};
  draw();
 }catch(e){$('dialogbody').textContent=e.message;}
}
