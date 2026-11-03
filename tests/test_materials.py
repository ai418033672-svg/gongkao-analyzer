import tempfile
import unittest
from unittest.mock import patch
from collector import Collector, attachment_links
from test_collector import BASE, HTML, CSV, FakeFetcher


class MaterialsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.fetcher=FakeFetcher({BASE+'/notice.html':HTML,BASE+'/jobs.csv':CSV})
        self.c=Collector(self.tmp.name,lambda:self.fetcher)
        self.item={'id':'test','url':BASE+'/notice.html','title':'广东2027公务员招录公告','province':'广东','year':'2027','publishedAt':'2026-11-02','expectedAttachments':True}

    def run_batch(self):
        with patch.object(self.c,'material_catalog',return_value={'entries':[self.item]}),patch('collector.threading.Thread'):
            self.c.start_materials(['test'])
        self.c.run_materials([self.item])
        return self.c.state['notices'][0]

    def test_batch_only_selected_and_complete_local_zero_network(self):
        n=self.run_batch();self.assertEqual(n['status'],'downloaded')
        self.fetcher.calls.clear();self.run_batch()
        self.assertEqual(self.fetcher.calls,[])
        self.assertEqual(len(n['revisions']),1)
        self.assertEqual(self.c.job['status'],'done')

    def test_normal_update_reuses_assets_force_check_detects_same_url_replacement(self):
        n=self.run_batch();self.fetcher.calls.clear()
        self.fetcher.pages[BASE+'/jobs.csv']=CSV.replace(b'001',b'002')
        self.c.collect(n,self.fetcher,force=False)
        self.assertEqual(self.fetcher.calls,[BASE+'/notice.html'])
        self.assertEqual(len(n['revisions']),1)
        self.c.collect(n,self.fetcher,force=True)
        self.assertEqual(len(n['revisions']),2)

    def test_corrupt_local_file_redownloaded(self):
        n=self.run_batch();asset=n['revisions'][-1]['files'][1]
        (self.c.root/'files'/asset['sha']).write_bytes(b'corrupt')
        self.assertFalse(self.c.local_complete(n))
        self.fetcher.calls.clear();self.run_batch()
        self.assertIn(BASE+'/jobs.csv',self.fetcher.calls)
        self.assertTrue(self.c.local_complete(n))

    def test_partial_retries_only_missing_files(self):
        self.fetcher.pages[BASE+'/notice.html']=HTML.replace('</body>','<a href="/extra.csv">补充表</a></body>')
        self.fetcher.pages[BASE+'/extra.csv']=ValueError('超时')
        n=self.run_batch();self.assertEqual(n['status'],'partial')
        self.fetcher.calls.clear();self.fetcher.pages[BASE+'/extra.csv']=CSV
        n=self.run_batch();self.assertEqual(n['status'],'downloaded')
        self.assertEqual(self.fetcher.calls,[BASE+'/notice.html',BASE+'/extra.csv'])

    def test_expected_attachment_not_found_is_partial(self):
        self.fetcher.pages[BASE+'/notice.html']='<html><h1>职位表</h1><p>附件待加载</p></html>'
        n=self.run_batch();self.assertEqual(n['status'],'partial')
        self.assertFalse(self.c.local_complete(n))

    def test_batch_validation_atomic_busy_unknown_empty(self):
        for ids in ([],['missing'],[{}]):
            with self.assertRaises(ValueError):self.c.start_materials(ids)
        self.assertEqual(self.c.state['notices'],[])
        self.c.job={'status':'running'}
        with self.assertRaises(ValueError):self.c.start_materials(['test'])

    def test_official_query_download_and_literal_script_anchors(self):
        text='''<a href="/module/download/downfile.jsp?classid=0&amp;filename=abc.doc">专业目录.doc</a>
        <script>document.write('<a href="./P020.xlsx">南京职位表.xlsx</a>');</script>
        <script>const ignored='<a href="/ignored.xls">忽略</a>';</script>'''
        links=attachment_links(text,BASE+'/news/article.html')
        self.assertEqual([a['filename'] for a in links],['专业目录.doc','南京职位表.xlsx'])
        self.assertEqual(links[1]['url'],BASE+'/news/P020.xlsx')
