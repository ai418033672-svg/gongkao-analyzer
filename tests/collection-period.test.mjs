import test from 'node:test';import assert from 'node:assert/strict';
import {defaultPeriod,chinaDay,noticeValidity,selectNotices,inPeriod} from '../web/collection-period.mjs';
const at=Date.parse('2026-11-02T12:00:00+08:00');
const n=(id,publishedAt,start,end,extra={})=>({id,publishedAt,firstSeenAt:'2026-11-02T00:00:00Z',timing:{windows:start||end?[{start,end}]:[],...extra}});
const open=n('open','2026-10-30','2026-11-02T09:00:00+08:00','2026-11-06T16:00:00+08:00');
const closed=n('closed','2026-10-31','2026-10-25T00:00:00+08:00','2026-11-01T23:59:59+08:00');
const future=n('future','2026-10-31','2026-11-05T09:00:00+08:00','2026-11-10T16:00:00+08:00');
const old=n('old','2025-10-30','','');
const unknown=n('unknown','2026-11-01','','');
test('默认近30天隐藏已截止和历史，未知不冒充可报名',()=>{
 const selected=selectNotices([open,closed,future,old,unknown],defaultPeriod,at);
 assert.deepEqual(new Set(selected.map(n=>n.id)),new Set(['open','future','unknown']));
 assert.equal(noticeValidity(unknown,at).state,'unknown');
});
test('报名状态单独过滤，不拿公告发布时间当截止日期',()=>{
 assert.deepEqual(selectNotices([open,closed,future,unknown],{...defaultPeriod,availability:'open'},at).map(n=>n.id),['open']);
 assert.equal(noticeValidity(closed,at).state,'closed');
 assert.equal(noticeValidity(future,at).state,'upcoming');
});
test('全部历史与自定义范围可主动查看已截止资料',()=>{
 assert.equal(selectNotices([open,closed,future,old,unknown],{...defaultPeriod,period:'all',availability:'all'},at).length,5);
 const s={...defaultPeriod,period:'custom',from:'2025-10-01',to:'2025-10-31',availability:'all'};
 assert.deepEqual(selectNotices([open,old],s,at).map(n=>n.id),['old']);
});
test('未知发布日期不使用新发现时间冒充新公告',()=>{
 const x={...unknown,publishedAt:''};assert.equal(inPeriod(x,defaultPeriod,at),true);
 assert.equal(x.publishedAt,'');
});
test('北京时区午夜边界和精确截止动态更新',()=>{
 assert.equal(chinaDay(Date.parse('2026-11-02T16:01:00Z')),'2026-11-03');
 assert.equal(noticeValidity(open,Date.parse(open.timing.windows[0].end)).state,'open');
 assert.equal(noticeValidity(open,Date.parse(open.timing.windows[0].end)+1).state,'closed');
});
test('多批次和另行通知不认定为报名中，后续环节默认隐藏',()=>{
 const multi={...open,timing:{windows:[...open.timing.windows,{start:'2026-12-01T00:00:00+08:00',end:'2026-12-03T00:00:00+08:00'}]}};
 assert.equal(noticeValidity(multi,at).state,'unknown');
 const stage={...unknown,timing:{kind:'stage',windows:[]}};
 assert.equal(selectNotices([stage],defaultPeriod,at).length,0);
 assert.equal(selectNotices([stage],{...defaultPeriod,availability:'closed'},at).length,1);
});
