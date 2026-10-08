#!/usr/bin/env node
// Inject dashboard-data.json into template.html -> savings-cases-dashboard.html
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const tpl = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'dashboard-data.json'), 'utf8');
const out = tpl.replace('__DATA__', () => data.replace(/<\/script>/gi, '<\\/script>'));
const dest = path.join(ROOT, 'savings-cases-dashboard.html');
fs.writeFileSync(dest, out);
console.log(`wrote ${dest} (${(out.length / 1024).toFixed(1)} KB, self-contained)`);
