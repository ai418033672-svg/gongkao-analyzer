export const defaultPeriod={period:'30',from:'',to:'',availability:'available'};
export const chinaDay=(at=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
export function publishedDay(value){const m=String(value||'').match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:'';}
export function inPeriod(n,s,at=Date.now()){
 const day=publishedDay(n.publishedAt);if(!day||s.period==='all')return true;
 const today=chinaDay(at),from=s.period==='custom'?s.from:new Date(Date.parse(today+'T00:00:00Z')-(Number(s.period)-1)*86400000).toISOString().slice(0,10),to=s.period==='custom'?s.to:today;
 return !(from&&day<from||to&&day>to);
}
export function noticeValidity(n,at=Date.now()){
 const t=n.timing||{},windows=t.windows||[];
 if(t.cancelled)return {state:'closed',label:'招聘已取消'};
 if(t.kind==='stage')return {state:'stage',label:'后续招录环节'};
 const ends=windows.filter(w=>w.end).map(w=>Date.parse(w.end)),starts=windows.filter(w=>w.start).map(w=>Date.parse(w.start));
 if(!t.notes?.length&&windows.length&&ends.length===windows.length&&ends.every(d=>Number.isFinite(d)&&at>d))return {state:'closed',label:'报名已截止'};
 if(t.notes?.length||windows.length>1)return {state:'unknown',label:'时间待核对'};
 if(starts.length===1&&Number.isFinite(starts[0])&&at<starts[0])return {state:'upcoming',label:'尚未开始报名'};
 if(windows.length===1&&starts.length&&ends.length&&at>=starts[0]&&at<=ends[0])return {state:'open',label:'报名期内'};
 return {state:'unknown',label:'时间待核对'};
}
export function matchesAvailability(n,s,at=Date.now()){
 const state=noticeValidity(n,at).state;
 return s.availability==='all'||(s.availability==='available'?['open','upcoming','unknown'].includes(state):s.availability==='closed'?['closed','stage'].includes(state):state===s.availability);
}
export function selectNotices(notices,s,at=Date.now()){
 return notices.filter(n=>inPeriod(n,s,at)&&matchesAvailability(n,s,at)).sort((a,b)=>publishedDay(b.publishedAt).localeCompare(publishedDay(a.publishedAt))||b.firstSeenAt.localeCompare(a.firstSeenAt));
}
