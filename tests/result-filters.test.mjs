import test from 'node:test';
import assert from 'node:assert/strict';
import {resultFacets,matchesResultFilters} from '../web/result-filters.mjs';
import {evaluate} from '../web/rules.mjs';
const job={education:'本科',degree:'不限',major:'不限',fresh:'不限',experience:'不限',other:'',notes:[]};
const item=(j=job,p={education:'本科'})=>{const r=evaluate(j,p);return {j,r,facets:resultFacets(j,r)};};
test('三不限和不限专业可以分别隐藏，不混淆有应届要求的岗位',()=>{
 const three=item(),fresh=item({...job,fresh:'应届毕业生'}),limited=item({...job,major:'纺织类(B0817)'},{education:'本科',majorCode:'B0817'});
 assert.equal(matchesResultFilters(three,{scope:'hideThree'}),false);
 assert.equal(matchesResultFilters(fresh,{scope:'hideThree'}),true);
 assert.equal(matchesResultFilters(fresh,{scope:'hideUnlimited'}),false);
 assert.equal(matchesResultFilters(limited,{scope:'hideUnlimited'}),true);
 assert.equal(matchesResultFilters(limited,{scope:'onlyThree'}),false);
});
test('三不限仍可有定向和资格门槛，多类筛选不会改变资格状态',()=>{
 const row=item({...job,other:'面向服务基层项目人员和退役大学生士兵专门职位；通过法律职业资格考试'});
 assert.equal(row.facets.three,true);
 assert.equal(row.facets.pending,true);
 assert.deepEqual(row.facets.groups.map(g=>g.kind),['定向身份','资格证书']);
 assert.equal(matchesResultFilters(row,{blocked:new Set(['定向身份'])}),false);
 assert.equal(matchesResultFilters(row,{kind:'资格证书'}),true);
 assert.equal(row.r.status,'review');
});
test('未识别备注列和整表限制不能归为没有岗位备注',()=>{
 const missing=item({...job,available:['major','education']});
 assert.equal(matchesResultFilters(missing,{remarkState:'none'}),false);
 assert.equal(matchesResultFilters(missing,{remarkState:'pending'}),true);
 const notes=item({...job,notes:['最低服务年限5年']});
 assert.equal(matchesResultFilters(notes,{remarkState:'none'}),false);
 assert.equal(matchesResultFilters(notes,{kind:'整表说明'}),true);
});
test('明确无要求可归为未发现备注，未识别内容保留其他限制',()=>{
 assert.equal(matchesResultFilters(item({...job,other:'无'}),{remarkState:'none'}),true);
 const unknown=item({...job,other:'须符合附件中的特殊安排'});
 assert.equal(matchesResultFilters(unknown,{remarkState:'none'}),false);
 assert.equal(matchesResultFilters(unknown,{kind:'其他限制'}),true);
});
test('备注全部匹配和待核对互斥，但全部匹配不表示完整资格通过',()=>{
 const passed=item({...job,other:'女性'},{education:'本科',sex:'女'});
 assert.equal(matchesResultFilters(passed,{remarkState:'cleared'}),true);
 assert.equal(matchesResultFilters(passed,{remarkState:'pending'}),false);
 const pending=item({...job,other:'女性'});
 assert.equal(matchesResultFilters(pending,{remarkState:'cleared'}),false);
});
test('同一类别只计一次，隐藏条件按并集排除',()=>{
 const row=item({...job,other:'须有资格证书；须通过英语考试'});
 assert.equal(row.facets.groups.length,1);
 assert.equal(matchesResultFilters(row,{blocked:new Set(['资格证书','户籍/生源'])}),false);
 assert.equal(matchesResultFilters(row,{blocked:new Set(['政治面貌'])}),true);
});
