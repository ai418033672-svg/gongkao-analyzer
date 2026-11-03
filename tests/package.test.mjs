import test from 'node:test';import assert from 'node:assert/strict';
import {buildDataset,contextKey,contextMismatch,evaluateInPackage,validateSnapshot} from '../web/package.mjs';
const pack={name:'测试',province:'广东',year:'2027',examType:'普通省考'};
const profile={education:'本科',degree:'学士',majorName:'中药学',majorCode:'B101101',fresh:'往届',experience:'2'};
const job={id:'表:2',datasetId:'a',sheet:'普通机关',row:2,agency:'某局',title:'职员',city:'广州',code:'001',count:'1',education:'本科',degree:'学士',majorBachelor:'中药学(B101101)',fresh:'否',experience:'否',conditionSources:[],notes:[],raw:{代码:'001'}};
function file(id='a',jobs=[job]){return {id:id.repeat(64),filename:id+'.csv',kind:'jobs',role:'jobs',status:'parsed',confirmed:true,contextKey:contextKey(pack),jobs,sheets:[]};}
function doc(role,text,id=role){return {id:id.padEnd(64,'a').slice(0,64),filename:role+'.txt',kind:'document',role,status:'parsed',confirmed:true,contextKey:contextKey(pack),coverageConfirmed:true,scope:{city:'',system:'',codes:''},blocks:[{id:'0',location:'第1段',text}],selectedBlockIds:['0'],warnings:[]};}
const documents=()=>[doc('notice','具有中华人民共和国国籍'),doc('guide','报考指南'),doc('catalog','中药学(B101101)')].map(f=>f.role==='catalog'?f:{...f,selectedBlockIds:[]});
test('追加、移除和完全相同岗位多来源去重',()=>{
 const f=file(),g=file('b');assert.equal(buildDataset([f],pack).total,1);
 const d=buildDataset([f,g],pack);assert.equal(d.total,1);assert.equal(d.merged,1);assert.equal(d.jobs[0].sources.length,2);
 assert.equal(buildDataset([g],pack).jobs[0].sources.length,1);
});
test('同代码不同单位不合并，冲突版本不自动选最新',()=>{
 const a=file(),b=file('b',[{...job,agency:'另一局'}]);assert.equal(buildDataset([a,b],pack).total,2);
 const d=buildDataset([a,file('b',[{...job,count:'2'}])],pack);assert.equal(d.total,2);assert.ok(d.jobs.every(j=>j.versionConflict));
});
test('待确认文件和跨年度文件不能直接参与',()=>{
 assert.equal(buildDataset([{...file(),confirmed:false}],pack).total,0);
 assert.equal(buildDataset([file()],{...pack,year:'2028'}).total,0);
 assert.ok(contextMismatch({context:{province:'江苏',year:'2028'}},pack));
});
test('附件匹配与完整资格范围分开，缺公告只统一说明',()=>{
 const r=evaluateInPackage(job,profile,[file()],pack);assert.equal(r.status,'pass');assert.equal(r.qualificationStatus,'review');assert.ok(r.coverageNotes.some(c=>c.field==='缺少适用资料'));
});
test('确认条款范围后，公告限应届排除往届且保留来源',()=>{
 const docs=documents();docs[0]={...doc('notice','限应届毕业生报考'),scope:{city:'广州',system:'普通机关',codes:'001'}};
 const r=evaluateInPackage(job,profile,docs,pack);assert.equal(r.status,'fail');assert.match(r.commonChecks[0].source,/notice.txt/);
 const other=evaluateInPackage({...job,city:'深圳'},profile,docs,pack);assert.notEqual(other.status,'fail');
});
test('未审条款、缺页和更正文件阻止完整通过',()=>{
 const docs=documents();assert.equal(evaluateInPackage(job,profile,docs,pack).status,'pass');
 assert.equal(evaluateInPackage(job,profile,docs.map(f=>({...f,coverageConfirmed:false})),pack).qualificationStatus,'review');
 assert.equal(evaluateInPackage(job,profile,[...docs,doc('correction','其他文字')],pack).qualificationStatus,'review');
 assert.equal(evaluateInPackage(job,profile,docs.map(f=>({...f,status:'partial',warnings:['缺页']})),pack).qualificationStatus,'review');
});
test('参考资料不作为资格限制，其他地区不沿用广东规则',()=>{
 const ref={...doc('reference','限应届毕业生报考'),coverageConfirmed:false};
 assert.equal(evaluateInPackage(job,profile,[...documents(),ref],pack).status,'pass');
 const p={...pack,province:'江苏'};assert.equal(evaluateInPackage(job,profile,documents().map(f=>({...f,contextKey:contextKey(p)})),p).status,'review');
});
test('专项简章不能冒充主公告填补缺失，修改范围后不沿用确认',()=>{
 const docs=documents().filter(f=>f.role!=='notice');docs.push(doc('special','其他说明'));
 const r=evaluateInPackage(job,profile,docs,pack);assert.equal(r.status,'pass');assert.equal(r.qualificationStatus,'review');assert.ok(r.coverageNotes.some(c=>c.reason.includes('主公告')));
 const altered=documents().map(f=>({...f,contextKey:contextKey({...pack,year:'2028'})}));assert.equal(evaluateInPackage(job,profile,altered,pack).qualificationStatus,'review');
});
test('备份验证拒绝错误结构，合法内容可恢复',()=>{
 assert.throws(()=>validateSnapshot({files:[]}));
 const s={format:'xuan-zhi-package',version:1,pack,files:[file()]};assert.equal(validateSnapshot(s),s);
 assert.throws(()=>validateSnapshot({...s,files:[{...file(),id:'bad'}]}));
});
