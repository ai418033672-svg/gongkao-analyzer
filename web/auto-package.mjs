// Readable uploads participate immediately. Only actual conflicts need a decision.
import {contextKey,contextMismatch} from './package.mjs';
const scopeEmpty=()=>({city:'',system:'',codes:''});
export function readingGap(f){
 if(f.status!=='partial')return false;
 return !(/\.doc$/i.test(f.filename)&&f.warnings?.some(w=>/DOC已转换为文字/.test(w))&&!f.warnings.some(w=>/缺页|OCR|未下载|不完整|没有.*文字|加密/.test(w)));
}
export function suggestRole(f){
 if(f.settingsEdited)return f.role;
 if(f.kind==='jobs')return 'jobs';
 if(f.majorPolicy)return 'catalog';
 const heading=f.filename;
 if(/更正|勘误|补充公告|调整公告|取消公告/.test(heading))return 'correction';
 if(/专业.*目录|专业.*参考/.test(heading))return 'catalog';
 if(/报考指南|政策问答/.test(heading))return 'guide';
 if(/笔试大纲|考试大纲|咨询电话|技术问答|考务问答/.test(heading))return 'reference';
 if(/公安|司法行政|法官助理|检察官助理|监狱|戒毒/.test(f.filename)&&/公告|简章/.test(f.filename))return 'special';
 if(f.role&&f.role!=='unknown')return f.role;
 const title=(f.blocks||[]).slice(0,2).map(b=>b.text).join(' ').slice(0,200);
 if(/专业.*目录/.test(title))return 'catalog';
 if(/报考指南|政策问答/.test(title))return 'guide';
 if(/笔试大纲|考试大纲|咨询电话/.test(title))return 'reference';
 if(/公告|招录简章|招聘简章/.test(heading+' '+title))return 'notice';
 return 'supplement';
}
export function inferPack(files,current){
 const pack={...current};
 const primary=files.filter(f=>f.kind==='jobs'||suggestRole(f)==='notice');
 for(const k of ['province','year','examType']){
  if(pack[k])continue;
  const from=fs=>[...new Set(fs.map(f=>f.context?.[k]).filter(Boolean))];
  const values=from(primary).length?from(primary):from(files);
  if(values.length===1)pack[k]=values[0];
 }
 if(!pack.examType){
  const text=files.map(f=>f.filename+' '+(f.blocks||[]).slice(0,2).map(b=>b.text).join(' ')+' '+(f.jobs?.[0]?.notes||[]).join(' ')).join(' ');
  if(/定向选调|选调优秀|选调生/.test(text))pack.examType='定向选调';
  else if(/中央机关及其直属机构|国家公务员/.test(text))pack.examType='国家公务员考试';
  else if(/考试录用公务员|公务员招录|公务员录用/.test(text))pack.examType='普通省考';
  else if(/事业单位|公开招聘/.test(text))pack.examType='事业单位招聘';
 }
 return pack;
}
export function prepareFiles(files,pack){
 const jobs=files.flatMap(f=>f.jobs||[]);
 const cities=[...new Set(jobs.map(j=>j.city).filter(Boolean))];
 for(const f of files){
  f.scope??=scopeEmpty();f.warnings??=[];
  if(f.kind==='error'||f.status==='error'){f.confirmed=false;f.autoIssue='文件读取失败';continue;}
  f.role=suggestRole(f);f.applicationMode='auto';f.contextKey=contextKey(pack);
  f.conversionReadable=f.status==='partial'&&!readingGap(f);
  f.autoIssue=contextMismatch(f,pack)&&!f.contextOverride?contextMismatch(f,pack)+'，未混入本次筛选':'';
  if(!f.selectionInitialized){f.selectedBlockIds=(f.blocks||[]).filter(b=>b.candidate).map(b=>b.id);f.selectionInitialized=true;}
  if(!f.settingsEdited){
   const title=f.filename+' '+(f.blocks||[]).slice(0,1).map(b=>b.text).join(' ').slice(0,120);
   if(['notice','local'].includes(f.role)){
    const matches=cities.filter(c=>{const stem=c.replace(/市$|考区$/g,'');return stem.length>=2&&title.includes(stem);});
    if(matches.length===1){f.role='local';f.scope={...scopeEmpty(),city:matches[0]};}
   }
   if(f.role==='special')f.autoTarget=/公安/.test(f.filename)?'police':/法官|法院/.test(f.filename)?'court':/检察/.test(f.filename)?'procurator':/司法行政|监狱|戒毒/.test(f.filename)?'justice':'';
  }
  if(f.role==='local'&&!f.scope.city&&!f.scope.codes)f.autoIssue||='地方文件的适用地区无法识别，请调整范围';
  if(f.role==='special'&&!f.autoTarget&&!f.scope.system&&!f.scope.codes)f.autoIssue||='专项文件的适用系统无法识别，请调整范围';
  f.confirmed=!f.autoIssue;
 }
 return files;
}
