import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from collector import Collector, Fetcher, ArticleHTML, canonical, public_addresses, notice_links, attachment_links, digest
from server import parse, sheets
from package_import import import_files

BASE='https://example.gov.cn'
HTML='<html><body><h1>广东2027公务员招录公告</h1><p>限应届毕业生报考</p><a href="/jobs.csv">附件1：职位表</a></body></html>'
CSV='职位代码,职位名称,学历,专业\n001,测试岗位,本科,中药学\n'.encode()

class FakeFetcher:
    def __init__(self,pages): self.pages=pages;self.calls=[]
    def get(self,url,limit=None):
        self.calls.append(url)
        value=self.pages[url]
        if isinstance(value,Exception): raise value
        return {'url':url,'data':value.encode() if isinstance(value,str) else value,'headers':{'content-type':'text/html; charset=utf-8'},'status':200}

class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.pages={BASE+'/list.html':'<a href="/notice.html">广东2027公务员招录公告</a>',BASE+'/notice.html':HTML,BASE+'/jobs.csv':CSV}
        self.c=Collector(self.tmp.name,lambda:FakeFetcher(self.pages))
        self.c.configure([{'name':'测试官网','url':BASE+'/list.html','keywords':'招录','enabled':True}])
    def run_check(self,id=None):
        self.c.job={'status':'running','logs':[]}; self.c.run(id); return self.c.view()
    def test_discover_download_import_and_restart(self):
        state=self.run_check();n=state['notices'][0];r=n['revisions'][0]
        self.assertEqual(n['status'],'downloaded');self.assertEqual(len(r['files']),2)
        result=self.c.import_revision(n['id'],r['id'],parse,sheets,import_files)
        self.assertEqual(len(result['files']),2)
        self.assertFalse(any(f['confirmed'] for f in result['files']))
        jobs=next(f for f in result['files'] if f['kind']=='jobs')
        self.assertEqual(jobs['sourceUrl'],BASE+'/jobs.csv');self.assertEqual(jobs['jobs'][0]['code'],'001')
        self.assertEqual(Collector(self.tmp.name).view()['notices'][0]['id'],n['id'])
    def test_unchanged_and_changed_attachment_keep_versions(self):
        n=self.run_check()['notices'][0]
        self.assertEqual(len(self.run_check()['notices'][0]['revisions']),1)
        self.pages[BASE+'/jobs.csv']=CSV.replace(b'001',b'002')
        n=self.run_check(n['id'])['notices'][0]
        self.assertEqual(len(n['revisions']),2)
        old=self.c.import_revision(n['id'],n['revisions'][0]['id'],parse,sheets,import_files)
        self.assertEqual(next(f for f in old['files'] if f['kind']=='jobs')['jobs'][0]['code'],'001')
    def test_failed_attachment_retains_body_and_is_retryable(self):
        self.pages[BASE+'/jobs.csv']=ValueError('超时')
        n=self.run_check()['notices'][0]
        self.assertEqual(n['status'],'partial');self.assertEqual(len(n['revisions'][0]['files']),1)
        self.assertIn('超时',n['revisions'][0]['errors'][0]);self.assertEqual(self.c.job['status'],'partial')
        self.pages[BASE+'/jobs.csv']=CSV
        n=self.run_check(n['id'])['notices'][0]
        self.assertEqual(n['status'],'downloaded');self.assertEqual(len(n['revisions']),2)
    def test_list_failure_keeps_success_time_and_notices(self):
        previous=self.run_check();self.pages[BASE+'/list.html']=ValueError('HTTP 503')
        current=self.run_check()
        self.assertEqual(len(current['notices']),1)
        self.assertEqual(current['sources'][0]['lastSuccessAt'],previous['sources'][0]['lastSuccessAt'])
        self.assertIn('503',current['sources'][0]['error'])
    def test_only_first_three_auto_download_and_no_offsite_articles(self):
        self.pages[BASE+'/list.html']=''.join(f'<a href="/notice{i}.html">招聘测试公告标题{i}</a>' for i in range(6))+'<a href="https://else.gov.cn/a">招聘测试其他公告标题</a>'
        self.c.configure([{'name':'测试官网','url':BASE+'/list.html','keywords':'招聘','enabled':True}])
        for i in range(6):self.pages[BASE+f'/notice{i}.html']=HTML
        n=self.run_check()['notices'];self.assertEqual(len(n),6)
        self.assertEqual(sum(bool(x['revisions']) for x in n),3)
    def test_blob_tamper_not_imported(self):
        n=self.run_check()['notices'][0];r=n['revisions'][0]
        (Path(self.tmp.name)/'files'/r['files'][0]['sha']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'校验失败'):self.c.import_revision(n['id'],r['id'],parse,sheets,import_files)
    def test_source_config_and_busy_guard(self):
        with self.assertRaises(ValueError): self.c.configure([])
        with self.assertRaises(ValueError): canonical('http://user:password@example.gov.cn/')
        with self.assertRaises(ValueError): canonical('http://example.gov.cn:8765/')
        self.c.job={'status':'running'}
        with self.assertRaises(ValueError): self.c.configure(self.c.state['sources'])
        with self.assertRaises(ValueError): self.c.start()
    def test_public_ip_guard_and_fakeip_limited(self):
        for ip in ('127.0.0.1','192.168.1.1','169.254.169.254','::1','198.18.0.1'):
            with patch('collector.socket.getaddrinfo',return_value=[(None,None,None,None,(ip,443))]):
                with self.assertRaises(ValueError): public_addresses('example.gov.cn',443)
        with patch('collector.socket.getaddrinfo',return_value=[(None,None,None,None,('198.18.0.1',443))]):
            self.assertEqual(public_addresses('example.gov.cn',443,True),['198.18.0.1'])
    def test_robots_disallow_prevents_page_request(self):
        f=Fetcher();calls=[]
        def raw(url,limit):
            calls.append(url);return {'status':200,'data':b'User-agent: *\nDisallow: /secret','headers':{},'url':url}
        f.raw=raw
        with self.assertRaisesRegex(ValueError,'不允许'):f.get(BASE+'/secret')
        self.assertEqual(calls,[BASE+'/robots.txt'])
    def test_extract_links_and_encoded_attachment(self):
        html='<script><a href="/ignore.html">2027招录公告测试</a></script><a href="/n.html#one" title="2027招录公告测试">详情</a><a href="/n.html#two">2027招录公告测试</a><a href="/a%2Exlsx">附件1</a>'
        self.assertEqual(len(notice_links(html,BASE+'/list.html','招录')),1)
        self.assertEqual(attachment_links(html,BASE)[0]['filename'],'附件1.xlsx')
    def test_chinese_paths_are_encoded_without_double_encoding(self):
        url=canonical(BASE+'/附件/职位表.xlsx?名称=指南')
        self.assertNotIn('附件',url);self.assertEqual(canonical(url),url)
        with self.assertRaises(ValueError):canonical('https://example.gov.cn:80/a')
    def test_article_container_removes_navigation_preserves_clauses(self):
        html='<html><nav>其他应届公告</nav><div class="zw"><p>限本科<br>往届可报</p><div>备注要求党员</div></div><footer>导航内容</footer></html>'
        article=ArticleHTML(html)
        self.assertTrue(article.found);self.assertEqual(article.depth,0)
        content=''.join(article.parts)
        self.assertIn('备注要求党员',content);self.assertNotIn('其他应届公告',content);self.assertNotIn('导航内容',content)
    def test_saved_file_access_bound_to_notice_and_version(self):
        n=self.run_check()['notices'][0];r=n['revisions'][0];f=r['files'][1]
        name,data=self.c.saved_file(n['id'],r['id'],f['sha'])
        self.assertEqual(data,CSV)
        with self.assertRaises(ValueError):self.c.saved_file(n['id'],'../state.json',f['sha'])
        with self.assertRaises(ValueError):self.c.saved_file(n['id'],r['id'],'../state.json')
    def test_out_of_period_list_entries_not_fetched_or_added(self):
        self.c.configure_settings({'period':'custom','from':'2026-10-01','to':'2026-11-30','availability':'available'})
        self.pages[BASE+'/list.html']='<li><a href="/notice.html">2027公务员招录公告</a><span>2025-10-30</span></li>'
        fake=FakeFetcher(self.pages);self.c.fetcher_factory=lambda:fake
        state=self.run_check();self.assertEqual(state['notices'],[]);self.assertEqual(fake.calls,[BASE+'/list.html'])
        self.assertEqual(state['job']['status'],'done')
    def test_expired_body_read_but_attachment_not_downloaded(self):
        self.c.configure_settings({'period':'all','availability':'available'})
        self.pages[BASE+'/notice.html']=HTML.replace('<p>限应届毕业生报考</p>','<p>报名时间2025年10月1日至5日。</p>')
        fake=FakeFetcher(self.pages);self.c.fetcher_factory=lambda:fake
        n=self.run_check()['notices'][0]
        self.assertEqual(n['status'],'skipped');self.assertEqual(n['validity']['state'],'closed')
        self.assertEqual(n['revisions'],[]);self.assertNotIn(BASE+'/jobs.csv',fake.calls)
        self.c.configure_settings({'period':'all','availability':'all'})
        n=self.run_check(n['id'])['notices'][0];self.assertEqual(n['status'],'downloaded');self.assertIn(BASE+'/jobs.csv',fake.calls)
    def test_settings_persist_and_unknown_date_is_still_inspected_for_open_filter(self):
        self.c.configure_settings({'period':'all','availability':'open'})
        self.assertEqual(Collector(self.tmp.name).state['settings']['availability'],'open')
        self.pages[BASE+'/notice.html']=HTML.replace('<p>限应届毕业生报考</p>','<p>报名时间2026年11月1日至5日。</p>')
        from datetime import datetime
        from notice_time import CHINA
        with patch('notice_time.china_now',return_value=datetime(2026,11,2,12,tzinfo=CHINA)):
            n=self.run_check()['notices'][0]
        self.assertEqual(n['status'],'downloaded')
    def test_list_refresh_enriches_old_records_without_download(self):
        self.run_check();self.c.configure_settings({'period':'custom','from':'2026-10-01','to':'2026-11-30','availability':'available'})
        self.pages[BASE+'/list.html']='<li><a href="/notice.html">2027公务员招录公告</a><span>2025-10-30</span></li>'
        fake=FakeFetcher(self.pages);self.c.fetcher_factory=lambda:fake
        n=self.run_check()['notices'][0];self.assertEqual(n['publishedAt'],'2025-10-30');self.assertFalse(n['inPublicationRange'])
        self.assertEqual(fake.calls,[BASE+'/list.html']);self.assertEqual(len(n['revisions']),1)

if __name__=='__main__':unittest.main()
