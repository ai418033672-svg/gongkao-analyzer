export const resultLabels={pass:'岗位附件匹配',review:'岗位条件待补充',fail:'已排除'};
const tidy=s=>String(s||'').replace(/\s+/g,' ').trim();
export function shortReason(check,limit=150){
 let text=tidy(check.reason||check.text||'').replace(/^【[^】]*】/,'');
 text=text.replace(/（暂不能自动判断，请核对完整条款）|暂不能自动判断，请核对完整条款/g,'');
 return text.length>limit?text.slice(0,limit)+'…':text;
}
export function commonHeadline(c){
 if(!c.unparsed)return c.field||c.kind||'补充条件';
 let text=tidy(c.text).replace(/^.*?[？?]\s*/,'').replace(/^答[:：]\s*/,'');
 const ages=[...new Set(text.match(/\d+周岁(?:以上|以下)|\d+年\d+月(?:以后|以前)/g)||[])];
 if(ages.length)return '年龄条件：'+ages.join('、')+(/放宽|除|但/.test(text)?'（含身份例外）':'');
 const levels=[...new Set(text.match(/博士|硕士|本科|大专|学士/g)||[])];
 if(levels.length&&/学历|学位|毕业/.test(text))return '学历 / 学位：涉及'+levels.join('、')+(/除|但|定向|在职|留学/.test(text)?'，有适用对象限定':'');
 if(/户籍|生源|居住证/.test(text))return '户籍 / 生源：'+text.slice(0,65)+(text.length>65?'…':'');
 if(/基层|工作经历/.test(text))return '经历计算：'+text.slice(0,65)+(text.length>65?'…':'');
 return (c.field||c.kind||'补充条件')+'：'+text.slice(0,65)+(text.length>65?'…':'');
}
export function groupCommon(checks=[]){
 const map=new Map();
 for(const c of checks){
  const id=c.id||c.source+'|'+c.text;
  const entry=map.get(id)||{...c,messages:new Map(),state:'pass'};
  if(c.state==='fail'||c.state==='review'&&entry.state!=='fail')entry.state=c.state;
  if(!c.unparsed)entry.messages.set(shortReason(c),c.state);
  map.set(id,entry);
 }
 return [...map.values()];
}
export function resultSummary(r){
 const own=(r.checks||[]).filter(c=>!c.common);
 return {label:resultLabels[r.status]||'尚未筛选',passed:own.filter(c=>c.state==='pass'),failed:(r.checks||[]).filter(c=>c.state==='fail'),pending:own.filter(c=>c.state==='review')};
}
export function comparisonRows(items){
 const summary=r=>{const s=resultSummary(r);return `${s.label}\n${s.passed.length}项匹配 · ${s.failed.length}项冲突 · ${s.pending.length}项信息待补`;};
 const source=j=>(j.sources||[]).map(s=>`${s.file} / ${s.sheet} / 第${s.row}行`).join('\n')||`${j.sourceName||''} / ${j.sheet||''} / 第${j.row||''}行`;
 const lines=checks=>[...new Set(checks.map(c=>(c.field||c.kind)+'：'+shortReason(c)))].join('\n')||'无';
 const definitions=[
  ['筛选结果',({r})=>summary(r)],['招录单位',({j})=>j.agency],['职位代码',({j})=>j.code],['考区 / 系统',({j})=>[j.city,j.sheet].filter(Boolean).join(' / ')],['录用人数',({j})=>j.count],
  ['对应专业要求',({r})=>r.major],['学历 / 学位',({j})=>`学历：${j.education||'未提供'} / 学位：${j.degree||'未提供'}`],['应届要求',({j})=>j.fresh==='否'?'不限应届（原表：否）':j.fresh==='是'?'限应届（原表：是）':j.fresh],['基层经历要求',({j})=>j.experience==='否'?'不要求基层经历（原表：否）':j.experience==='是'&&j.experienceThreshold?`至少${j.experienceThreshold}年（原表：是）`:j.experience],
  ['岗位备注与特殊限制',({j})=>j.other||'备注为空'],['信息待补',({r})=>lines(resultSummary(r).pending)],['明确冲突',({r})=>lines(resultSummary(r).failed)],
  ['原始信息来源',({j})=>source(j)],
  ['公告关键补充',({r})=>groupCommon(r.commonChecks).filter(c=>!c.unparsed).map(c=>commonHeadline(c)+'：'+[...c.messages.keys()].join('；')).join('\n')||'无已结构化的适用补充条件']
 ];
 return definitions.map(([label,get])=>{const values=items.map(item=>tidy(get(item))?String(get(item)):'未提供');return {label,values,different:new Set(values.map(v=>v.replace(/\s/g,''))).size>1};});
}
