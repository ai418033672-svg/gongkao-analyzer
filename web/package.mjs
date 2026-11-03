import {evaluate,clean,unlimited} from './rules.mjs';
import {policyForDocuments,validateMajorPolicy} from './major-policy.mjs';
import {extractDocumentRules,evaluateDocumentRules,ruleApplies} from './document-rules.mjs';
export const roles={jobs:'职位表',notice:'主公告',local:'地市公告/简章',special:'系统专项简章',guide:'报考指南/政策问答',catalog:'专业目录',correction:'补充/更正',reference:'参考资料（不作资格规则）',supplement:'其他条件资料',unknown:'用途未识别'};
export const contextKey=p=>JSON.stringify([p.province,p.year,p.examType]);
export function contextReady(p){return Boolean(p.province&&/^20\d{2}$/.test(p.year)&&p.examType);}
export function fileConfirmed(f,p){return (contextReady(p)||f.applicationMode==='auto')&&f.confirmed&&f.contextKey===contextKey(p)&&f.status!=='error';}
export function contextMismatch(f,p){return [f.context?.province&&f.context.province!==p.province?'省份不同':'',f.context?.year&&f.context.year!==p.year?'年度不同':''].filter(Boolean).join('、');}
export function applies(f,j){
 const s=f.scope||{};
 const target={police:/公安|警察/,court:/法院|法官/,procurator:/检察/,justice:/司法行政|监狱|戒毒/}[f.autoTarget];
 if(target&&!target.test([j.agency,j.title,j.sheet,j.type].join(' ')))return false;
 if(s.city&&s.city!==j.city)return false;
 if(s.system&&s.system!==j.sheet)return false;
 const codes=(s.codes||'').split(/[,，;；\s]+/).filter(Boolean);
 return !codes.length||codes.includes(j.code);
}
const facts=j=>JSON.stringify(Object.fromEntries(['agency','title','code','city','count','education','degree','major','majorGrad','majorBachelor','majorCollege','fresh','experience','experienceThreshold','other','notes','type','description','conditionSources','raw'].map(k=>[k,j[k]])));
export function buildDataset(files,pack){
 const jobs=[],sheets=[],identical=new Map(),identities=new Map();let merged=0;
 for(const f of files.filter(f=>f.kind==='jobs'&&f.role==='jobs'&&fileConfirmed(f,pack))){
  for(const s of f.sheets||[])sheets.push({...s,file:f.filename,fileId:f.id});
  for(const original of f.jobs||[]){
   const signature=facts(original),identity=JSON.stringify([original.agency,original.code,original.title,original.city]);
   const source={fileId:f.id,file:f.filename,archive:f.archive||'',sheet:original.sheet,row:original.row};
   if(identical.has(signature)){identical.get(signature).sources.push(source);merged++;continue;}
   const j={...original,id:f.id+':'+original.id,sourceName:f.filename,sourceFileId:f.id,sources:[source],identity};
   identical.set(signature,j);jobs.push(j);
   if(!identities.has(identity))identities.set(identity,[]);identities.get(identity).push(j);
  }
 }
 for(const group of identities.values())if(group.length>1)for(const j of group)j.versionConflict=true;
 return {filename:pack.name||`${pack.province||'未指定'}${pack.year||''}资料包`,jobs,sheets,total:jobs.length,recruits:jobs.reduce((n,j)=>n+(/^\d+$/.test(j.count)?Number(j.count):0),0),merged};
}
export function createPackageEvaluator(profile,files,pack){
 const groups=new Map();
 return j=>evaluateInPackage(j,profile,files,pack,groups);
}
export function evaluateInPackage(j,profile,files,pack,groups=new Map()){
 const applicable=files.filter(f=>f.kind!=='jobs'&&applies(f,j));
 const groupKey=JSON.stringify([j.datasetId,...applicable.map(f=>files.indexOf(f))]);
 let shared=groups.get(groupKey);
 if(!shared){
  const docs=applicable.filter(f=>f.kind==='document'&&fileConfirmed(f,pack)&&f.role!=='reference');
  const revision=JSON.stringify([contextKey(pack),...docs.map(f=>[f.id,f.role,f.scope,f.autoTarget,f.selectedBlockIds,f.coverageConfirmed,f.applicationMode])]);
  shared={docs,revision,majorPolicy:policyForDocuments(docs,pack),extracted:extractDocumentRules(docs,pack),commonGroups:new Map()};
  groups.set(groupKey,shared);
 }
 const {docs,revision}=shared;
 const combined={...j,datasetId:j.datasetId+'|'+revision};
 const p={...profile,majorPolicy:shared.majorPolicy,examYear:pack.year,examProvince:pack.province,examCity:j.city,professionalScheme:pack.province==='广东'?'广东代码':'其他目录'};
 const r=evaluate(combined,p);
 const rowText=[j.title,j.type,j.agency,j.sheet].join(' ');
 const commonKey=JSON.stringify([shared.extracted.rules.map(rule=>ruleApplies(rule,j)),/特警/.test(rowText),/防暴突击/.test(rowText)]);
 if(!shared.commonGroups.has(commonKey))shared.commonGroups.set(commonKey,evaluateDocumentRules(shared.extracted,p,j,combined.datasetId));
 r.commonChecks=shared.commonGroups.get(commonKey);r.informationCount=shared.extracted.information;
 r.jobStatus=r.status;r.coverageNotes=[];
 for(const c of r.commonChecks.filter(c=>c.state==='fail'))r.checks.push({...c,field:'共性·'+c.field,remark:false});
 const add=(field,reason)=>r.coverageNotes.push({field,reason,incomplete:true});
 const rowIssue=(field,reason)=>r.checks.push({field,state:'review',reason});
 if(!docs.some(f=>f.role==='notice'))add('缺少适用资料','尚未读入适用主公告，仅能检查已导入部分');
 if(!docs.some(f=>f.role==='guide'))add('缺少适用资料','尚未读入适用的报考指南/政策问答，身份口径待核对');
 if(pack.province==='江苏'){
  if(!docs.some(f=>f.role==='local')&&j.city&&j.city!=='省直')add('地方规定待核对','江苏部分地区/垂管职位需关联地市规定，尚未确认本岗位适用的地方公告/简章');
  if(/公安|法院|检察|监狱|戒毒/.test(j.sheet+j.agency+j.type)&&!docs.some(f=>f.role==='special'))add('专项规定待核对','本系统需核对适用的专项简章，尚未确认相关材料');
 }
 for(const f of applicable){
  if(f.role==='reference'&&fileConfirmed(f,pack))continue;
  if(f.kind==='error'){add('文件未解析',`${f.filename}：${f.error}`);continue;}
  if(!fileConfirmed(f,pack)){add('材料异常',`${f.filename}：${f.autoIssue||'用途或适用范围尚未明确'}`);continue;}
  if(f.status==='partial'&&!f.conversionReadable)add('文档不完整',`${f.filename}：${f.warnings.join('；')}`);
  if(f.applicationMode!=='auto'&&!f.coverageConfirmed)add('条款覆盖待核对',`${f.filename} 已读文字，尚未核对条款覆盖`);
  if(f.role==='correction')add('更正关系待核对',`${f.filename}：尚未自动判断替换/废止关系，不能直接用上传时间决定版本`);
 }
 if(!unlimited(r.major)){
  const catalogs=docs.filter(f=>f.role==='catalog');
  if(!catalogs.length)add('专业目录待核对','尚未确认本次考试的适用专业目录');
  else if(!shared.majorPolicy&&pack.province==='广东'&&profile.majorCode){
   const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   const name=clean(profile.majorName),code=clean(profile.majorCode).toUpperCase();
   const expression=name?new RegExp(escape(name)+'\\(?'+escape(code)+'\\)?(?!\\d)'):null;
   shared.catalogProof??=Boolean(expression&&catalogs.some(f=>f.blocks.some(b=>expression.test(clean(b.text)))));
   if(!shared.catalogProof)add('本人专业对应关系','未从适用目录中核对到所填专业名称与代码的相邻对应，需检查原文');
  }
 }
 if(j.versionConflict)rowIssue('疑似重复或版本冲突','同单位、代码、职位、考区出现不同记录，暂不自动合并或认定新旧版本');
 if(!shared.majorPolicy&&pack.province!=='广东')r.coverageNotes.push({field:'专业匹配范围',reason:'未套用广东代码层级；专业按本次附件与目录判断',incomplete:false});
 r.status=r.checks.some(c=>c.state==='fail')?'fail':r.checks.some(c=>c.state==='review')?'review':'pass';
 r.qualificationStatus=r.status==='fail'?'fail':r.status==='review'||r.commonChecks.some(c=>c.state==='review')||r.coverageNotes.some(c=>c.incomplete)?'review':'pass';
 // New conditions include document evidence and retain explicit user confirmation provenance.
 return r;
}
export function validateSnapshot(s){
 if(s?.format!=='xuan-zhi-package'||s.version!==1||!s.pack||!Array.isArray(s.files)||s.files.length>100)throw Error('不是受支持的资料包备份');
 if(!['province','year','examType','name'].every(k=>typeof s.pack[k]==='string'&&s.pack[k].length<300))throw Error('资料包信息格式不正确');
 let rows=0,blocks=0;
 for(const f of s.files){
  if(!f||!/^[a-f0-9]{64}$/.test(f.id)||typeof f.filename!=='string'||!['jobs','document','error'].includes(f.kind)||!Object.hasOwn(roles,f.role)||!['parsed','partial','error'].includes(f.status))throw Error('文件记录格式不正确');
  if(f.kind==='jobs'&&!Array.isArray(f.jobs)||f.kind==='document'&&!Array.isArray(f.blocks))throw Error('缺少文件内容');
  if(f.kind==='jobs'&&!Array.isArray(f.sheets)||!Array.isArray(f.warnings||[])||!Array.isArray(f.selectedBlockIds||[]))throw Error('文件状态字段不正确');
  if(f.scope&&(['city','system','codes'].some(k=>typeof f.scope[k]!=='string')))throw Error('文件适用范围不正确');
  if(f.majorPolicy){if(f.kind!=='document')throw Error('专业规则必须是目录文档');validateMajorPolicy(f.majorPolicy);}
  rows+=(f.jobs||[]).length;blocks+=(f.blocks||[]).length;
  if((f.jobs||[]).some(j=>typeof j.id!=='string'||!j.raw||Array.isArray(j.raw)||!Array.isArray(j.notes)||j.available&&!Array.isArray(j.available)||j.conditionSources&&!Array.isArray(j.conditionSources)))throw Error('岗位数据结构不正确');
  if((f.blocks||[]).some(b=>typeof b.id!=='string'||typeof b.text!=='string'||typeof b.location!=='string'))throw Error('文档段落格式不正确');
 }
 if(rows>100000||blocks>100000)throw Error('备份规模超过上限');
 return s;
}
