import {matchCatalog} from './major-policy.mjs';
const clean=s=>String(s??'').replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
export function matchMajor(text,p){
 const norm=clean(text).toUpperCase(),result=(state,reason,matched=false)=>({state,reason,matched});
 if(!text)return result('review','对应学历专业列为空或未识别');
 if(/^(不限|无|无要求|不限制|不限专业|专业不限|不限制专业|不要求)$/.test(clean(text)))return result('pass','对应专业列明确不限');
 if(/不含|不包括|除外|不得|不接受|非.*类|限[:：]|\(限|仅限|方向/.test(norm))return result('review',`含排除条件或方向限制，需核对：${text}`);
 if(p.majorPolicy)return matchCatalog(text,p,p.majorPolicy);
 // Compatibility adapter. Never infer that another province uses Guangdong codes.
 if(p.majorCode){
  if(p.professionalScheme&&p.professionalScheme!=='广东代码')return result('review','当前地区尚无适用专业规则，不能沿用广东代码层级');
  const code=clean(p.majorCode).toUpperCase(),expected={大专:'C',本科:'B',硕士:'A',博士:'A'}[p.education];
  const codes=norm.match(/[ABC]\d{2}(?:\d{2}){0,2}(?!\d)/g)||[];
  if(!/^[ABC](\d{2}|\d{4}|\d{6})$/.test(code)||expected&&code[0]!==expected)return result('review','代码格式或学历层次不符，请用本次考试目录代码');
  if(codes.some(c=>code.startsWith(c)))return result('pass',`代码${code}命中${codes.filter(c=>code.startsWith(c)).join('、')}`,true);
  if(codes.some(c=>c.startsWith(code)))return result('review','只填写了上级代码，不能据此确定符合下级具体专业');
  if(/\b\d{2}[^,，;；]*类/.test(norm)||!codes.length)return result('review','采用专业大类或无标准代码，需查当年专业目录');
  return result('fail','对应学历专业代码未命中');
 }
 if(p.majorName)return result('review',norm.includes(clean(p.majorName).toUpperCase())?'专业名称关键词命中，须用目录代码确认':'名称未命中；上级学科/专业大类仍可能适用，建议填写代码');
 return result('review','未填写专业名称或代码');
}
