import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileMajorPolicy,matchCatalog,validateMajorPolicy} from '../web/major-policy.mjs';
import {evaluateInPackage,contextKey,validateSnapshot} from '../web/package.mjs';
const example=JSON.parse(fs.readFileSync(new URL('../examples/fictional-major-policy.json',import.meta.url)));
const clone=()=>structuredClone(example);
const profile={education:'本科',majorName:'示例纺织工程'};
const job={id:'1',datasetId:'demo',education:'本科',degree:'不限',major:'示例工程类',fresh:'不限',experience:'不限',notes:[],other:'',raw:{}};
function doc(policy=clone()){
 return {id:'a'.repeat(64),filename:'fictional-major-policy.json',kind:'document',role:'catalog',status:'parsed',confirmed:true,
  contextKey:contextKey(policy.context),coverageConfirmed:true,blocks:[],selectedBlockIds:[],majorPolicy:policy};
}
test('类别按明确名单命中，不沿用名称相似或广东前缀',()=>{
 const policy=compileMajorPolicy(clone());
 const hit=matchCatalog('示例工程类',profile,policy);
 assert.equal(hit.state,'pass');assert.equal(hit.evidence[0].location,'虚构表格第2行');
 assert.equal(matchCatalog('示例法学',profile,policy).state,'fail');
 assert.equal(matchCatalog('未知工程类',profile,policy).state,'review');
 assert.equal(matchCatalog('示例工程类',{education:'本科',majorCode:'B081701'},policy).state,'review');
});
test('层级支持多级及多父类别，不能从上级反推具体专业',()=>{
 const policy=clone();policy.strategy='hierarchy';policy.nodes.push({id:'root',kind:'category',name:'示例门类',education:'本科'});
 policy.edges.push({parent:'root',child:'group',evidence:{text:'示例门类包括示例工程类',location:'虚构表格第1行'}});
 const compiled=compileMajorPolicy(policy);
 assert.equal(matchCatalog('示例门类',profile,compiled).evidence.length,2);
 assert.equal(matchCatalog('示例纺织工程',{education:'本科',majorName:'示例门类'},compiled).state,'review');
 policy.edges.push({parent:'root',child:'textile',evidence:{text:'示例门类也直接收录该专业',location:'虚构表格第3行'}});
 assert.equal(matchCatalog('示例门类',profile,compileMajorPolicy(policy)).state,'pass');
});
test('精确策略不能自动扩展类别或层级',()=>{
 const policy=clone();policy.strategy='exact';policy.edges=[];
 const compiled=compileMajorPolicy(policy);
 assert.equal(matchCatalog('示例纺织工程',profile,compiled).state,'pass');
 assert.equal(matchCatalog('示例工程类',profile,compiled).state,'fail');
});
test('错误图、缺证据、跨学历、重复代码及枚举嵌套均拒绝',()=>{
 for(const change of [
  p=>p.edges[0].child='missing',
  p=>p.edges[0].evidence.text='',
  p=>p.nodes[1].education='硕士',
  p=>{p.strategy='hierarchy';p.nodes[1].kind='category';p.edges.push({...p.edges[0],parent:'textile',child:'group'});},
  p=>p.nodes[1].kind='category',
  p=>{p.nodes[1].code='B01';p.nodes[2].code='B01';}
 ]){const policy=clone();change(policy);assert.throws(()=>validateMajorPolicy(policy));}
});
test('规则绑定省份年度类型，冲突不静默选最新，限制条件保留待核对',()=>{
 const file=doc(),pack=example.context;
 assert.equal(evaluateInPackage(job,profile,[file],pack).majorMatch.matched,true);
 for(const altered of [{...pack,year:'2098'},{...pack,province:'广东'},{...pack,examType:'事业单位招聘'}]){
  // Even a user-overridden file context cannot override policy scope.
  const r=evaluateInPackage(job,profile,[{...file,contextKey:contextKey(altered)}],altered);
  assert.equal(r.majorMatch.state,'review');assert.equal(r.majorCodeHit,false);
 }
 assert.equal(evaluateInPackage(job,profile,[file,{...file,id:'b'.repeat(64)}],pack).majorMatch.state,'review');
 assert.equal(evaluateInPackage({...job,major:'示例工程类（限某培养方向）'},profile,[file],pack).majorMatch.state,'review');
});
test('名称和代码不符、同名歧义、无对应学历不自动通过',()=>{
 const policy=clone();policy.nodes[1].code='DEMO01';policy.nodes[2].aliases=['示例纺织工程'];
 const compiled=compileMajorPolicy(policy);
 assert.equal(matchCatalog('示例工程类',{...profile,majorCode:'DEMO01',majorName:'示例法学'},compiled).state,'review');
 assert.equal(matchCatalog('示例工程类',profile,compiled).state,'review');
 assert.equal(matchCatalog('示例工程类',{education:'硕士',majorName:profile.majorName},compiled).state,'review');
});
test('备份恢复同样校验专业规则；拒绝恶意循环',()=>{
 const file=doc(),snapshot={format:'xuan-zhi-package',version:1,pack:{...example.context,name:'虚构示例'},files:[file]};
 assert.equal(validateSnapshot(snapshot),snapshot);
 file.majorPolicy.edges[0].child='group';assert.throws(()=>validateSnapshot(snapshot));
});
