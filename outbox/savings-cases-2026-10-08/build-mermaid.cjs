const fs=require('fs');
const md=fs.readFileSync('cases-flow-mermaid.md','utf8');
const m=md.match(/```mermaid\n([\s\S]*?)```/);
if(!m) throw new Error('mermaid block not found');
const src=m[1];
const lib=fs.readFileSync('vendor/mermaid.min.js','utf8');
const html=`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CAST AI Savings Cases — Mermaid Flow</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#0f172a}
header{padding:20px 28px;border-bottom:1px solid #e2e8f0;background:#fff;display:flex;flex-wrap:wrap;gap:16px;align-items:baseline;justify-content:space-between}
h1{font-size:20px;margin:0}
.gloss{font-size:12.5px;color:#475569;max-width:70ch}
.gloss b{color:#0f172a}
.tabs{display:flex;gap:6px}
.tab{font:600 12px/1 system-ui;letter-spacing:.04em;border:1px solid #cbd5e1;border-radius:8px;padding:8px 14px;background:#fff;color:#334155;cursor:pointer}
.tab.active{background:#0f172a;color:#fff;border-color:#0f172a}
main{padding:24px 28px;overflow-x:auto}
#diagram{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;min-width:1100px}
pre.code{display:none;background:#0f172a;color:#dbeafe;border-radius:14px;padding:20px;font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap}
body[data-view=code] #diagram{display:none}
body[data-view=code] pre.code{display:block}
footer{padding:14px 28px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0}
.mermaid{display:flex;justify-content:center}
.mermaid svg{max-width:none}
</style></head><body data-view="diagram">
<header>
 <div><h1>CAST AI Savings Cases — Detection Flow</h1>
 <div class="gloss"><b>WAS = Workload Autoscaler</b> — CAST AI right-sizes pod CPU/RAM requests → <b>workloadAutoscalerSavings</b>. <b>Node Autoscaler</b> — CAST AI manages the nodes (or steers Karpenter consolidation) → <b>autoscalerSavings / totalSavings</b> (equal). Tracks are independent — never summed. Verified live 2026-10-08, window 2026-09-05→10-05.</div></div>
 <div class="tabs"><button class="tab active" onclick="setView('diagram',this)">Diagram</button><button class="tab" onclick="setView('code',this)">Mermaid source</button></div>
</header>
<main>
<div id="diagram"><pre class="mermaid">${src.replace(/</g,'&lt;').replace(/<br\/>/g,'&lt;br/&gt;').replace(/<\/i>/g,'&lt;/i&gt;').replace(/<i>/g,'&lt;i&gt;').replace(/<b>/g,'&lt;b&gt;').replace(/<\/b>/g,'&lt;/b&gt;').replace(/&lt;(&lt;)/g,'&amp;&lt;')}</pre></div>
<pre class="code">${src.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>
</main>
<footer>CAST AI EU API only · read-only collection · full matrix in CASES.md · raw payloads raw/&lt;id8&gt;/01–07.json</footer>
<script>${lib}</script>
<script>
mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'base',htmlLabels:true,flowchart:{htmlLabels:true,curve:'linear',nodeSpacing:26,rankSpacing:36}});
(async()=>{try{const el=document.querySelector('.mermaid');const {svg,bindFunctions}=await mermaid.render('casesflow',el.textContent);el.innerHTML=svg;if(bindFunctions)bindFunctions(el);}catch(e){document.querySelector('#diagram').innerHTML='<pre style="color:#dc2626">'+String(e&&e.message||e).replace(/</g,'&lt;')+'</pre>';}})();
function setView(v,btn){document.body.dataset.view=v;document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');}
</script>
</body></html>`;
fs.writeFileSync('cases-flow-mermaid.html',html);
console.log('wrote cases-flow-mermaid.html', (html.length/1024/1024).toFixed(1)+'MB');
