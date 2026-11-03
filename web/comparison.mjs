export const MAX_COMPARE=6;
export class ComparisonSelection{
 constructor(){this.ids=new Set();}
 toggle(id,row){
  if(this.ids.has(id)){this.ids.delete(id);return {ok:true};}
  if(!row)return {ok:false,reason:'该岗位已不在当前资料包中'};
  if(row.r.status==='fail')return {ok:false,reason:'已排除岗位不能新增到PK；可以先查看具体冲突'};
  if(this.ids.size>=MAX_COMPARE)return {ok:false,reason:`最多同时对比${MAX_COMPARE}个岗位，请先移除一个`};
  this.ids.add(id);return {ok:true};
 }
 remove(id){this.ids.delete(id);}
 clear(){this.ids.clear();}
 sync(rows,key){const valid=new Set(rows.map(item=>key(item.j)));let removed=0;for(const id of this.ids)if(!valid.has(id)){this.ids.delete(id);removed++;}return removed;}
 rows(rows,key){const map=new Map(rows.map(item=>[key(item.j),item]));return [...this.ids].map(id=>map.get(id)).filter(Boolean);}
}
