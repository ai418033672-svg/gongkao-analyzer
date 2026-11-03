import {checkConditions,conditionClauses} from './conditions.mjs';
import {matchMajor} from './major-match.mjs';
export const clean = s => String(s ?? '').replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
export const unlimited = s => /^(不限|无|无要求|不限制|不限专业|专业不限|不限制专业|不限应届毕业生|不限工作经历|不要求)$/.test(clean(s));
export const noLimitFlag = s => /^(否|不限|无|无要求|不要求|0|不限应届毕业生|不限工作经历)$/.test(clean(s));
export function majorText(j,education){
 const key={大专:'majorCollege',本科:'majorBachelor',硕士:'majorGrad',博士:'majorGrad'}[education];
 return key ? (j[key] || j.major || '') : [j.major,j.majorCollege,j.majorBachelor,j.majorGrad].filter(Boolean).join('；');
}
export function threeFlags(j,education){
 const keys=education?[majorText(j,education)]:[j.major,j.majorCollege,j.majorBachelor,j.majorGrad].filter(Boolean);
 const remarks=conditionClauses(j).map(s=>clean(s.text)).join('；');
 return {major:keys.length>0&&keys.every(unlimited)&&!/(专业|学科|[ABC]\d{4,6})/.test(remarks),fresh:noLimitFlag(j.fresh)&&!/(应届|届.*毕业)/.test(remarks),experience:noLimitFlag(j.experience)&&!/(工作经历|工作经验|基层经历)/.test(remarks)};
}
export function evaluate(j,p){
 const checks=[];
 const add=(field,state,reason)=>checks.push({field,state,reason});
 function level(field, selected, source, ranks){
  if(!source) return add(field,'review','表中未提供');
  if(unlimited(source)) return add(field,'pass','表中不限');
  if(!selected) return add(field,'review','尚未填写');
  const text=clean(source).replace(/大学专科/g,'大专').replace(/大学本科/g,'本科');
  let found=Object.keys(ranks).filter(k=>text.includes(k));
  if(found.includes('硕士')||found.includes('博士'))found=found.filter(k=>k!=='研究生');
  const allowed=found.some(k=>k===selected || (/以上|及以上/.test(text)&&ranks[selected]>=ranks[k]) || (k==='研究生'&&['硕士','博士'].includes(selected)));
  if(!found.length || /以下|或|同等|全日制|非全日制/.test(text)) return add(field,'review',`需核对原文：${source}`);
  add(field,allowed?'pass':'fail',allowed?`符合表中${source}`:`所填${selected}不符${source}`);
 }
 level('学历',p.education,j.education,{大专:1,本科:2,研究生:3,硕士:3,博士:4});
 level('学位',p.degree,j.degree,{无:0,学士:1,硕士:2,博士:3});
 const mt=majorText(j,p.education);
 const majorMatch=!p.education&&!j.major?{state:'review',reason:'请先选择报考学历，以读取对应专业列',matched:false}:matchMajor(mt,p);
 checks.push({field:'专业',...majorMatch});
 const f=clean(j.fresh);
 if(noLimitFlag(f)) add('应届身份','pass','表中不限应届');
 else if(!f) add('应届身份','review','字段为空或未识别');
 else if(/非应届|仅限往届/.test(f)){
  add('应届身份',!p.fresh?'review':p.fresh==='往届'?'pass':'fail',`职位限定${f}`);
 }
 else if(/应届|毕业生|^是$/.test(f)){
  const graduationYear=p.graduationYear||(p.fresh?.match(/20\d{2}/)||[])[0];
  const requiredYear=(f.match(/20\d{2}/)||[])[0];
  if(p.fresh==='往届') add('应届身份',p.freshException==='需核对公告例外'?'review':'fail',p.freshException==='需核对公告例外'?`职位限定${f}，自报可能适用例外，须核对适用条款`:`职位限定${f}`);
  else if(!p.fresh) add('应届身份','review','尚未填写应届身份');
  else if(requiredYear&&!graduationYear) add('应届身份','review',`限定${f}，须填写毕业年度`);
  else if(requiredYear&&requiredYear!==graduationYear) add('应届身份',p.freshException==='需核对公告例外'?'review':'fail',`限定${f}，所填毕业年度不同${p.freshException==='需核对公告例外'?'，须核对例外适用范围':''}`);
  else add('应届身份','pass',`按自报身份初筛：${f}`);
 }else add('应届身份','review',`特殊招录对象：${f}`);
 const exp=clean(j.experience);
 if(noLimitFlag(exp)) add('基层经历','pass','表中不要求基层经历');
 else if(!exp) add('基层经历','review','字段缺失或为空，不能按不限处理');
 else {
  const n=exp==='是'?j.experienceThreshold:(exp.match(/^(\d+)(?:年|$)/)||[])[1];
  if(n==null) add('基层经历','review',`需核对：${exp}`);
  else if(p.experience==null||p.experience==='') add('基层经历','review','尚未填写');
  else add('基层经历',Number(p.experience)>=Number(n)?'pass':'fail',`要求至少${n}年认可的基层工作经历`);
 }
 if(j.available&&!j.available.includes('other')) add('其他要求','review','未识别其他要求/备注列，请核对原表');
 const conditions=checkConditions(j,p);checks.push(...conditions);
 // Keep sheet-level conditions, including township minimum service periods.
 if(j.notes?.some(n=>/最低服务|年限|条件|配套/.test(n))) add('整表说明','review','工作表包含统一要求，请查看详情');
 const status=checks.some(c=>c.state==='fail')?'fail':checks.some(c=>c.state==='review')?'review':'pass';
 return {status,checks,conditions,flags:threeFlags(j,p.education),major:mt,majorCodeHit:majorMatch.matched,majorMatch};
}
export function csvCell(s){const t=String(s??'');return '"'+(/^[\s]*[=+\-@\t\r]/.test(t)?"'"+t:t).replaceAll('"','""')+'"';}
