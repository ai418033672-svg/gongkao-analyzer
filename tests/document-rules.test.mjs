import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {extractDocumentRules,evaluateDocumentRules,isEligibility} from '../web/document-rules.mjs';
import {prepareFiles} from '../web/auto-package.mjs';import {evaluateInPackage} from '../web/package.mjs';
const pack={name:'',province:'上海',year:'2027',examType:'普通省考'};
const job={id:'j',datasetId:'d',sheet:'普通岗位',row:2,agency:'测试局',title:'职员',city:'上海',code:'001',count:'1',education:'本科及以上',degree:'不限',major:'不限',fresh:'否',experience:'否',conditionSources:[],notes:[],raw:{}};
const person={education:'硕士',highestEducation:'硕士',applicantCategory:'社会人员',shHukou:'非上海户籍',shResidenceSince:'2025-11-07',shResidenceUntil:'2027-11-07',shPointsNotice:'主证人已取得',fresh:'往届',experience:'2'};
function doc(text,id='a') {const blocks=text.split('\n').filter(Boolean).map((text,i)=>({id:String(i),text,location:'段落'+i,candidate:true}));return {id:id.repeat(64),filename:'上海2027政策问答.txt',role:'guide',kind:'document',status:'parsed',blocks,selectedBlockIds:blocks.map(b=>b.id),warnings:[]};}
const official=fs.readFileSync(new URL('./fixtures/上海虚构政策_结构化规则测试.txt',import.meta.url),'utf8');
const evidence=extractDocumentRules([doc(official)],pack);
const sh={...evidence,rules:evidence.rules.filter(r=>r.type==='sh-social-hukou')};
const checks=(p=person,j=job)=>evaluateDocumentRules(sh,p,j,'d');
test('虚构条款提取截止日、持证年限、集体户口及最高学历条件',()=>{
 assert.equal(sh.rules.length,1);const r=sh.rules[0];assert.equal(r.cutoff,'2026-11-07');assert.equal(r.years,1);assert.equal(r.collective,true);assert.equal(r.highest,true);assert.equal(r.swatExemption,true);
});
test('非沪籍社会人员本科学历明确排除，而不是泛称核对公告',()=>{
 const c=checks({...person,education:'本科',highestEducation:'同报考学历'});assert.ok(c.some(c=>c.state==='fail'&&c.reason.includes('硕士')));
 assert.ok(!c.some(c=>c.reason.includes('人工核对')));
});
test('尚未填最高学历不把报考本科学历误当最高学历',()=>{
 const c=checks({...person,education:'本科',highestEducation:''});assert.ok(c.some(c=>c.state==='review'&&c.profileFields.includes('highestEducation')));assert.ok(!c.some(c=>c.state==='fail'));
});
test('持证恰满一年、仍有效、主证人已取得通知书时匹配',()=>{
 assert.ok(checks().every(c=>c.state==='pass'));
 assert.ok(checks({...person,shResidenceSince:'2025-11-08'}).some(c=>c.state==='fail'));
 assert.ok(checks({...person,shResidenceUntil:'2026-11-06'}).some(c=>c.state==='fail'));
 assert.ok(checks({...person,shPointsNotice:'未取得/仅副证人'}).some(c=>c.state==='fail'));
});
test('本市常住和应届不套用非沪籍社会人员门槛，集体户口不能混作常住',()=>{
 assert.ok(checks({...person,shHukou:'上海常住户籍',highestEducation:'本科'}).every(c=>c.state==='pass'));
 assert.ok(checks({...person,applicantCategory:'应届高校毕业生',highestEducation:'本科'}).every(c=>c.state==='pass'));
 assert.ok(checks({...person,shHukou:'高校集体户口',highestEducation:'本科'}).some(c=>c.state==='fail'));
 assert.ok(checks({...person,applicantCategory:'留学回国人员'}).some(c=>c.state==='review'));
});
test('专项防暴突击特警按已读户籍不限条款处理，普通特警不擅自豁免',()=>{
 assert.ok(checks({...person,highestEducation:'本科'}, {...job,title:'特警（防暴突击）'}).every(c=>c.state==='pass'));
 assert.ok(checks({...person,highestEducation:'本科'}, {...job,title:'特警'}).some(c=>c.state==='review'));
});
test('最高学历报考规定与日期非法值保留具体判断',()=>{
 assert.ok(checks({...person,education:'本科'}).some(c=>c.state==='fail'&&c.reason.includes('最高学历')));
 assert.ok(checks({...person,shResidenceSince:'2025-99-99'}).some(c=>c.state==='review'));
});
test('流程、问答标题、时间和材料提交不当作资格限制',()=>{
 for(const text of ['上海市2027年度考试录用公务员政策问答','非本市户籍的社会人员报考需要满足什么条件？','报名时间为2026年11月2日至7日','报考者须上传学历学位材料','面试比例为3比1','必须填写完整的工作单位信息'])assert.equal(isEligibility(text),false,text);
 assert.equal(isEligibility('限应届毕业生报考'),true);assert.equal(isEligibility('限本市户籍'),true);assert.equal(isEligibility('具有医师执业资格证书'),true);
});
test('缺公告等读取范围只统一说明，不再使附件匹配岗位逐个警告',()=>{
 const r=evaluateInPackage(job,{...person,education:'本科'},[],pack);assert.equal(r.status,'pass');assert.equal(r.qualificationStatus,'review');assert.ok(r.coverageNotes.length);assert.ok(!r.checks.some(c=>/公告|地区规则/.test(c.field+c.reason)));
});
test('地区冲突明确排除，附件本身的户籍限制仍优先逐行判断',()=>{
 const f=doc(official);prepareFiles([f],pack);
 const r=evaluateInPackage(job,{...person,education:'本科',highestEducation:'同报考学历'},[f],pack);assert.equal(r.status,'fail');assert.equal(r.conditions.length,0);assert.ok(r.commonChecks.some(c=>c.state==='fail'));
 const specific={...job,conditionSources:[{column:'户籍要求',text:'限本市户籍'}]};
 const s=evaluateInPackage(specific,person,[f],pack);assert.equal(s.status,'fail');assert.ok(s.conditions.some(c=>c.state==='fail'));
});
test('相同地区规则跨文档合并证据，不重复要求填写',()=>{
 const a=doc(official),b=doc(official,'b');const e=extractDocumentRules([a,b],pack);assert.equal(e.rules.filter(r=>r.type==='sh-social-hukou').length,1);assert.equal(e.rules.find(r=>r.type==='sh-social-hukou').sources.length,2);
});
test('没有上传上海具体条款时不凭地区名称补套硬编码门槛',()=>{
 const d=doc('普通考试报名流程');const e=extractDocumentRules([d],pack);assert.equal(e.rules.length,0);
});
test('专项法考和残疾人条款不套用到普通机关岗位',()=>{
 const f=doc('哪些人可以报考要求法律职业资格的职位？\n通过法律职业资格考试\n哪些人可以报考残疾人专项招录职位？\n限本市户籍');
 const extracted=extractDocumentRules([f],pack);
 assert.equal(evaluateDocumentRules(extracted,{...person,lawQualification:'未通过'},job,'d').length,0);
 const legal={...job,title:'法官助理'};assert.ok(evaluateDocumentRules(extracted,{...person,lawQualification:'未通过'},legal,'d').some(c=>c.state==='fail'));
});
test('共性明确应届冲突保留具体排除原因，但不制造逐行公告待核对',()=>{
 const f=doc('限应届毕业生报考');prepareFiles([f],pack);
 const r=evaluateInPackage(job,{...person,fresh:'往届'},[f],pack);
 assert.equal(r.status,'fail');assert.ok(r.checks.some(c=>c.common&&c.state==='fail'&&!c.remark&&c.reason.includes('限应届')));
 assert.ok(!r.checks.some(c=>c.state==='review'&&c.reason.includes('公告')));
});
test('地区条款含未知豁免时不直接按普通门槛错杀本科考生',()=>{
 const text=sh.rules[0].text+'部分人员不受以上条件限制。';const f=doc(text);const e=extractDocumentRules([f],pack);
 const c=evaluateDocumentRules(e,{...person,education:'本科',highestEducation:'本科'},job,'d');
 assert.ok(c.some(c=>c.state==='review'));assert.ok(!c.some(c=>c.state==='fail'));
});
