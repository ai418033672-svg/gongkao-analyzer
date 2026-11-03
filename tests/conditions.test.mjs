import test from 'node:test';import assert from 'node:assert/strict';
import {evaluate,threeFlags} from '../web/rules.mjs';
import {checkConditions,conditionAnswerKey} from '../web/conditions.mjs';
const p={education:'本科',degree:'学士',majorCode:'B101101',fresh:'往届',experience:'2',sex:'男',party:'非党员'};
const j={education:'本科',degree:'学士',majorBachelor:'中药学(B101101)',fresh:'否',experience:'否',notes:[]};
const check=(text,profile=p)=>checkConditions({other:text},profile);
test('多个条件来源逐条保留、任一不符排除',()=>{
 const job={...j,conditionSources:[{column:'其他要求',text:'男性;中共党员'},{column:'备注',text:'通过法律职业资格考试'}]};
 const r=evaluate(job,p);assert.equal(r.conditions.length,3);assert.equal(r.status,'fail');assert.equal(r.conditions[2].source,'备注');
});
test('非党员不反向当成党员，民主党派限制继续待核对',()=>{
 assert.equal(check('非中共党员')[0].state,'pass');
 assert.equal(check('非中共党员（民主党派仅限致公党党员）')[0].state,'review');
 assert.equal(check('非中共党员（民主党派仅限致公党党员）',{...p,party:'中共党员'})[0].state,'fail');
 assert.equal(check('中共党员或共青团员',{...p,party:'共青团员'})[0].state,'pass');
 assert.equal(check('中共党员',{...p,party:'预备党员'})[0].state,'review');
});
test('定向招录无身份排除、未知不通过、身份符合可初筛',()=>{
 const t='面向“服务基层项目人员和退役大学生士兵”专门职位';
 assert.equal(check(t)[0].state,'review');assert.equal(check(t,{...p,serviceIdentity:'无'})[0].state,'fail');
 assert.equal(check(t,{...p,serviceIdentity:'退役大学生士兵'})[0].state,'pass');
 assert.equal(check(t,{...p,serviceIdentity:'其他退役军人'})[0].state,'fail');
});
test('有例外的法考条款不按简单未通过排除',()=>{
 const profile={...p,lawQualification:'未通过'};
 assert.equal(check('通过法律职业资格考试',profile)[0].state,'fail');
 assert.equal(check('通过法律职业资格考试，未通过的录用后需在录用单位工作满5年',profile)[0].state,'review');
 assert.equal(check('法学专业报考者须通过法律职业资格考试',profile)[0].state,'review');
});
test('学历背景和服务年限必须填写，拒绝服务年限排除',()=>{
 assert.equal(check('普通高等院校毕业生（非在职）')[0].state,'review');
 assert.equal(check('录用后需在录用单位工作满5年',{...p,serviceCommitment:'不接受'})[0].state,'fail');
 assert.equal(check('录用后需在录用单位工作满5年',{...p,serviceCommitment:'接受'})[0].state,'pass');
});
test('专业、户籍、年龄、证书复杂限制没有被吞掉',()=>{
 for(const t of ['金融学（A020204），不包含保险学','企业管理（限：财务管理）（A120202）','普通高等院校毕业生（非在职）, 本科须为法学专业且获法学学士学位','限本市户籍','年龄30周岁以下','具有医师执业证书','女性或符合特殊条件的男性']){
  const c=check(t)[0];assert.equal(c.state,'review');assert.equal(c.text,t);
 }
});
test('备注限制覆盖三不限字段且不限专业不能假装代码命中',()=>{
 const r=evaluate({...j,majorBachelor:'不限',other:'本科须为法学专业;限应届毕业生;要求两年工作经历'},p);
 assert.deepEqual(r.flags,{major:false,fresh:false,experience:false});assert.equal(r.majorCodeHit,false);assert.equal(r.status,'fail');
});
test('每一条非空未识别备注都有核对记录，匹配性别不吞掉余项',()=>{
 const r=evaluate({...j,other:'男性;限本地户籍;符合本系统政审要求'},p);
 assert.equal(r.conditions.length,3);assert.equal(r.conditions[0].state,'pass');assert.equal(r.status,'review');
});
test('按表格出现的条款自行确认，明确保留判断来源',()=>{
 const job={...j,datasetId:'sheet-A',conditionSources:[{column:'备注',text:'限本市户籍'}]};
 const key=conditionAnswerKey(job,'备注','限本市户籍');
 const yes=evaluate(job,{...p,supplementalAnswers:{[key]:'yes'}});
 assert.equal(yes.status,'pass');assert.equal(yes.conditions[0].manual,true);assert.match(yes.conditions[0].reason,/自行核对/);
 assert.equal(evaluate(job,{...p,supplementalAnswers:{[key]:'no'}}).status,'fail');
 assert.equal(evaluate(job,{...p,supplementalAnswers:{[key]:''}}).status,'review');
 assert.equal(evaluate({...job,datasetId:'sheet-B'},{...p,supplementalAnswers:{[key]:'yes'}}).status,'review');
});
test('自行确认不能覆盖已识别的明确冲突',()=>{
 const job={...j,datasetId:'sheet-A',conditionSources:[{column:'备注',text:'非中共党员（民主党派仅限致公党党员）'}]};
 const key=conditionAnswerKey(job,'备注',job.conditionSources[0].text);
 assert.equal(evaluate(job,{...p,party:'中共党员',supplementalAnswers:{[key]:'yes'}}).status,'fail');
});
