import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from collector import Collector, digest
from source_book import load_catalog
from test_collector import FakeFetcher, BASE, HTML, CSV
from server import parse,sheets
from package_import import import_files

class SourceBookTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.fetcher=FakeFetcher({BASE+'/notice.html':HTML,BASE+'/jobs.csv':CSV})
  self.c=Collector(self.tmp.name,lambda:self.fetcher)
  self.c.configure([{'name':'已有栏目','url':BASE+'/list','keywords':'招聘','enabled':True,'province':'广东','city':'汕头'}])
 def direct(self,url,mode='notice'):
  # Deterministic worker while exercising the actual start validation/state.
  with patch('collector.threading.Thread'):
   self.c.start_link(url,mode)
  n=next(n for n in self.c.state['notices'] if n['url']==url)
  self.c.run(n['id']);return self.c.view()['notices'][0]
 def test_merge_disabled_preserve_existing_and_metadata(self):
  self.c.state['sources'][0]['lastSuccessAt']='old'
  result=self.c.import_sources({'format':'gongkao-source-book','version':1,'sources':[
   {'name':'覆盖尝试','url':BASE+'/list','enabled':False},
   {'name':'新增','url':BASE+'/list2','enabled':True,'province':'江苏','city':'南京','publicationMethod':'专题公告和职位表分开'}]})
  self.assertEqual(len(result['sources']),2)
  self.assertEqual(result['sources'][0]['name'],'已有栏目')
  self.assertTrue(result['sources'][0]['enabled']);self.assertEqual(result['sources'][0]['lastSuccessAt'],'old')
  self.assertFalse(result['sources'][1]['enabled']);self.assertEqual(result['sources'][1]['city'],'南京')
 def test_invalid_import_atomic_and_limit(self):
  before=json.dumps(self.c.state)
  for pack in ({}, {'format':'gongkao-source-book','version':1,'sources':[{'url':'file:///etc/passwd'}]}, {'format':'gongkao-source-book','version':1,'sources':[{'url':BASE+'/new','name':''}]}):
   with self.assertRaises(ValueError):self.c.import_sources(pack)
   self.assertEqual(before,json.dumps(self.c.state))
  with self.assertRaises(ValueError):self.c.configure([{'name':'x','url':BASE+f'/{i}','enabled':True} for i in range(11)])
 def test_direct_notice_title_assets_no_other_source(self):
  n=self.direct(BASE+'/notice.html')
  self.assertEqual(n['title'],'广东2027公务员招录公告');self.assertEqual(len(n['revisions'][0]['files']),2)
  self.assertEqual(self.fetcher.calls,[BASE+'/notice.html',BASE+'/jobs.csv'])
 def test_direct_attachment_dedup_import_and_warning(self):
  n=self.direct(BASE+'/jobs.csv');self.assertEqual(n['status'],'downloaded')
  self.assertTrue(n['revisions'][0]['directAttachment'])
  n=self.direct(BASE+'/jobs.csv');self.assertEqual(len(n['revisions']),1)
  result=self.c.import_revision(n['id'],n['revisions'][0]['id'],parse,sheets,import_files)
  self.assertEqual(result['files'][0]['jobs'][0]['code'],'001')
  self.assertTrue(any('单独附件链接' in w for w in result['files'][0]['warnings']))
  self.assertFalse(any('未定位' in w for w in result['files'][0]['warnings']))
 def test_direct_unknown_and_closed_dates(self):
  self.fetcher.pages[BASE+'/notice.html']='<html><h1>2020年公开招聘公告</h1><div id="zoom">报名时间：2020年1月1日至2020年1月3日。</div></html>'
  n=self.direct(BASE+'/notice.html');self.assertEqual(n['status'],'skipped');self.assertFalse(n['revisions'])
 def test_dynamic_shell_reports_error(self):
  self.fetcher.pages[BASE+'/notice.html']='<html><title>招考专题</title><div id="app"></div><script src="bundle.js"></script></html>'
  n=self.direct(BASE+'/notice.html');self.assertEqual(n['status'],'error');self.assertIn('浏览器',n['error'])
 def test_one_source_only_even_if_disabled(self):
  self.c.configure([*self.c.state['sources'],{'name':'单独栏目','url':BASE+'/two','enabled':False}])
  self.fetcher.pages[BASE+'/two']='<a href="/notice.html">广东2027公务员招录公告</a>'
  with patch('collector.threading.Thread'):
   self.c.start_link(BASE+'/two','list')
  source=self.c.state['sources'][1]
  self.c.run(source_id=source['id'])
  self.assertNotIn(BASE+'/list',self.fetcher.calls);self.assertFalse(source['enabled'])
 def test_reject_local_and_busy_without_records(self):
  for url in ('http://127.0.0.1/a','http://localhost/a','http://[::1]/a','file:///x'):
   with self.assertRaises(ValueError):self.c.start_link(url)
  self.assertFalse(self.c.state['notices'])
  self.c.job={'status':'running'}
  with self.assertRaises(ValueError):self.c.start_link(BASE+'/notice.html')
  self.assertFalse(self.c.state['notices'])
 def test_catalog_coverage_is_explicit(self):
  c=load_catalog(Path(__file__).resolve().parents[1]);self.assertEqual(len(c['entries']),37)
  self.assertEqual(len({s['province'] for s in c['entries']}),31)
  self.assertTrue(all(s.get('evidence') for s in c['entries']))

if __name__=='__main__':unittest.main()
