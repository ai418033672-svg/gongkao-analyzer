// Display facets never change eligibility decisions or mark unknown clauses as passed.
export const remarkKinds=['定向身份','户籍/生源','资格证书','政治面貌','性别','应届身份','经历要求','最低服务年限','专业/学历附加限制','学历背景','年龄','测评/体检','整表说明','其他限制'];
const kindOf=kind=>kind==='法律资格'?'资格证书':remarkKinds.includes(kind)?kind:'其他限制';
export function resultFacets(j,r){
 const clauses=(r.conditions||[]).filter(c=>!(/^(不限|无|无要求|不限制)[。.]?$/.test((c.text||'').trim())&&c.state==='pass'));
 const notes=(j.notes||[]).filter(n=>/最低服务|年限|条件|配套/.test(n)).map(text=>({kind:'整表说明',state:'review',text}));
 const groups=new Map();
 for(const c of [...clauses,...notes]){
  const kind=kindOf(c.kind),old=groups.get(kind);
  const state=old?.state==='fail'||c.state==='fail'?'fail':old?.state==='review'||c.state==='review'?'review':'pass';
  groups.set(kind,{kind,state});
 }
 const unknown=Boolean(j.available&&!j.available.includes('other'));
 return {three:Boolean(r.flags?.major&&r.flags?.fresh&&r.flags?.experience),unlimited:Boolean(r.flags?.major),
  groups:[...groups.values()],clauses:[...clauses,...notes],unknown,
  pending:unknown||[...groups.values()].some(g=>g.state==='review'),has:groups.size>0,
  cleared:!unknown&&groups.size>0&&[...groups.values()].every(g=>g.state==='pass')};
}
export function matchesResultFilters(item,filters={}){
 const f=item.facets||resultFacets(item.j,item.r);
 if(filters.scope==='hideThree'&&f.three||filters.scope==='onlyThree'&&!f.three||filters.scope==='hideUnlimited'&&f.unlimited)return false;
 if(filters.remarkState==='none'&&(f.has||f.unknown)||filters.remarkState==='pending'&&!f.pending||filters.remarkState==='cleared'&&!f.cleared)return false;
 if(filters.kind&& !f.groups.some(g=>g.kind===filters.kind))return false;
 if(f.groups.some(g=>filters.blocked?.has(g.kind)))return false;
 return true;
}
