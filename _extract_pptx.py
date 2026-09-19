import zipfile
import xml.etree.ElementTree as ET
import sys

path = '/var/folders/6f/d1t0_mk542lbwrztssz2rcdh0000gp/T/granular-attachments/2864a5e74-a51d-4367-ac18-e5f20bebf16d/0-CastAI_FT_DISW_Information.pptx'
with zipfile.ZipFile(path) as z:
    for n in sorted(z.namelist()):
        if n.startswith('ppt/slides/slide') and n.endswith('.xml'):
            print(f'--- {n} ---')
            root = ET.fromstring(z.read(n))
            for t in root.iter():
                if t.text and t.text.strip():
                    print(t.text.strip())
            print()
