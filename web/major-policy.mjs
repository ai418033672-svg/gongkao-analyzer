// A catalog is a scoped relation graph, not a nationwide code-prefix convention.
const norm=s=>String(s??'').replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
const levels=new Set(['大专','本科','硕士','博士','研究生']);
export function validateMajorPolicy(value){
 if(!value||value.format!=='gongkao-major-policy'||value.version!==1)throw Error('专业规则文件格式或版本不支持');
 const {context,source,nodes,edges,strategy}=value;
 if(!context||typeof context.province!=='string'||!context.province||typeof context.year!=='string'||!/^20\d{2}$/.test(context.year)||typeof context.examType!=='string'||!context.examType)throw Error('专业规则需指定省份、年度和考试类型');
 if(!source||typeof source.title!=='string'||!source.title||typeof source.url!=='string'||!/^https?:\/\//.test(source.url))throw Error('专业规则需提供文件名称及公开依据链接');
 if(!['hierarchy','enumeration','exact'].includes(strategy)||!Array.isArray(nodes)||!nodes.length||nodes.length>20000||!Array.isArray(edges)||edges.length>50000)throw Error('专业规则策略或规模不正确');
 const ids=new Map(),codes=new Set(),names=new Set();
 for(const node of nodes){
  if(!node||typeof node.id!=='string'||!node.id||ids.has(node.id)||typeof node.name!=='string'||!node.name||!levels.has(node.education)||!['category','major'].includes(node.kind)||node.code!==undefined&&(typeof node.code!=='string'||!node.code)||node.aliases!==undefined&&(!Array.isArray(node.aliases)||node.aliases.some(a=>typeof a!=='string'||!a)))throw Error('专业节点格式不正确或ID重复');
  const nameKey=node.education+'|'+norm(node.name);
  if(names.has(nameKey))throw Error('同学历专业名称重复');names.add(nameKey);
  const code=node.code&&node.education+'|'+norm(node.code).toUpperCase();
  if(code&&codes.has(code))throw Error('同学历专业代码重复');if(code)codes.add(code);
  ids.set(node.id,node);
 }
 const children=new Map(),indegree=new Map(nodes.map(n=>[n.id,0]));
 for(const edge of edges){
  const parent=ids.get(edge?.parent),child=ids.get(edge?.child);
  if(!parent||!child||parent.education!==child.education||parent.kind!=='category'||strategy==='exact'||strategy==='enumeration'&&child.kind!=='major'||!edge.evidence||typeof edge.evidence.text!=='string'||!edge.evidence.text||typeof edge.evidence.location!=='string'||!edge.evidence.location)throw Error('专业关系或原文证据不正确');
  if(!children.has(parent.id))children.set(parent.id,[]);children.get(parent.id).push(child.id);indegree.set(child.id,indegree.get(child.id)+1);
 }
 const queue=[...indegree].filter(([,n])=>!n).map(([id])=>id);let count=0;
 for(let i=0;i<queue.length;i++){count++;for(const id of children.get(queue[i])||[]){indegree.set(id,indegree.get(id)-1);if(!indegree.get(id))queue.push(id);}}
 if(count!==nodes.length)throw Error('专业关系不能形成循环');
 return value;
}
export function compileMajorPolicy(value){
 const policy=validateMajorPolicy(value),byId=new Map(policy.nodes.map(n=>[n.id,n])),children=new Map();
 for(const edge of policy.edges){if(!children.has(edge.parent))children.set(edge.parent,[]);children.get(edge.parent).push(edge);}
 const names=new Map(),codes=new Map(),requirements=new Map();
 const add=(map,education,text,node)=>{const key=education+'|'+norm(text).toUpperCase();if(!map.has(key))map.set(key,new Set());map.get(key).add(node);};
 for(const node of policy.nodes){
  if(node.code){add(codes,node.education,node.code,node);add(requirements,node.education,node.code,node);}
  for(const name of [node.name,...node.aliases||[]]){
   add(names,node.education,name,node);add(requirements,node.education,name,node);
   if(node.code)add(requirements,node.education,norm(name)+'('+norm(node.code)+')',node);
  }
 }
 return {policy,byId,children,names,codes,requirements,relationCache:new Map()};
}
export function policyForDocuments(docs,pack){
 const policies=docs.filter(f=>f.role==='catalog'&&f.majorPolicy);
 if(!policies.length)return null;
 if(policies.length>1)return {error:'存在多个专业规则文件，请核对版本并仅保留本次适用的一份'};
 try{
  const compiled=compileMajorPolicy(policies[0].majorPolicy),context=compiled.policy.context;
  if(['province','year','examType'].some(k=>context[k]!==pack[k]))return {error:'专业规则的省份、年度或考试类型与资料包不一致'};
  return {...compiled,filename:policies[0].filename};
 }catch(e){return {error:e.message};}
}
function relation(compiled,parent,child){
 const key=JSON.stringify([parent,child]);
 if(compiled.relationCache.has(key))return compiled.relationCache.get(key);
 const queue=[parent],previous=new Map([[parent,null]]);let path=null;
 for(let i=0;i<queue.length;i++){
  const id=queue[i];
  if(id===child){path=[];for(let at=child;previous.get(at);at=previous.get(at).parent)path.unshift(previous.get(at));break;}
  for(const edge of compiled.children.get(id)||[]){if(previous.has(edge.child))continue;previous.set(edge.child,edge);queue.push(edge.child);}
 }
 compiled.relationCache.set(key,path);return path;
}
export function matchCatalog(text,profile,compiled){
 const review=reason=>({state:'review',reason,matched:false});
 if(compiled.error)return review(compiled.error);
 const {policy}=compiled,education=profile.education;
 if(!education)return review('请先选择报考学历，以读取对应专业目录');
 const educations=[education,...(['硕士','博士'].includes(education)?['研究生']:[])];
 const lookup=(map,text)=>[...new Set(educations.flatMap(e=>[...map.get(e+'|'+norm(text).toUpperCase())||[]]))];
 const code=norm(profile.majorCode).toUpperCase(),name=norm(profile.majorName).replace(/\([^()]*\)/g,'');
 const names=n=>[n.name,...n.aliases||[]].map(norm);
 const students=lookup(code?compiled.codes:compiled.names,code||name);
 if(students.length!==1)return review('本人专业未在本次规则文件中唯一定位，请核对名称、代码及学历');
 const student=students[0];
 if(code&&name&&!names(student).includes(name))return review('所填专业名称与代码在本次目录中不对应');
 const tokens=norm(text).split(/[,，;；、\n]+/).filter(Boolean);
 const required=[],unknown=[];
 for(const token of tokens){
  const found=lookup(compiled.requirements,token);
  if(found.length!==1)unknown.push(token);else required.push(found[0]);
 }
 for(const target of required){
  const path=relation(compiled,target.id,student.id);
  if(path){
   const reason=`目录命中：${student.name}${student.code?'('+student.code+')':''} → ${target.name}${target.code?'('+target.code+')':''}`;
   return {state:'pass',reason,matched:true,strategy:policy.strategy,source:policy.source.title+' · '+compiled.filename,url:policy.source.url,
           evidence:path.map(e=>e.evidence),text:path.map(e=>e.evidence.text).join('；')||`目录同一专业：${student.name}`,policyContext:policy.context};
  }
 }
 if(required.some(n=>relation(compiled,student.id,n.id)))return review('只填写了上级类别，不能据此确认符合下级具体专业');
 if(unknown.length)return review('岗位含未在本次目录中唯一识别的专业范围：'+unknown.join('、'));
 return {state:'fail',reason:'本人专业不在岗位要求的本次目录范围内',matched:false};
}
