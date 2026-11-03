import test from 'node:test';import assert from 'node:assert/strict';
import {ComparisonSelection,MAX_COMPARE} from '../web/comparison.mjs';
import {comparisonRows,commonHeadline,resultSummary} from '../web/presentation.mjs';
import {evidenceHTML,commonCards} from '../web/evidence.mjs';
const row=(id,status='pass',overrides={})=>({j:{id,title:'岗位'+id,agency:'单位',code:id,city:'广州',sheet:'系统',count:'1',education:'本科',degree:'学士',fresh:'否',experience:'否',other:'限本市户籍',raw:{学历:'本科',专业:'中药学(B101101)'},notes:[],...overrides},r:{status,checks:[{field:'学历',state:'pass',reason:'匹配本科'}],conditions:[],commonChecks:[],coverageNotes:[],major:'中药学(B101101)'}});
const key=j=>j.id;
test('选择上限、取消后重选、排除岗位不能新增',()=>{
 const s=new ComparisonSelection();for(let i=0;i<MAX_COMPARE;i++)assert.equal(s.toggle(''+i,row(''+i)).ok,true);
 assert.equal(s.toggle('overflow',row('overflow')).ok,false);assert.equal(s.ids.size,6);
 s.toggle('0',row('0'));assert.equal(s.ids.size,5);assert.equal(s.toggle('review',row('review','review')).ok,true);
 s.clear();assert.equal(s.toggle('fail',row('fail','fail')).ok,false);assert.equal(s.ids.size,0);
});
test('选择顺序跨筛选保留，数据移除会清理，条件变化导致排除会保留标记',()=>{
 const s=new ComparisonSelection(),rows=[row('a'),row('b'),row('c')];s.toggle('b',rows[1]);s.toggle('a',rows[0]);
 assert.deepEqual(s.rows(rows,key).map(x=>x.j.id),['b','a']);s.sync(rows,key);assert.equal(s.ids.size,2);
 const changed=[row('a','fail'),row('b')];s.sync(changed,key);assert.equal(s.rows(changed,key).find(x=>x.j.id==='a').r.status,'fail');
 assert.equal(s.sync([row('b')],key),1);assert.deepEqual([...s.ids],['b']);
});
test('对比保留专业原文和代码、人数差异以及未知字段',()=>{
 const rows=comparisonRows([row('a'),row('b','review',{count:'3',degree:''})]);
 assert.equal(rows.find(r=>r.label==='录用人数').different,true);
 assert.equal(rows.find(r=>r.label==='对应专业要求').values[0],'中药学(B101101)');
 assert.equal(rows.find(r=>r.label==='对应专业要求').different,false);
 assert.match(rows.find(r=>r.label==='学历 / 学位').values[1],/学位：未提供/);
 assert.match(rows[0].values[1],/待补充/);assert.equal(rows.at(-1).label,'公告关键补充');
});
test('条件变化明确冲突进入PK结果，不显示为匹配',()=>{
 const x=row('a','fail');x.r.checks.push({field:'户籍',state:'fail',reason:'限定上海户籍'});
 const s=resultSummary(x.r);assert.equal(s.failed.length,1);assert.equal(s.label,'已排除');
 assert.match(comparisonRows([x,row('b')]).find(r=>r.label==='明确冲突').values[0],/限定上海户籍/);
});
test('依据按结果、原始信息、公告关键补充排序；原文默认折叠且转义',()=>{
 const x=row('a');x.r.commonChecks=[{id:'age',field:'年龄',kind:'年龄',state:'review',unparsed:true,text:'一般为18周岁以上、38周岁以下，特定身份放宽到43周岁以下。<script>bad()</script>',source:'指南·段落1',reason:'暂不能自动判断，请核对完整条款'}];
 const html=evidenceHTML(x,()=>'<p>中药学(B101101)</p>');
 assert.ok(html.indexOf('data-evidence-section="result"')<html.indexOf('data-evidence-section="original"'));
 assert.ok(html.indexOf('data-evidence-section="original"')<html.indexOf('data-evidence-section="announcement"'));
 assert.ok(!html.includes('暂不能自动判断'));assert.ok(!html.includes('<script>'));
 assert.match(html,/其他关键补充/);assert.match(html,/&lt;script&gt;/);
});
test('共性条款提炼要点、合并多个判断信息，不重复通用失败说明',()=>{
 const c={id:'x',field:'户籍',source:'指南',text:'具体条款',state:'review',reason:'请补充持证起始日'};
 const html=commonCards([c,{...c,state:'fail',reason:'持证未满一年'}]);assert.match(html,/持证未满一年/);assert.match(html,/请补充持证起始日/);
 assert.equal((html.match(/<article/g)||[]).length,1);
 assert.match(commonHeadline({unparsed:true,text:'答：一般18周岁以上，38周岁以下，特定人员放宽。',field:'年龄'}),/含身份例外/);
});
