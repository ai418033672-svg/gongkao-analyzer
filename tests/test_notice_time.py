import unittest
from datetime import datetime,date
from notice_time import *
from collector import notice_links

AT=datetime(2026,11,2,12,0,tzinfo=CHINA)
def extract(text,published='2026-10-30',title='招聘公告'):
    return extract_registration('<div class="zw"><p>'+text+'</p></div>',published,title)

class NoticeTimeTests(unittest.TestCase):
 def test_real_guangdong_short_day_and_exam_year_not_used(self):
    t=extract('报名时间 2026年11月2日9︰00至6日16︰00',title='广东省2027年考试录用公务员公告')
    self.assertEqual(t['windows'][0]['end'],'2026-11-06T16:00:00+08:00');self.assertEqual(registration_state(t,AT)['state'],'open')
 def test_publication_year_fallback_not_exam_title(self):
    t=extract('报名时间：11月2日9:00至11月6日16:00',title='2027年招聘公告')
    self.assertEqual(t['windows'][0]['start'],'2026-11-02T09:00:00+08:00')
    self.assertEqual(extract('报名时间11月2日至6日',published='',title='2027年招聘公告')['windows'],[])
 def test_closed_and_future_and_exact_boundary(self):
    t=extract('报名时间2026年11月2日9时至11月6日16时')
    self.assertEqual(registration_state(t,datetime(2026,11,2,8,59,tzinfo=CHINA))['state'],'upcoming')
    self.assertEqual(registration_state(t,datetime(2026,11,6,16,0,tzinfo=CHINA))['state'],'open')
    self.assertEqual(registration_state(t,datetime(2026,11,6,16,0,1,tzinfo=CHINA))['state'],'closed')
 def test_payment_qualification_and_exam_dates_not_deadlines(self):
    t=extract('学历取得截止2026年9月30日。缴费时间2026年11月14日至16日。笔试时间2026年12月6日。')
    self.assertEqual(t['windows'],[])
    t=extract('报名时间2026年10月1日至10月5日，缴费时间2026年11月1日至11月9日')
    self.assertEqual(t['windows'][0]['end'],'2026-10-05T23:59:59+08:00');self.assertEqual(registration_state(t,AT)['state'],'closed')
 def test_date_only_ends_at_china_day_end(self):
    t=extract('报名截止：2026年11月2日')
    self.assertEqual(t['windows'][0]['endPrecision'],'day');self.assertEqual(registration_state(t,AT)['state'],'unknown')
    self.assertEqual(registration_state(t,datetime(2026,11,3,tzinfo=CHINA))['state'],'closed')
 def test_standalone_heading_followed_by_range(self):
    t=extract_registration('<p>（一）报名时间</p><p>2026年11月2日09:00至2026年11月8日18:00。</p>','2026-10-30','招聘公告')
    self.assertEqual(registration_state(t,AT)['state'],'open')
 def test_multiple_batches_and_unresolved_extension_not_called_open(self):
    t=extract_registration('<p>第一批报名时间2026年10月1日至5日。</p><p>第二批报名时间2026年11月1日至5日。</p>','2026-10-30','招聘公告')
    self.assertEqual(len(t['windows']),2);self.assertEqual(registration_state(t,AT)['state'],'unknown')
    t=extract('原报名时间2026年10月1日至5日。现延期，新的报名时间另行通知。',title='延期公告')
    self.assertEqual(registration_state(t,AT)['state'],'unknown')
 def test_stage_and_cancellation_and_partial_cancellation(self):
    self.assertEqual(registration_state(extract('正文',title='拟聘用人员公示'),AT)['state'],'stage')
    self.assertEqual(registration_state(extract('经研究，现取消本次公开招聘。'),AT)['state'],'closed')
    self.assertEqual(registration_state(extract('取消部分岗位招聘计划。'),AT)['state'],'unknown')
    self.assertFalse(extract('不得取消本次公开招聘。')['cancelled'])
    self.assertNotEqual(registration_state(extract('报名时间2026年11月1日至5日',title='事业单位面试考核公开招聘公告'),AT)['state'],'stage')
 def test_unknown_publication_never_uses_discovery_time(self):
    s={**DEFAULT_SETTINGS}
    self.assertIsNone(publication_in_range('',s,date(2026,11,2)))
    self.assertFalse(publication_in_range('2025-10-30 12:00',s,date(2026,11,2)))
    self.assertTrue(publication_in_range('2026-10-04',s,date(2026,11,2)))
    self.assertFalse(publication_in_range('2026-10-03',s,date(2026,11,2)))
 def test_custom_period_and_bad_settings(self):
    s=normalized_settings({'period':'custom','from':'2026-10-01','to':'2026-10-31','availability':'all'})
    self.assertTrue(publication_in_range('2026-10-31',s));self.assertFalse(publication_in_range('2026-11-01',s))
    for data in ({'period':'custom'},{'period':'custom','from':'2026-11-01','to':'2026-10-01'},{'period':'custom','from':'2026-02-30'},{'availability':'invalid'}):
      with self.assertRaises(ValueError):normalized_settings(data)
 def test_list_date_binding_uses_local_row_not_adjacent_article(self):
    html='<ul><li><a href="/a.html">2027公务员招聘公告</a><span>2026-10-30</span></li><li><span>2025-10-20</span><a href="/b.html">2026公务员招聘公告</a></li></ul>'
    items=notice_links(html,'https://example.gov.cn/list.html','招聘')
    self.assertEqual([i['publishedAt'] for i in items],['2026-10-30','2025-10-20'])
 def test_afternoon_and_year_rollover(self):
    t=extract('报名时间2026年12月30日上午9时至1月3日下午5时')
    self.assertEqual(t['windows'][0]['end'],'2027-01-03T17:00:00+08:00')
 def test_single_day_clock_range_and_end_time_label(self):
    t=extract('报名时间2026年11月2日上午9时至下午5时')
    self.assertEqual(t['windows'][0]['end'],'2026-11-02T17:00:00+08:00');self.assertEqual(registration_state(t,AT)['state'],'open')
    t=extract('报名结束时间为2026年11月1日17时')
    self.assertEqual(registration_state(t,AT)['state'],'closed')
    t=extract('报名截止2027年1月3日（下午5时）',published='2026-12-30')
    self.assertEqual(t['windows'][0]['end'],'2027-01-03T17:00:00+08:00')

if __name__=='__main__':unittest.main()
