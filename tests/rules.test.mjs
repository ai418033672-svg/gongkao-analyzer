import test from 'node:test';import assert from 'node:assert/strict';
import {evaluate,threeFlags,csvCell} from '../web/rules.mjs';
const p={education:'本科',degree:'学士',majorName:'中药学',majorCode:'B101101',fresh:'往届',experience:'2',sex:'男',party:'非党员'};
const j={education:'本科以上',degree:'学士以上',majorBachelor:'中药学类(B1011)',fresh:'否',experience:'否',experienceThreshold:2,other:'',notes:[]};
test('广东专业代码命中上级，不串学历',()=>{assert.equal(evaluate(j,p).status,'pass');assert.equal(evaluate({...j,majorBachelor:'药学类(B1010)'},p).status,'fail');assert.equal(evaluate(j,{...p,majorCode:'A101101'}).checks.find(c=>c.field==='专业').state,'review');});
test('不能把专业父代码判定为具体专业通过',()=>{assert.equal(evaluate({...j,majorBachelor:'中药学(B101101)'},{...p,majorCode:'B1011'}).status,'review');});
test('纺织类B0817不命中B01；多类别岗位按B08命中并保留依据',()=>{
 const profile={...p,majorName:'纺织类',majorCode:'B0817'};
 for(const majorBachelor of ['哲学(B01)','哲学类(B0101)','哲学(B010101)','法学(B030101）']){
  const result=evaluate({...j,majorBachelor},profile);
  assert.equal(result.majorCodeHit,false);assert.equal(result.status,'fail');
 }
 const result=evaluate({...j,majorBachelor:'哲学(B01),经济学(B02),工学(B08),管理学(B12)'},profile);
 assert.equal(result.majorCodeHit,true);
 assert.equal(result.checks.find(c=>c.field==='专业').reason,'代码B0817命中B08');
 assert.equal(evaluate({...j,majorBachelor:'纺织类(B0817)'},profile).majorCodeHit,true);
 assert.equal(evaluate({...j,majorBachelor:'纺织工程(B081701)'},profile).majorCodeHit,false);
 const lawWithEngineering=evaluate({...j,majorBachelor:'法学(B030101),汉语言文学(B050101),新闻传播学类(B0503),数学类(B0701),工学(B08),农学(B09),管理学(B12)'},profile);
 assert.equal(lawWithEngineering.majorCodeHit,true);
 assert.equal(lawWithEngineering.checks.find(c=>c.field==='专业').reason,'代码B0817命中B08');
 assert.equal(evaluate({...j,majorBachelor:'法学(B030101)',majorGrad:'纺织科学与工程(A0821)',majorCollege:'纺织服装类(C0816)'},profile).majorCodeHit,false);
});
test('应届否/不限否定词/指定年度',()=>{assert.equal(evaluate({...j,fresh:'不限应届毕业生'},p).status,'pass');assert.equal(evaluate({...j,fresh:'应届毕业生'},p).status,'fail');assert.equal(evaluate({...j,fresh:'2027届高校毕业生'},{...p,fresh:'其他应届'}).status,'review');});
test('三不限空字段不能算不限',()=>{assert.equal(threeFlags({...j,majorBachelor:'不限',experience:''},'本科').experience,false);assert.equal(Object.values(threeFlags({...j,majorBachelor:'不限'},'本科')).every(Boolean),true);});
test('性别党员和附加条件',()=>{assert.equal(evaluate({...j,other:'女性'},p).status,'fail');assert.equal(evaluate({...j,other:'中共党员'},p).status,'fail');assert.equal(evaluate({...j,other:'取得资格证'},p).status,'review');});
test('专业大类和排除条件需核对',()=>{assert.equal(evaluate({...j,majorBachelor:'08生物医药类'},p).status,'review');assert.equal(evaluate({...j,majorBachelor:'中药学类(B1011)，不含中药学'},p).status,'review');});
test('学历不自动向下报考，学位必须满足',()=>{assert.equal(evaluate({...j,education:'本科'},{...p,education:'硕士'}).status,'fail');assert.equal(evaluate({...j,degree:'硕士以上'},p).status,'fail');assert.equal(evaluate(j,{...p,degree:''}).status,'review');});
test('基层经历两年边界与缺失',()=>{assert.equal(evaluate({...j,experience:'是'},p).status,'pass');assert.equal(evaluate({...j,experience:'是'},{...p,experience:'1'}).status,'fail');assert.equal(evaluate({...j,experience:''},p).status,'review');});
test('整表说明保留核对',()=>{assert.equal(evaluate({...j,notes:['最低服务年限5年']},p).status,'review');});
test('普通经历列的是不能推断成两年，非应届不误判',()=>{assert.equal(evaluate({...j,experience:'是',experienceThreshold:null},p).status,'review');assert.equal(evaluate({...j,fresh:'非应届毕业生'},p).status,'pass');});
test('导出防止公式注入',()=>{assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell('  @test'),'"\'  @test"');assert.equal(csvCell('正常'),'"正常"');});
test('招考年度不写死2027，毕业年度冲突排除，例外明确待核对',()=>{
 const job={...j,fresh:'2028届高校毕业生'};
 assert.equal(evaluate(job,{...p,fresh:'应届',graduationYear:'2028'}).status,'pass');
 assert.equal(evaluate(job,{...p,fresh:'应届',graduationYear:'2027'}).status,'fail');
 assert.equal(evaluate(job,{...p,fresh:'往届',freshException:'需核对公告例外'}).status,'review');
});
