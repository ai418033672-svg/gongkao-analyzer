import io,sys,unittest,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import parse,sheets
from package_import import import_files,guess_context,document_blocks

class PackageImportTests(unittest.TestCase):
 def read(self,data,name):return import_files(data,name,parse,sheets)['files']
 def test_zip_mixed_success_and_failure(self):
  memory=io.BytesIO()
  with zipfile.ZipFile(memory,'w') as z:
   z.writestr('广东2027公告.txt','广东省2027年考试录用公务员公告\n限应届毕业生报考')
   z.writestr('损坏.xls',b'bad')
   z.writestr('__MACOSX/._ignore.txt','ignored')
  files=self.read(memory.getvalue(),'资料.zip')
  self.assertEqual(len(files),2);self.assertEqual(files[0]['kind'],'document');self.assertEqual(files[1]['status'],'error')
  self.assertEqual(files[0]['archive'],'资料.zip');self.assertFalse(files[0]['confirmed'])
 def test_docx_paragraph_and_table(self):
  memory=io.BytesIO()
  with zipfile.ZipFile(memory,'w') as z:
   z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>广东省2027年报考指南</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>中药学(B101101)</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
  f=self.read(memory.getvalue(),'报考指南.docx')[0]
  self.assertEqual(f['role'],'guide');self.assertEqual(f['kind'],'document');self.assertEqual(len(f['blocks']),2)
  self.assertIn('B101101',f['blocks'][1]['text'])
 def test_catalog_spreadsheet_is_document(self):
  f=self.read('专业名称,专业代码\n中药学,B101101'.encode(),'广东2027专业目录.csv')[0]
  self.assertEqual(f['kind'],'document');self.assertEqual(f['role'],'catalog')
 def test_html_strips_scripts_and_keeps_text(self):
  blocks,_=document_blocks('<h1>公告</h1><script>丢弃</script><p>限应届毕业生</p>'.encode(),'x.html')
  self.assertEqual([b['text'] for b in blocks],['公告','限应届毕业生'])
 def test_pdf_missing_page_not_silently_complete(self):
  from pypdf import PdfWriter
  from pypdf.generic import DecodedStreamObject,DictionaryObject,NameObject
  writer=PdfWriter();page=writer.add_blank_page(width=200,height=200)
  font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
  page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
  stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 10 100 Td (Notice eligibility requirements) Tj ET');page[NameObject('/Contents')]=stream
  writer.add_blank_page(width=200,height=200);out=io.BytesIO();writer.write(out)
  f=self.read(out.getvalue(),'公告.pdf')[0]
  self.assertEqual(f['status'],'partial');self.assertTrue(f['blocks']);self.assertTrue(f['warnings'])
 @unittest.skipUnless((Path(__file__).resolve().parents[1]/'data/广东2027职位表.xls').exists(), '可选本机真实样本未提供')
 def test_real_xls_import_provenance(self):
  p=Path(__file__).resolve().parents[1]/'data/广东2027职位表.xls';f=self.read(p.read_bytes(),p.name)[0]
  self.assertEqual(f['kind'],'jobs');self.assertEqual(len(f['jobs']),8211);self.assertEqual(len(f['id']),64)
  self.assertEqual(f['context']['province'],'广东')
 def test_archive_limits_return_visible_error(self):
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as z:
   for n in range(101):z.writestr(f'{n}.txt','内容')
  f=self.read(out.getvalue(),'过多.zip')[0];self.assertEqual(f['status'],'error');self.assertIn('条目',f['error'])

if __name__=='__main__':unittest.main()
