import {setupSourceUI,editSources} from './source-ui.mjs';
import {esc} from './workspace.mjs';
import {defaultPeriod,chinaDay,publishedDay,noticeValidity,selectNotices} from './collection-period.mjs';
const $=id=>document.getElementById(id);
const time=s=>s?new Date(s).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'尚未成功检查';
const statusLabels={found:'已发现 · 待下载',downloaded:'资料已下载',partial:'附件未完整下载',error:'下载失败',skipped:'已跳过附件下载'};
export class CollectionPanel{
 constructor(workspace){
  this.workspace=workspace;this.state=null;this.timer=null;this.limit=3;this.importing=false;
  this.settings=null;this.prefQueue=Promise.resolve();this.prefVersion=0;
  for(const id of ['collectPeriod','collectAvailability','collectFrom','collectTo'])$(id).onchange=()=>this.changePeriod();
  $('collectHistory').onclick=()=>this.applyPeriod({...defaultPeriod,period:'all',availability:'all'});
  $('collectDefaults').onclick=()=>this.applyPeriod({...defaultPeriod});
  setInterval(()=>{if(this.state&&this.timeMark()!==this.lastTimeMark)this.render();},60000);
  $('collectorCheck').onclick=()=>this.check();
  $('collectorRefresh').onclick=()=>this.refresh();
  $('collectorSources').onclick=()=>this.editSources();
  $('collectorNotices').onclick=e=>{
   const check=e.target.closest('[data-collect]'),load=e.target.closest('[data-load]');
   if(check)this.check(check.dataset.collect);if(load)this.load(load.dataset.load);
   if(e.target.id==='moreNotices'){this.limit+=20;this.render();}
  };
  setupSourceUI(this);
  this.refresh();
 }
 async request(path,payload){
  const response=await fetch('/api/collector'+path,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('请重启分析器，当前后端不支持采集');
  const result=await response.json();if(!response.ok)throw Error(result.error||'采集接口请求失败');return result;
 }
 async refresh(){
  clearTimeout(this.timer);
  try{this.state=await this.request('');if(!this.settings)this.showPeriod(this.state.settings||defaultPeriod);this.render();if(this.state.job?.status==='running')this.timer=setTimeout(()=>this.refresh(),1500);}
  catch(e){$('collectorStatus').textContent=e.message;}
 }
 async check(noticeId){
  if($('collectFilterError').textContent)return;
  if(this.state?.job?.status==='running')return;
  $('collectorCheck').disabled=true;
  try{await this.prefQueue;this.state=await this.request('/check',noticeId?{noticeId}:{});this.render();this.timer=setTimeout(()=>this.refresh(),1000);}
  catch(e){$('collectorStatus').textContent=e.message;$('collectorCheck').disabled=false;}
 }
 timeMark(){return JSON.stringify([chinaDay(),...(this.state?.notices||[]).map(n=>noticeValidity(n).state)]);}
 showPeriod(s){this.settings={...defaultPeriod,...s};$('collectPeriod').value=this.settings.period;$('collectAvailability').value=this.settings.availability;$('collectFrom').value=this.settings.from;$('collectTo').value=this.settings.to;$('collectDates').hidden=this.settings.period!=='custom';}
 changePeriod(){
  const s={period:$('collectPeriod').value,availability:$('collectAvailability').value,from:$('collectFrom').value,to:$('collectTo').value};
  if(s.period==='custom'&&!s.from&&!s.to){s.to=chinaDay();s.from=new Date(Date.parse(s.to+'T00:00:00Z')-29*86400000).toISOString().slice(0,10);}
  if(s.from&&s.to&&s.from>s.to){$('collectFilterError').textContent='起始日期不能晚于结束日期';return;}
  if(s.period==='custom'&&!s.from&&!s.to){$('collectFilterError').textContent='请至少填写一个日期';return;}
  this.applyPeriod(s);
 }
 applyPeriod(s){
  this.showPeriod(s);this.limit=3;this.render();$('collectFilterError').textContent='';const version=++this.prefVersion;
  this.prefQueue=this.prefQueue.catch(()=>{}).then(async()=>{try{const result=await this.request('/settings',{settings:s});if(version===this.prefVersion){this.state=result;this.render();}}catch(e){$('collectFilterError').textContent='时间设置未保存：'+e.message;throw e;}});
  this.prefQueue.catch(()=>{});
 }
 render(){
  const s=this.state;if(!s)return;const running=s.job?.status==='running';
  this.lastTimeMark=this.timeMark();
  const selectedVersions=new Map([...document.querySelectorAll('[data-version]')].map(el=>[el.dataset.version,el.value]));
  const pendingOpen=$('uncertainDates')?.open;
  $('collectorCheck').disabled=running;$('collectorSources').disabled=running;$('collectorLinkSubmit').disabled=running;
  $('collectorStatus').textContent=s.job?`${s.job.message}${s.job.finishedAt?' · '+time(s.job.finishedAt):''}`:'还未联网检查。点击“联网检查更新”开始；默认仅启用广东公务员录用栏目。';
  $('collectorSourceStatus').innerHTML=s.sources.map(src=>`<div class="collectorSource"><b>${esc(src.name)}</b><span>${src.enabled?'已启用':'未启用'} · 最近成功：${esc(time(src.lastSuccessAt))}</span>${src.error?`<span class="errorText">${esc(src.error)}</span>`:''}</div>`).join('');
  $('collectorLogs').textContent=(s.job?.logs||[]).map(l=>`${time(l.time)} ${l.error?'失败 · ':''}${l.text}`).join('\n')||'暂无检查记录';
  const settings=this.settings||s.settings||defaultPeriod,notices=selectNotices(s.notices,settings);
  const uncertain=n=>noticeValidity(n).state==='unknown'||settings.period!=='all'&&!publishedDay(n.publishedAt);
  const pending=notices.filter(uncertain),known=notices.filter(n=>!uncertain(n));
  $('collectCount').textContent=`当前范围 ${notices.length} 条，其中时间待核对 ${pending.length} 条；隐藏 ${s.notices.length-notices.length} 条历史或不匹配记录。`;
  const renderNotice=n=>{
   const versions=n.revisions||[];const latest=versions.at(-1);
   const validity=noticeValidity(n),windows=n.timing?.windows||[];
   const deadline=w=>w.endPrecision==='day'?w.end.slice(0,10)+'（未注明时刻）':time(w.end);
   const timing=`<div class="noticeTiming"><span class="badge ${validity.state==='closed'||validity.state==='stage'?'expired':validity.state==='unknown'?'review':''}">${validity.label}</span>${windows.map(w=>`<span>${w.start?'报名开始：'+esc(time(w.start)):''}${w.start&&w.end?' · ':''}${w.end?'截止：'+esc(deadline(w)):''}</span>`).join('')}${windows.length?`<details><summary>查看报名时间原文</summary>${windows.map(w=>`<p>${esc(w.evidence)}</p>`).join('')}${n.timing?.notes?.length?`<p class="hint">${esc(n.timing.notes.join('；'))}</p>`:''}</details>`:'<span class="sub">未识别明确报名起止，不能据此判断可报名</span>'}${!publishedDay(n.publishedAt)?'<span class="sub">公告发布日期待核对</span>':''}</div>`;
   return `<article class="noticeRow"><div><a href="${esc(n.url)}" target="_blank" rel="noreferrer">${esc(n.title)} ↗</a><span class="sub">${esc(n.sourceName)}${n.publishedAt?' · 官网发布时间 '+esc(n.publishedAt):''} · ${esc(statusLabels[n.status]||n.status)} · ${versions.length} 个本机版本</span>${timing}${n.skipReason?`<span class="sub">${esc(n.skipReason)}</span>`:''}<span class="sub">最近核对：${esc(time(n.lastCheckedAt))}${n.change?' · '+esc(n.change):''}</span>${n.error?`<p class="errorText">${esc(n.error)}</p>`:''}${latest?.errors.length?`<p class="errorText">${esc(latest.errors.join('；'))}</p>`:''}${latest?`<details><summary>最新版本：已下载 ${latest.files.length} 份文件</summary>${latest.files.map(f=>`<div class="sub">${esc(f.filename)} · ${(f.size/1024).toFixed(1)} KB · 指纹 ${f.sha.slice(0,12)} · <a href="/api/collector/file?noticeId=${n.id}&amp;revisionId=${latest.id}&amp;sha=${f.sha}">保存文件</a></div>`).join('')}<p class="hint">网页中的其他公告链接不会递归下载；附件中的导航链接、资料完整性与更正关系仍需核对。</p></details>`:''}</div><div class="noticeActions"><button class="quiet" data-collect="${n.id}" ${running?'disabled':''}>${versions.length?'强制复查正文与附件':'下载正文与附件'}</button>${versions.length?`<label>选择本机版本<select data-version="${n.id}">${versions.map((r,i)=>`<option value="${r.id}" ${i===versions.length-1?'selected':''}>版本 ${i+1} · ${esc(time(r.collectedAt))}</option>`).reverse().join('')}</select></label><button class="quiet" data-load="${n.id}" ${this.importing||this.workspace.busy?'disabled':''}>带入职位筛选</button>`:''}</div></article>`;
  };
  $('collectorNotices').innerHTML=known.slice(0,this.limit).map(renderNotice).join('')+(pending.length?`<details id="uncertainDates" class="uncertainNotices" ${settings.availability==='unknown'||pendingOpen?'open':''}><summary>时间待核对 · ${pending.length} 条（不代表可以报名）</summary>${pending.slice(0,this.limit).map(renderNotice).join('')}</details>`:'')+(!notices.length?'<p class="hint">当前范围没有匹配的公告。可以调整时间范围或查看历史；未检查的来源仍可点击“联网检查更新”。</p>':'')+(known.length>this.limit||pending.length>this.limit?`<button id="moreNotices" class="quiet">显示更多（当前范围共 ${notices.length} 条）</button>`:'');
  for(const select of document.querySelectorAll('[data-version]')){const old=selectedVersions.get(select.dataset.version);if([...select.options].some(o=>o.value===old))select.value=old;}
 }
 async load(id){
  if(this.importing||this.workspace.busy)return;
  const revisionId=document.querySelector(`[data-version="${id}"]`)?.value;
  this.importing=true;this.workspace.setBusy(true);this.render();
  let outcome='';
  try{
   $('collectorStatus').textContent='正在从本机文件解析所选版本…';
   const result=await this.request('/import',{noticeId:id,revisionId});
   const duplicates=this.workspace.add(result.files);
   this.workspace.emit(`已添加 ${result.files.length-duplicates} 份采集文件，重复跳过 ${duplicates} 份。可读文件已自动参与筛选。${result.warnings?.length?'部分附件未下载，请查看采集记录。':''}`);
   outcome='已带入职位筛选。原始下载及旧版本仍保存在本机。';
   location.hash='jobs';
  }catch(e){outcome='导入失败：'+e.message;}
  finally{this.importing=false;this.workspace.setBusy(false);this.render();$('collectorStatus').textContent=outcome;}
 }
 editSources(){editSources(this);}
}
