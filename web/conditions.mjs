// Conservative, clause-level checks. Unsupported grammar is never a pass.
const compact=s=>String(s??'').replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
export function conditionClauses(j){
 const sources=j.conditionSources??(j.other?[{column:'其他要求/备注',text:j.other}]:[]);
 return sources.flatMap(({column,text})=>String(text).split(/[;；\r\n]+/).map(s=>s.trim()).filter(Boolean).map(text=>({column,text})));
}
export const conditionAnswerKey=(j,column,text)=>JSON.stringify([j.datasetId||'',column,compact(text)]);
export function checkConditions(j,p){
 return conditionClauses(j).map(({column,text})=>{
  const t=compact(text).replace(/^答[:：]/,'').replace(/^[一二三四五六七八九十\d]+[、.．]/,'').replace(/[。.]$/,'');
  let kind='其他限制',state='review',explanation='暂不能自动判断，请核对完整条款',manualEligible=false,manual=false;
  const choose=(field,value,allowed)=>{kind=field;state=!value?'review':allowed.includes(value)?'pass':'fail';explanation=!value?'个人档案尚未填写':state==='pass'?'按自报条件初筛符合':'与自报条件不符';};
  if(/^(不限|无|无要求|不限制)$/.test(t)) {state='pass';explanation='此列明确无要求';}
  else if(/^(?:限|仅限|要求)?(?:男性|女性|男|女)(?:报考)?$/.test(t)) choose('性别',p.sex,[t.includes('男')?'男':'女']);
  else if(t==='中共党员'){
   kind='政治面貌';state=!p.party||p.party==='预备党员'?'review':p.party==='中共党员'?'pass':'fail';explanation=p.party==='预备党员'?'预备党员是否适用需按本次口径核对':!p.party?'尚未填写政治面貌':state==='pass'?'自报中共党员':'限定中共党员，与自报条件不符';
  }
  else if(/^中共党员\(含预备党员\)$/.test(t)) choose('政治面貌',p.party,['中共党员','预备党员']);
  else if(t==='中共党员或共青团员') {
   choose('政治面貌',p.party,['中共党员','共青团员']);
   if(['预备党员','非党员'].includes(p.party)){state='review';explanation='须核对预备党员适用口径或是否具有共青团员身份';}
  }
  else if(t==='非中共党员') choose('政治面貌',p.party,['非党员','共青团员']);
  else if(t.startsWith('非中共党员')){
   kind='政治面貌';state=['中共党员','预备党员'].includes(p.party)?'fail':'review';explanation=state==='fail'?'限定非中共党员，与自报条件不符':'还包含民主党派等限定，请核对完整条款';
   manualEligible=true;
  }
  else if(/^面向[“"「]?服务基层项目人员和退役大学生士兵[”"」]?专门职位$/.test(t)) choose('定向身份',p.serviceIdentity,['服务基层项目人员','退役大学生士兵']);
  else if(t==='通过法律职业资格考试') choose('法律资格',p.lawQualification,['已通过']);
  else if(/^(?:限|仅限|要求|具有|须具有)?(?:上海市?|本市)户籍(?:人员)?(?:报考)?$/.test(t)&&(t.includes('上海')||p.examProvince==='上海')){
   kind='户籍/生源';
   if(p.shHukou==='非上海户籍'){state='fail';explanation='限定上海户籍，与自报户籍不符';}
   else if(p.shHukou==='上海常住户籍'){state='pass';explanation='自报上海常住户籍';}
   else{state='review';explanation='请填写户籍/户口类型；集体户口需按本条适用口径判断';}
  }
  else if(t==='普通高等院校毕业生(非在职)') choose('学历背景',p.studyMode,['普通高校毕业（非在职）']);
  else if(/^录用后需在录用单位工作满\d+年$/.test(t)) choose('最低服务年限',p.serviceCommitment,['接受']);
  else if(/^(限|仅限)(?:应届毕业生|应届高校毕业生)(?:报考)?$/.test(t)){
   kind='应届身份';state=!p.fresh?'review':p.fresh==='往届'?(p.freshException==='需核对公告例外'?'review':'fail'):'pass';
   explanation=state==='fail'?'自报往届且未声明适用例外，与要求不符':state==='review'?'应届身份或公告例外尚未核对':'按自报应届身份初筛';
  }
  else {
   manualEligible=true;
   // Conditionals, exceptions, unions and negative wording remain intact.
   if(/专业|学科|[ABC]\d{4,6}|本科须|研究生报考/.test(t)) kind='专业/学历附加限制';
   else if(/基层项目|退役|专门职位|定向|港澳|民族|族$|残疾/.test(t)) kind='定向身份';
   else if(/资格|证书|证|英语|职称/.test(t)) kind='资格证书';
   else if(/工作经历|工作经验|基层经历/.test(t)) kind='经历要求';
   else if(/应届|届.*毕业/.test(t)) kind='应届身份';
   else if(/户籍|生源|安置地/.test(t)) kind='户籍/生源';
   else if(/服务|工作满\d+年/.test(t)) kind='最低服务年限';
   else if(/年龄|周岁|出生/.test(t)) kind='年龄';
   else if(/政治|党员|团员|党派/.test(t)) kind='政治面貌';
   else if(/心理|体检|测评/.test(t)||/心理|体检/.test(column)) kind='测评/体检';
   else if(/学历|毕业|非在职|全日制/.test(t)) kind='学历背景';
   else if(/性别/.test(column)) kind='性别';
   else if(/户籍|生源/.test(column)) kind='户籍/生源';
   else if(/年龄/.test(column)) kind='年龄';
   else if(/政治面貌/.test(column)) kind='政治面貌';
   else if(/资格/.test(column)) kind='资格证书';
  }
  const answerKey=conditionAnswerKey(j,column,text);
  const answer=p.supplementalAnswers?.[answerKey];
  if(manualEligible&&state!=='fail'&&['yes','no'].includes(answer)){
   manual=true;state=answer==='yes'?'pass':'fail';
   explanation=answer==='yes'?'由你自行核对并确认符合整条（含适用范围和例外），非程序自动认定':'由你自行核对并确认不符合整条';
  }
  return {field:'备注·'+kind,kind,state,reason:`【${column}】${text}（${explanation}）`,source:column,text,remark:true,manualEligible,manual,answerKey};
 });
}
