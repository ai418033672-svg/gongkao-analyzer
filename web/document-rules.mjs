import {checkConditions} from './conditions.mjs';
const compact=s=>String(s||'').replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
const titleTopic=/户籍|生源|居住证|积分通知书|学历|学位|专业|应届|往届|毕业生|工作经历|基层|周岁|年龄|退役|服务年限|职业资格|资格证|英语等级|职称|党员|团员|性别|男性|女性/;
const predicate=/须|必须|应当|要求|不得|不能|仅限|限定|限于|限.*(?:报考|户籍)|具有|具备|获得|取得|以上|以下|不低于|不超过|不少于|满\d|除外|不受.*限制/;
export function isEligibility(text){
 const t=compact(text).replace(/^答[:：]/,'');
 if(!t||/[？?]$/.test(t)||t.length<5&&!/男|女|党员|团员/.test(t))return false;
 if(/^(?:报考指南|政策问答|.*(?:公告|简章)|[一二三四五六七八九十]+、.*)$/.test(t)&&t.length<45)return false;
 if(/^(?:限|仅限)(?:应届毕业生|应届高校毕业生)(?:报考)?[。.]?$/.test(t))return true;
 if(/^(?:中共党员|非中共党员|男性|女性|限男性报考|限女性报考)[。.]?$/.test(t))return true;
 if(/^通过法律职业资格考试[。.]?$/.test(t))return true;
 if(!titleTopic.test(t)||!predicate.test(t))return false;
 if(/填报|填写|上传|提交材料|打印|缴费|成绩|合格分数线|面试比例/.test(t)&&!/(?:不得|不能)报考|户籍|居住证|年龄|周岁|职业资格|资格证|党员|团员|退役|(?:本科|硕士|博士).*(?:以上|学位)|仅限/.test(t))return false;
 return true;
}
function targetFor(text){
 if(/特警/.test(text))return 'swat';
 if(/公安.*警察|公安机关/.test(text))return 'police';
 if(/法医/.test(text))return 'forensic';
 if(/监狱|戒毒/.test(text))return 'prison';
 if(/共青团职位/.test(text))return 'youth';
 if(/残疾人(?:专项|职位|招录)|残疾军人/.test(text))return 'disabled';
 if(/高校毕业生退役士兵|退役大学生士兵.*(?:专门|职位)/.test(text))return 'retired';
 if(/法律.*资格|法考/.test(text)&&/职位|哪些/.test(text))return 'legal';
 return '';
}
export function ruleApplies(rule,j){
 const t=[j.title,j.agency,j.type,j.sheet].join(' ');
 const explicit=[j.title,j.type,...(j.conditionSources||[]).map(s=>s.text)].join(' ');
 if(rule.target==='disabled')return /残疾人专项|面向残疾|残疾人职位|残疾人专门/.test(explicit);
 if(rule.target==='retired')return /退役士兵专项|高校毕业生退役士兵|退役大学生士兵|面向.*退役士兵/.test(explicit);
 if(rule.target==='legal')return /法律职业资格|法考|法官|检察官/.test(explicit);
 return !rule.target||({swat:/特警/,forensic:/法医/,police:/公安|警察/,prison:/监狱|戒毒/,youth:/共青团|团委/}[rule.target]?.test(t)??true);
}
export function extractDocumentRules(docs,pack){
 const rules=[],seen=new Map();let information=0;
 for(const f of docs.filter(f=>['notice','local','special','guide','correction','supplement'].includes(f.role))){
  const selected=new Set(f.selectedBlockIds||[]);let question='';
  const full=(f.blocks||[]).map(b=>b.text).join('\n');
  for(let i=0;i<(f.blocks||[]).length;i++){
   const b=f.blocks[i];if(/[？?]$/.test(b.text.trim())){question=b.text;information++;continue;}
   if(!selected.has(b.id))continue;
   const text=b.text.trim(),combined=question+' '+text;
   let rule;
   if(pack.province==='上海'&&/非本市户籍.*社会人员/.test(compact(combined))&&/硕士研究生及以上学历/.test(compact(text))&&/上海市居住证/.test(text)&&/积分通知书/.test(text)&&/主证人/.test(text)&&/有效期/.test(text)){
    const following=f.blocks.slice(i+1).find(b=>b.text.trim())?.text||'';
    const next=following.includes('集体户口')||/^(但|除|其中|部分|上述|以上)/.test(following.trim())?following:'';
    const date=compact(text).match(/计算截止时间为(20\d{2})年(\d{1,2})月(\d{1,2})日/);
    const years=compact(text).match(/居住证[》)]*([一二三四五六七八九十\d]+)年以上/);
    const digits={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
    rule={type:'sh-social-hukou',text:combined+(next?'\n'+next:''),target:'',cutoff:date?`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`:'',years:years?(digits[years[1]]||Number(years[1])):null,collective:(text+next).includes('集体户口'),highest:/社会人员以已经获得的最高学历进行报考/.test(compact(full)),swatExemption:/特警\(防暴突击\)[\s\S]{0,160}户籍不限/.test(compact(full)),uncertainException:/除.*外|豁免|不受.*限制|另有规定|放宽|无需|无须|不要求/.test(compact(text+next))};
   }else{
    if(pack.province==='上海'&&rules.some(r=>r.type==='sh-social-hukou')&&/非应届.*集体户口.*参照以上条件/.test(compact(text)))continue;
    if(!isEligibility(text)){information++;continue;}
    rule={type:'generic',text,target:targetFor(combined)};
   }
   const key=rule.type==='sh-social-hukou'?JSON.stringify([rule.type,rule.cutoff,rule.years]):rule.type+'|'+rule.target+'|'+compact(rule.text).replace(/^答[:：]/,'');
   const source={file:f.filename,location:b.location,url:f.sourceUrl||''};
   if(seen.has(key)){
    const existing=seen.get(key);existing.sources.push(source);
    if(rule.type==='sh-social-hukou'){
     for(const k of ['collective','highest','swatExemption','uncertainException'])existing[k]||=rule[k];
     if(!existing.text.includes(rule.text))existing.text+='\n'+rule.text;
    }
    continue;
   }
   Object.assign(rule,{id:f.id+':'+b.id,sources:[source],source:`${f.filename} · ${b.location}`});rules.push(rule);seen.set(key,rule);
  }
 }
 return {rules,information};
}
function shCheck(rule,p,j){
 const checks=[],add=(state,reason,fields=[])=>checks.push({state,reason,profileFields:fields});
 const identity=p.applicantCategory,house=p.shHukou;
 if(rule.uncertainException){add('review','本条包含尚未解析的豁免或放宽条件，未直接套用普通社会人员门槛');return checks;}
 if(/特警/.test([j.title,j.type].join(' '))){
  if(rule.swatExemption&&/防暴突击/.test([j.title,j.type].join(' '))){add('pass','防暴突击特警适用文件明确的户籍不限条款');return checks;}
  add('review','特警职位须结合其专项户籍规定，未直接套用普通社会人员条件');return checks;
 }
 if(!identity){add('review','请选择报考人员身份，才能确定此项是否适用',['applicantCategory']);return checks;}
 if(identity==='应届高校毕业生'){add('pass','本条针对社会人员，不以此项限制应届高校毕业生');return checks;}
 if(identity!=='社会人员'){add('review','此项仅解析普通社会人员；该身份的适用规则尚未明确',['applicantCategory']);return checks;}
 if(!house){add('review','请补充上海户籍/户口类型',['shHukou']);return checks;}
 if(house==='上海常住户籍'){add('pass','本条不限制上海常住户籍社会人员');return checks;}
 if(!['非上海户籍','高校集体户口','驻沪办集体户口'].includes(house)){add('review','户口类型尚未明确',['shHukou']);return checks;}
 if(house!=='非上海户籍'&&!rule.collective){add('review','当前材料未解析到该集体户口的适用范围');return checks;}
 const highest=p.highestEducation==='同报考学历'?p.education:p.highestEducation;
 if(!highest){add('review','请补充已取得的最高学历',['highestEducation']);return checks;}
 if(!['硕士','博士'].includes(highest)){add('fail','非沪籍及适用集体户口的社会人员须具有硕士研究生及以上学历');return checks;}
 if(rule.highest&&p.education&&p.education!==highest){add('fail','本次政策要求社会人员以已取得的最高学历报考，当前报考学历与最高学历不同');return checks;}
 const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 if(!validDate(rule.cutoff)||!rule.years){add('review','已提取居住证要求，但计算截止日或持证年限尚未明确');return checks;}
 const anniversary=new Date(rule.cutoff+'T00:00:00Z');anniversary.setUTCFullYear(anniversary.getUTCFullYear()-rule.years);const before=anniversary.toISOString().slice(0,10);
 if(!validDate(p.shResidenceSince))add('review',`请填写截至${rule.cutoff}连续持有上海居住证的有效起始日期`,['shResidenceSince']);
 else if(p.shResidenceSince>before)add('fail',`截至${rule.cutoff}持有上海居住证未满${rule.years}年`);
 if(!validDate(p.shResidenceUntil))add('review',`请填写居住证有效截止日期，需覆盖${rule.cutoff}`,['shResidenceUntil']);
 else if(p.shResidenceUntil<rule.cutoff)add('fail',`居住证有效期未覆盖计算截止日${rule.cutoff}`);
 if(!p.shPointsNotice)add('review','请填写是否以主证人身份取得上海居住证积分通知书',['shPointsNotice']);
 else if(p.shPointsNotice!=='主证人已取得')add('fail','需要以主证人身份取得积分通知书；仅副证人或未取得不满足本条');
 if(!checks.length)add('pass',`按自报资料，满足本条非沪籍社会人员条件（计算截至${rule.cutoff}）`);
 return checks;
}
export function evaluateDocumentRules(extracted,p,j,datasetId){
 const out=[];
 for(const rule of extracted.rules){
  if(!ruleApplies(rule,j))continue;
  const checks=rule.type==='sh-social-hukou'?shCheck(rule,p,j):checkConditions({datasetId,conditionSources:[{column:rule.source,text:rule.text}]},p);
  const highest=p.highestEducation==='同报考学历'?p.education:p.highestEducation;
  const fields=rule.type==='sh-social-hukou'?['applicantCategory',...(p.applicantCategory==='社会人员'?['shHukou']:[]),...(p.applicantCategory==='社会人员'&&p.shHukou&&p.shHukou!=='上海常住户籍'?['highestEducation']:[]),...(p.applicantCategory==='社会人员'&&p.shHukou&&p.shHukou!=='上海常住户籍'&&['硕士','博士'].includes(highest)?['shResidenceSince','shResidenceUntil','shPointsNotice']:[])]:[];
  for(const c of checks)out.push({...c,id:rule.id,field:rule.type==='sh-social-hukou'?'上海非沪籍社会人员条件':c.kind,kind:rule.type==='sh-social-hukou'?'户籍与居住证':c.kind,source:rule.source,sources:rule.sources,text:rule.text,common:true,fromDocument:true,profileFields:[...new Set([...fields,...(c.profileFields||[])])],unparsed:rule.type==='generic'&&c.state==='review'&&c.manualEligible});
 }
 return out;
}
