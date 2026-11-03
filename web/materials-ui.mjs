import {esc} from './workspace.mjs';
const $=id=>document.getElementById(id);
export async function openMaterials(panel){
 panel.workspace.draft=null;$('dialogtitle').textContent='勾选省考资料';
 $('dialogbody').textContent='读取资料清单…';$('dialog').showModal();
 try{
  const data=await panel.request('/materials'),entries=data.entries;
  const groups=[...new Set(entries.map(e=>e.province+' · '+e.year))];
  const selected=new Set();
  $('dialogbody').innerHTML=`<p class="hint">${esc(data.coverage)}</p><p class="hint">已有完整资料直接使用本机文件；只下载未完成或缺失项。按当前有效期设置抓取，不会同时检查其他省份。固定清单不自动发现后续更正，请另行检查官方栏目。</p><label>省份 / 年度<select id="materialGroup">${groups.map(g=>`<option>${esc(g)}</option>`).join('')}</select></label><div class="packageActions"><button id="materialAll" class="quiet">全选本组</button><button id="materialNone" class="text">清空选择</button></div><p id="materialMessage" role="status"></p><div class="packageActions"><button id="materialFetch" class="quiet">抓取所选资料</button><button id="materialLoad" class="quiet">将所选本机资料带入筛选</button></div><div id="materialRows"></div>`;
  const visible=()=>entries.filter(e=>e.province+' · '+e.year===$('materialGroup').value);
  const update=()=>{
   const chosen=entries.filter(e=>selected.has(e.id));
   $('materialFetch').disabled=!chosen.length||panel.state?.job?.status==='running';
   $('materialLoad').disabled=!chosen.length||chosen.some(e=>!e.downloaded)||panel.workspace.busy;
   $('materialMessage').textContent=`已选 ${chosen.length} 项，其中 ${chosen.filter(e=>e.downloaded).length} 项已在本机。`;
  };
  const draw=()=>{
   $('materialRows').innerHTML=visible().map(e=>`<article class="noticeRow"><div><label class="check"><input type="checkbox" data-material="${e.id}" ${selected.has(e.id)?'checked':''}>${esc(e.title)}</label><span class="sub">${e.downloaded?'已在本机 · 无需再次下载':'未完成下载'}${e.city?' · '+esc(e.city):''}</span>${e.note?`<p class="hint">${esc(e.note)}</p>`:''}<a href="${esc(e.url)}" target="_blank" rel="noreferrer">官方资料页 ↗</a></div></article>`).join('');update();
  };
  $('materialGroup').onchange=()=>{selected.clear();draw();};
  $('materialRows').onchange=e=>{const id=e.target.dataset.material;if(!id)return;e.target.checked?selected.add(id):selected.delete(id);update();};
  $('materialAll').onclick=()=>{visible().forEach(e=>selected.add(e.id));draw();};
  $('materialNone').onclick=()=>{selected.clear();draw();};
  $('materialFetch').onclick=async()=>{
   $('materialFetch').disabled=true;
   try{
    await panel.prefQueue;panel.state=await panel.request('/materials',{ids:[...selected]});
    $('dialog').close();panel.render();clearTimeout(panel.timer);panel.timer=setTimeout(()=>panel.refresh(),1000);
   }catch(e){update();$('materialMessage').textContent=e.message;}
  };
  $('materialLoad').onclick=async()=>{
   panel.workspace.setBusy(true);$('materialLoad').disabled=true;let added=0,duplicates=0;
   try{
    for(const item of entries.filter(e=>selected.has(e.id))){
     const notice=panel.state.notices.find(n=>n.id===item.noticeId),revision=notice?.revisions.at(-1);
     if(!revision)throw Error('本机记录已变化，请关闭后重新打开资料清单');
     const result=await panel.request('/import',{noticeId:item.noticeId,revisionId:revision.id});
     const skipped=panel.workspace.add(result.files);duplicates+=skipped;added+=result.files.length-skipped;
    }
    panel.workspace.emit(`已带入 ${added} 份资料，重复跳过 ${duplicates} 份。`);$('dialog').close();location.hash='jobs';
   }catch(e){$('materialMessage').textContent=`${e.message}；本批已添加 ${added} 份，可重试，重复资料会跳过。`;}
   finally{panel.workspace.setBusy(false);panel.render();update();}
  };
  draw();
 }catch(e){$('dialogbody').textContent=e.message;}
}
