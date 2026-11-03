import {esc,download} from './workspace.mjs';
import {csvCell} from './rules.mjs';
import {ComparisonSelection,MAX_COMPARE} from './comparison.mjs';
import {comparisonRows,resultLabels,groupCommon} from './presentation.mjs';
import {commonCards} from './evidence.mjs';
const $=id=>document.getElementById(id);
export class PKController{
 constructor({rows,key,isSaved,openDialog,openEvidence,onChange}){
  Object.assign(this,{getRows:rows,key,isSaved,openDialog,openEvidence,onChange});this.selection=new ComparisonSelection();this.onlyDifferences=false;this.feedback='';
  $('compareOpen').onclick=()=>this.showCompare();$('compareFromSaved').onclick=()=>this.showPicker();
  $('compareTray').onclick=e=>{const remove=e.target.closest('[data-pk-remove]');if(remove){this.selection.remove(remove.dataset.pkRemove);this.feedback='';this.onChange();}if(e.target.id==='compareRun')this.showCompare();if(e.target.id==='compareClear'){this.selection.clear();this.feedback='';this.onChange();}};
  $('dialogbody').addEventListener('change',e=>{
   if(e.target.dataset.pkPick){this.toggle(e.target.dataset.pkPick);this.drawPicker();}
   if(e.target.id==='pkDifferences'){this.onlyDifferences=e.target.checked;this.showCompare();}
  });
  $('dialogbody').addEventListener('click',e=>{
   if(e.target.id==='pkStart'||e.target.id==='backToPK')this.showCompare();
   if(e.target.id==='pkChooseSaved')this.showPicker();
   if(e.target.id==='pkClosePicker')$('dialog').close();
   if(e.target.id==='pkExport')this.export();
   const detail=e.target.closest('[data-pk-detail]'),remove=e.target.closest('[data-pk-remove-column]');
   if(detail){const row=this.getRows().find(x=>this.key(x.j)===detail.dataset.pkDetail);if(row)this.openEvidence(row,true);}
   if(remove){this.selection.remove(remove.dataset.pkRemoveColumn);this.onChange();if(this.selected().length>=2)this.showCompare();else{$('dialog').close();this.feedback='至少选择2个岗位后开始PK';this.render();}}
  });
 }
 selected(){return this.selection.rows(this.getRows(),this.key);}
 toggle(id){
  const row=this.getRows().find(x=>this.key(x.j)===id),result=this.selection.toggle(id,row);this.feedback=result.ok?'':result.reason;this.onChange();return result;
 }
 render(){
  this.selection.sync(this.getRows(),this.key);const items=this.selected(),n=items.length;
  document.body.classList.toggle('hasComparisons',Boolean(n));
  $('compareOpen').textContent=`PK对比（${n}）`;$('compareOpen').disabled=n<2;
  $('compareTray').hidden=!n;
  $('compareTray').innerHTML=`<div><strong>已选 ${n}/${MAX_COMPARE} 个岗位</strong><span class="sub">跨页和切换筛选会保留选择</span></div><div class="compareChips">${items.map(({j,r})=>`<span class="compareChip ${r.status==='fail'?'invalid':''}">${esc(j.title)} · ${esc(j.code)}${r.status==='fail'?' · 当前已排除':''}<button data-pk-remove="${esc(this.key(j))}" aria-label="移除${esc(j.title)}">×</button></span>`).join('')}</div><div class="compareTrayActions"><button id="compareRun" class="quiet" ${n<2?'disabled':''}>开始PK</button><button id="compareClear" class="text">清空选择</button></div>${this.feedback?`<p class="compareFeedback" role="status">${esc(this.feedback)}</p>`:''}`;
 }
 showPicker(){
  this.openDialog('从收藏中挑选PK岗位','');$('dialog').dataset.mode='pkPicker';this.drawPicker();
 }
 drawPicker(){
  const favorites=this.getRows().filter(x=>this.isSaved(x.j));
  $('dialogbody').innerHTML=`<p class="hint">仅展示当前资料包的收藏。可同时选${MAX_COMPARE}个；待补信息会保留标记，已排除的岗位不能新增。</p><div class="pkPicker">${favorites.map(({j,r})=>{const id=this.key(j),checked=this.selection.ids.has(id);return `<label class="pkPick"><input type="checkbox" data-pk-pick="${esc(id)}" ${checked?'checked':''} ${r.status==='fail'&&!checked?'disabled':''}><span><b>${esc(j.title)}</b><span class="sub">${esc(j.agency)} · ${esc(j.code)} · ${esc(j.city||'地区未提供')}</span><span class="badge ${r.status}">${resultLabels[r.status]}</span></span></label>`;}).join('')||'<p>当前资料包没有收藏岗位。先在清单收藏或直接勾选PK。</p>'}</div><p id="pkPickError" class="errorText" role="status">${esc(this.feedback)}</p><div class="pkToolbar"><button id="pkStart" class="quiet" ${this.selected().length<2?'disabled':''}>开始PK（${this.selected().length}）</button><button id="pkClosePicker" class="text">返回清单继续选择</button></div>`;
 }
 showCompare(){
  const items=this.selected();if(items.length<2){this.feedback='至少选择2个岗位后开始PK';this.render();return;}
  const rows=comparisonRows(items),shown=this.onlyDifferences?rows.filter(r=>r.different):rows;
  const common=groupCommon(items.flatMap(x=>x.r.commonChecks||[]));
  this.openDialog(`岗位PK · ${items.length} 个岗位`,`<div class="pkToolbar"><label class="check"><input id="pkDifferences" type="checkbox" ${this.onlyDifferences?'checked':''}>只看差异</label><button id="pkChooseSaved" class="quiet">从收藏继续挑选</button><button id="pkExport" class="quiet">导出对比 CSV</button></div><p class="hint">先对比筛选结果与岗位原始要求。差异项已着色；公告关键补充列在最后，原文按需展开。</p><div class="pkScroll"><table class="pkTable" style="min-width:${135+items.length*250}px"><thead><tr><th scope="col">对比项</th>${items.map(({j,r})=>`<th scope="col"><strong>${esc(j.title)}</strong><span class="sub">${esc(j.agency)} · ${esc(j.code)}${this.isSaved(j)?' · ★ 已收藏':''}</span><span class="badge ${r.status}">${resultLabels[r.status]}</span><div class="pkHeadActions"><button class="text" data-pk-detail="${esc(this.key(j))}">查看依据</button><button class="text" data-pk-remove-column="${esc(this.key(j))}">移除</button></div></th>`).join('')}</tr></thead><tbody>${shown.map(row=>`<tr class="${row.different?'pkDifferent':''}"><th scope="row">${row.label}</th>${row.values.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${!shown.length?'<p class="hint">这些岗位当前没有可显示的差异。</p>':''}<section class="pkSupplements"><h3 class="detailhead">最后补充：公告中的关键条件</h3><details><summary>查看适用补充及原文（${common.length}项，已合并重复）</summary>${commonCards(items.flatMap(x=>x.r.commonChecks||[]))}</details></section>`);
  $('dialog').classList.add('pkDialog');$('dialog').dataset.mode='pk';
 }
 export(){
  const items=this.selected(),rows=comparisonRows(items).filter(r=>!this.onlyDifferences||r.different);
  const records=[['对比项',...items.map(({j,r})=>`${j.title}（${j.code}）｜${resultLabels[r.status]}`)],...rows.map(r=>[r.label,...r.values])];
  download('岗位PK对比.csv','\uFEFF'+records.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
 }
}
