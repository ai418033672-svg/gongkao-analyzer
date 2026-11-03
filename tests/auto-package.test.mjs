import test from 'node:test';
import assert from 'node:assert/strict';
import {inferPack,prepareFiles,readingGap,suggestRole} from '../web/auto-package.mjs';
import {buildDataset,contextKey,evaluateInPackage,createPackageEvaluator,applies} from '../web/package.mjs';
const pack={name:'',province:'广东',year:'2027',examType:'普通省考'};
const profile={education:'本科',degree:'学士',majorName:'中药学',majorCode:'B101101',fresh:'往届',experience:'2'};
const job={id:'表:2',datasetId:'a',sheet:'普通机关',row:2,agency:'某局',title:'职员',city:'广州',code:'001',count:'1',education:'本科',degree:'学士',majorBachelor:'中药学(B101101)',fresh:'否',experience:'否',conditionSources:[],notes:[],raw:{代码:'001'}};
const table=()=>({id:'a'.repeat(64),filename:'广东2027职位表.xls',kind:'jobs',role:'jobs',status:'parsed',confirmed:false,context:{province:'广东',year:'2027'},jobs:[{...job}],sheets:[]});
const doc=(role,text)=>({id:role.padEnd(64,'a').slice(0,64),filename:{notice:'广东2027考试录用公务员公告.txt',guide:'报考指南.doc',catalog:'专业目录.xls',reference:'笔试大纲.doc'}[role]||'补充条件.txt',kind:'document',role,status:'parsed',confirmed:false,context:{},warnings:[],blocks:[{id:'0',location:'第1段',text,candidate:true}]});
test('上传即识别归属、启用岗位及文档条款，不需要确认',()=>{
 const files=[table(),doc('notice','限应届毕业生报考'),doc('guide','指南'),doc('catalog','中药学(B101101)')];
 const p=inferPack(files,{name:'',province:'',year:'',examType:''});assert.deepEqual(p,pack);
 prepareFiles(files,p);assert.equal(buildDataset(files,p).total,1);
 const r=evaluateInPackage(job,profile,files,p);assert.equal(r.status,'fail');assert.ok(r.commonChecks.some(c=>c.source.includes('公告')));
 assert.ok(!r.checks.some(c=>c.field==='条款覆盖待核对'));assert.ok(files.every(f=>f.coverageConfirmed!==true));
});
test('普通DOC转换说明不会产生无法完成的确认门槛',()=>{
 const f={...doc('guide','指南'),status:'partial',warnings:['DOC已转换为文字；表格版式、文本框等请对照原文件核对']};
 prepareFiles([f],pack);assert.equal(readingGap(f),false);assert.equal(f.conversionReadable,true);assert.equal(f.confirmed,true);
 const files=[doc('notice',''),f,doc('catalog','中药学(B101101)')];prepareFiles(files,pack);
 assert.ok(!evaluateInPackage(job,profile,files,pack).checks.some(c=>['文档不完整','条款覆盖待核对','材料异常'].includes(c.field)));
});
test('PDF缺页与附件下载缺失仍标记为实际读取缺口',()=>{
 const f={...doc('guide','指南'),filename:'指南.pdf',status:'partial',warnings:['第2页没有可可靠读取的文字，可能需要OCR']};
 const g={...doc('guide','指南'),status:'partial',warnings:['DOC已转换为文字','附件下载不完整']};
 prepareFiles([f,g],pack);assert.equal(readingGap(f),true);assert.equal(readingGap(g),true);
 assert.ok(evaluateInPackage(job,profile,[f],pack).coverageNotes.some(c=>c.field==='文档不完整'));
});
test('跨年度异常不自动混入，可以一次调整归属解决',()=>{
 const f=table();f.context.year='2026';prepareFiles([f],pack);assert.equal(f.confirmed,false);assert.equal(buildDataset([f],pack).total,0);
 const p={...pack,year:'2026'};prepareFiles([f],p);assert.equal(buildDataset([f],p).total,1);
 f.contextOverride=true;prepareFiles([f],pack);assert.equal(buildDataset([f],pack).total,1);
});
test('无法推断归属的普通表格仍能直接查看，不要求先填三项',()=>{
 const f={...table(),filename:'岗位.csv',context:{}};const p={name:'',province:'',year:'',examType:''};
 prepareFiles([f],p);assert.equal(buildDataset([f],p).total,1);
});
test('地方公告只作用于匹配城市，专项简章不作用于普通岗位',()=>{
 const f={...doc('notice',''),filename:'广州市2027招录简章.txt'};
 const g={...doc('special','限应届毕业生报考'),filename:'公安机关2027招录简章.txt'};
 prepareFiles([table(),f,g],pack);assert.equal(f.role,'local');assert.equal(f.scope.city,'广州');
 assert.equal(applies(f,{...job,city:'深圳'}),false);assert.equal(applies(g,job),false);assert.equal(applies(g,{...job,agency:'市公安局'}),true);
});
test('文件标题用途优先，不被正文提及其他附件误识别',()=>{
 const f=doc('notice','请阅读报考指南及专业参考目录');assert.equal(suggestRole(f),'notice');
 const g={...doc('unknown','广东省2027年报考指南'),filename:'附件2.doc'};assert.equal(suggestRole(g),'guide');
});
test('其他可读条件文档自动提取限制，不静默当参考资料忽略',()=>{
 const f=doc('unknown','限应届毕业生报考');prepareFiles([f],pack);assert.equal(f.role,'supplement');
 assert.equal(evaluateInPackage(job,profile,[f],pack).status,'fail');
});
test('旧备份恢复后可自动启用，并保留用户调整的条款选择',()=>{
 const f={...doc('notice','限应届毕业生报考'),selectedBlockIds:[],selectionInitialized:true};
 prepareFiles([f],pack);assert.equal(f.confirmed,true);assert.deepEqual(f.selectedBlockIds,[]);
});
test('用户调整文件用途和范围后不会被下一次自动分析覆盖',()=>{
 const f={...table(),settingsEdited:true,role:'reference'};
 prepareFiles([f],pack);assert.equal(f.role,'reference');assert.equal(buildDataset([f],pack).total,0);
 const g={...doc('guide','限应届毕业生报考'),settingsEdited:true,scope:{city:'深圳',system:'',codes:''},selectedBlockIds:['0'],selectionInitialized:true};
 prepareFiles([g],pack);assert.equal(applies(g,job),false);assert.deepEqual(g.selectedBlockIds,['0']);
});
test('整包共用条款判断不串用岗位备注，个人条件更新重新计算',()=>{
 const files=[table(),doc('notice','限应届毕业生报考')];prepareFiles(files,pack);
 const evaluateJob=createPackageEvaluator(profile,files,pack);
 const a=evaluateJob(job),b=evaluateJob({...job,conditionSources:[{column:'备注',text:'限男性报考'}]});
 assert.equal(a.conditions.length,0);assert.equal(b.conditions.length,1);assert.equal(a.commonChecks[0],b.commonChecks[0]);
 const next=createPackageEvaluator({...profile,fresh:'应届'},files,pack)(job);assert.notEqual(next.status,'fail');
});
