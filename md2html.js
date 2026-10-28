#!/usr/bin/env node
/**
 * md2html — Versatile Markdown to HTML converter
 *
 * Usage modes:
 *   node md2html.js                          → interactive wizard
 *   node md2html.js <file.md>                → single file, same dir
 *   node md2html.js <file.md> <out.html>     → single file, custom output
 *   node md2html.js <folder>                 → batch convert, asks output
 *   node md2html.js <folder> --out same      → batch, alongside .md files
 *   node md2html.js <folder> --out parallel  → batch, sibling -html folder
 *   node md2html.js <folder> --out <dir>     → batch, custom directory
 *   node md2html.js <path> --watch           → watch & auto-reconvert
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const rl   = require('readline');
const { marked } = require('marked');
const hljs = require('highlight.js');

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const A = {
  bold: s  => isTTY ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:  s  => isTTY ? `\x1b[2m${s}\x1b[0m`  : s,
  green:s  => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  cyan: s  => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  yellow:s => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  red:  s  => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  gray: s  => isTTY ? `\x1b[90m${s}\x1b[0m` : s,
  white:s  => isTTY ? `\x1b[97m${s}\x1b[0m` : s,
};

// ─── Arg parsing ──────────────────────────────────────────────────────────────
function parseArgs(args) {
  const opts = {
    positional: [],
    theme: null,
    out: null,
    toc: null,
    recursive: true,
    open: false,
    watch: false,
    quiet: false,
    overwrite: true,
    interactive: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if      (a === '--theme')                { opts.theme = args[++i]; }
    else if (a === '--out' || a === '--output') { opts.out = args[++i]; }
    else if (a === '--no-toc')               { opts.toc = false; }
    else if (a === '--toc')                  { opts.toc = true; }
    else if (a === '--no-recursive' || a === '--flat') { opts.recursive = false; }
    else if (a === '--open')                 { opts.open = true; }
    else if (a === '--watch' || a === '-w')  { opts.watch = true; }
    else if (a === '--quiet' || a === '-q')  { opts.quiet = true; }
    else if (a === '--interactive' || a === '-i') { opts.interactive = true; }
    else if (a === '--skip-existing')        { opts.overwrite = false; }
    else if (a === '--version' || a === '-v') { console.log('md2html v2.0.0'); process.exit(0); }
    else if (a === '--help' || a === '-h')   { printHelp(); process.exit(0); }
    else if (!a.startsWith('--'))            { opts.positional.push(a); }
  }
  return opts;
}

function printHelp() {
  console.log(`
${A.bold(A.cyan('md2html'))} ${A.bold('— Markdown → HTML converter  v2.0.0')}

${A.bold('USAGE')}
  node md2html.js                                  Interactive wizard
  node md2html.js <file.md>                        Single file → same dir
  node md2html.js <file.md> <output.html>          Single file → custom path
  node md2html.js <folder>                         Batch (asks output location)
  node md2html.js <folder> --out same              Batch → alongside .md files
  node md2html.js <folder> --out parallel          Batch → sibling -html folder
  node md2html.js <folder> --out <dir>             Batch → custom directory
  node md2html.js <path> --watch                   Watch & auto-reconvert

${A.bold('OPTIONS')}
  --out same|parallel|<dir>   Output mode for folders
  --theme dark|light          Color theme  (default: light)
  --toc / --no-toc            Enable/disable table of contents
  --no-recursive, --flat      Only top-level .md files (no sub-folders)
  --skip-existing             Skip files whose .html already exists
  --open                      Open first output in browser when done
  --watch, -w                 Watch for changes and auto-reconvert
  --quiet, -q                 Suppress output except errors
  --interactive, -i           Force interactive wizard
  --version, -v               Print version
  --help, -h                  Show this help

${A.bold('EXAMPLES')}
  node md2html.js README.md --theme dark --open
  node md2html.js docs/ --out parallel --theme dark
  node md2html.js docs/ --out ./site --toc
  node md2html.js src/notes.md --watch
  node md2html.js wiki/ --out parallel --skip-existing --quiet
`);
}

// ─── Interactive wizard ───────────────────────────────────────────────────────
function prompt(question) {
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => iface.question(question, ans => { iface.close(); res(ans.trim()); }));
}

async function askChoice(label, choices, defaultIdx = 0) {
  console.log('');
  console.log(`  ${A.cyan('?')} ${A.bold(label)}`);
  choices.forEach((ch, i) => {
    const marker = i === defaultIdx ? A.green('  ❯') : '   ';
    const hint   = ch.hint ? A.dim('   ' + ch.hint) : '';
    console.log(`${marker} ${A.bold(`${i + 1})`)} ${ch.label}${hint}`);
  });
  const raw = await prompt(A.gray(`  Choice [1-${choices.length}] (↵ = ${defaultIdx + 1}): `));
  const n = parseInt(raw, 10);
  return (n >= 1 && n <= choices.length) ? n - 1 : defaultIdx;
}

async function askText(label, defaultVal = '') {
  const hint = defaultVal ? A.gray(` (${defaultVal})`) : '';
  const raw  = await prompt(`  ${A.cyan('?')} ${A.bold(label)}${hint}\n  ${A.gray('>')} `);
  return raw || defaultVal;
}

async function askYesNo(label, defaultYes = true) {
  const hint = defaultYes ? A.dim(' [Y/n]') : A.dim(' [y/N]');
  const raw  = await prompt(`  ${A.cyan('?')} ${A.bold(label)}${hint}: `);
  const v    = raw.toLowerCase();
  if (!v) return defaultYes;
  return v === 'y' || v === 'yes';
}

async function runWizard(opts) {
  console.log('');
  console.log(A.bold(A.cyan('  ╔══════════════════════════════╗')));
  console.log(A.bold(A.cyan('  ║') + A.white('    md2html  ·  v2.0.0       ') + A.cyan('║')));
  console.log(A.bold(A.cyan('  ╚══════════════════════════════╝')));
  console.log(A.dim('  Markdown → Beautiful HTML converter\n'));

  const inputRaw = await askText('Path to convert (file or folder):');
  if (!inputRaw) { console.error(A.red('  No path provided.')); process.exit(1); }
  const inputPath = path.resolve(inputRaw.replace(/^["']|["']$/g, ''));
  if (!fs.existsSync(inputPath)) { console.error(A.red(`  Not found: ${inputPath}`)); process.exit(1); }

  const isDir = fs.statSync(inputPath).isDirectory();
  let outMode = 'same', customOutDir = null;

  if (isDir) {
    const files = collectMdFiles(inputPath, true);
    console.log(A.dim(`\n  Found ${A.white(String(files.length))} .md file(s)`));

    const parallelPath = path.join(path.dirname(inputPath), path.basename(inputPath) + '-html');
    const idx = await askChoice('Where should the HTML files go?', [
      { label: 'Same directory',         hint: 'place .html next to each .md file' },
      { label: 'Parallel sibling folder',hint: parallelPath },
      { label: 'Custom output directory',hint: 'you specify the path' },
    ]);

    if (idx === 0) { outMode = 'same'; }
    else if (idx === 1) { outMode = 'parallel'; }
    else {
      outMode = 'custom';
      customOutDir = path.resolve(await askText('Output directory path:', parallelPath));
    }

    opts.recursive = await askYesNo('Include files in sub-folders?', true);
  }

  const themeIdx = await askChoice('Color theme:', [
    { label: 'Light', hint: 'clean white background' },
    { label: 'Dark',  hint: 'dark GitHub-style'      },
  ]);
  opts.theme = themeIdx === 0 ? 'light' : 'dark';
  opts.toc   = await askYesNo('Generate table of contents?', true);
  opts.open  = await askYesNo('Open in browser when done?',  false);

  console.log('');
  return { inputPath, isDir, outMode, customOutDir };
}

// ─── File utilities ───────────────────────────────────────────────────────────
function collectMdFiles(dir, recursive) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) results.push(...collectMdFiles(full, recursive));
    else if (entry.isFile() && /\.md$/i.test(entry.name)) results.push(full);
  }
  return results;
}

function resolveOutput(inputFile, outMode, inputBase, outRoot) {
  if (outMode === 'same') return inputFile.replace(/\.md$/i, '.html');
  const rel = path.relative(inputBase, inputFile).replace(/\.md$/i, '.html');
  return path.join(outRoot, rel);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── HTML builder ─────────────────────────────────────────────────────────────
function buildHtml(mdContent, sourceFile, theme, enableToc) {
  const isDark    = theme === 'dark';
  const tocItems  = [];
  let   hIdx      = 0;
  const renderer  = new marked.Renderer();

  renderer.heading = (tok) => {
    const text  = tok && tok.text  != null ? String(tok.text)  : String(tok);
    const level = tok && tok.depth != null ? tok.depth         : 1;
    const slug  = text.replace(/<[^>]+>/g,'').toLowerCase().replace(/[^\w]+/g,'-').replace(/^-|-$/g,'');
    const id    = `h-${slug}-${hIdx++}`;
    if (enableToc && level <= 3) tocItems.push({ level, text: text.replace(/<[^>]+>/g,''), id });
    return `<h${level} id="${id}">${text}<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${level}>\n`;
  };

  renderer.code = (tok) => {
    const code = tok && tok.text != null ? String(tok.text) : String(tok);
    const lang = (tok && tok.lang) ? String(tok.lang) : '';
    const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
    let hi;
    try { hi = hljs.highlight(code, { language, ignoreIllegals: true }).value; }
    catch { hi = hljs.highlightAuto(code).value; }
    const lbl = lang ? `<span class="code-lang">${lang}</span>` : '';
    return `<div class="code-block">${lbl}<button class="copy-btn" onclick="copyCode(this)">Copy</button><pre><code class="hljs language-${language}">${hi}</code></pre></div>`;
  };

  renderer.blockquote = (tok) => {
    const body = tok && tok.body != null ? tok.body : tok && tok.text != null ? tok.text : String(tok);
    return `<blockquote class="blockquote">${body}</blockquote>`;
  };

  renderer.table = (tok) => {
    if (tok && tok.header) {
      const th = tok.header.map(h=>`<th>${h.text}</th>`).join('');
      const tb = tok.rows.map(r=>`<tr>${r.map(cell=>`<td>${cell.text}</td>`).join('')}</tr>`).join('');
      return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
    }
    return `<div class="table-wrap"><table>${tok}</table></div>`;
  };

  renderer.image = (tok) => {
    const href  = tok && tok.href  ? tok.href  : String(tok);
    const title = tok && tok.title ? tok.title : '';
    const alt   = tok && tok.text  ? tok.text  : '';
    return `<figure class="img-figure"><img src="${href}" alt="${alt}"${title?` title="${title}"`:''} loading="lazy"><figcaption>${title||alt}</figcaption></figure>`;
  };

  marked.setOptions({ renderer, gfm: true, breaks: false });
  const body = marked.parse(mdContent);

  // TOC
  function buildToc(items) {
    if (!items.length) return '';
    let h = '<nav class="toc"><p class="toc-title">Contents</p><ol class="toc-list">';
    let prev = items[0].level;
    for (const it of items) {
      if (it.level > prev) h += '<ol class="toc-sub">';
      else if (it.level < prev) h += '</ol>'.repeat(prev - it.level);
      h += `<li><a href="#${it.id}">${it.text}</a></li>`;
      prev = it.level;
    }
    return h + '</ol></nav>';
  }

  const toc     = enableToc && tocItems.length > 1 ? buildToc(tocItems) : '';
  const title   = path.basename(sourceFile, path.extname(sourceFile));
  const dateStr = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});

  // ── Inline CSS (single source of truth) ──────────────────────────────────
  const css = `
:root {
  --bg:       ${isDark?'#0d1117':'#ffffff'};
  --bg2:      ${isDark?'#161b22':'#f6f8fa'};
  --bg-code:  ${isDark?'#1e2530':'#f0f2f5'};
  --border:   ${isDark?'#30363d':'#d8dee4'};
  --text:     ${isDark?'#e6edf3':'#1f2328'};
  --muted:    ${isDark?'#8b949e':'#636c76'};
  --accent:   ${isDark?'#58a6ff':'#0969da'};
  --bq-bg:    ${isDark?'#1a2332':'#f0f7ff'};
  --bq-bd:    ${isDark?'#388bfd':'#0969da'};
  --hbdr:     ${isDark?'#30363d':'#d8dee4'};
  --shadow:   ${isDark?'rgba(0,0,0,.4)':'rgba(0,0,0,.08)'};
  --r: 8px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.75}

/* layout */
.layout{display:grid;grid-template-columns:minmax(0,1fr);max-width:900px;margin:0 auto;padding:2.5rem 1.5rem 5rem;gap:2rem}
@media(min-width:1120px){
  .layout{max-width:1280px;grid-template-columns:260px minmax(0,1fr);align-items:start;gap:3rem}
  .toc{position:sticky;top:2rem}
}

/* page header */
.page-header{border-bottom:2px solid var(--hbdr);padding-bottom:1.5rem;margin-bottom:2rem}
.page-title{font-size:clamp(1.5rem,4vw,2.2rem);font-weight:700;margin-bottom:.3rem}
.page-meta{color:var(--muted);font-size:.8rem}
.page-meta code{font-family:var(--mono);background:var(--bg-code);padding:.1em .35em;border-radius:4px;font-size:.9em;border:1px solid var(--border)}

/* typography */
.content{min-width:0}
.content h1,.content h2,.content h3,.content h4,.content h5,.content h6{margin-top:2rem;margin-bottom:.6rem;font-weight:600;line-height:1.3;position:relative}
.content h1{font-size:2rem;padding-bottom:.4rem;border-bottom:2px solid var(--hbdr)}
.content h2{font-size:1.5rem;padding-bottom:.3rem;border-bottom:1px solid var(--hbdr)}
.content h3{font-size:1.2rem}
.content h4{font-size:1.05rem}
.content h1:first-child,.content h2:first-child{margin-top:0}
.anchor{opacity:0;text-decoration:none;color:var(--muted);font-size:.8em;margin-left:.4em;transition:opacity .15s}
h1:hover .anchor,h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}
.content p{margin-bottom:1.1rem}
.content a{color:var(--accent);text-decoration:none}
.content a:hover{text-decoration:underline}
.content strong{font-weight:600}
.content code{font-family:var(--mono);font-size:.875em;background:var(--bg-code);padding:.15em .4em;border-radius:4px;color:${isDark?'#ff7b72':'#cf222e'};border:1px solid var(--border)}

/* code blocks */
.code-block{position:relative;margin:1.25rem 0;border-radius:var(--r);border:1px solid var(--border);background:var(--bg-code);overflow:hidden}
.code-lang{position:absolute;top:.4rem;left:.75rem;font-family:var(--mono);font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);pointer-events:none}
.copy-btn{position:absolute;top:.4rem;right:.5rem;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--muted);font-size:.65rem;padding:.15rem .55rem;cursor:pointer;font-family:var(--font);transition:color .15s,background .15s;z-index:1}
.copy-btn:hover{color:var(--text);background:var(--border)}
.copy-btn.ok{color:${isDark?'#56d364':'#1a7f37'}}
.code-block pre{margin:0;padding:2.2rem 1rem .9rem;overflow-x:auto;font-size:.875rem;line-height:1.6}
.code-block code{background:none;border:none;padding:0;color:inherit;font-size:inherit;border-radius:0}

/* blockquote */
.blockquote{margin:1.25rem 0;padding:.75rem 1.25rem;background:var(--bq-bg);border-left:4px solid var(--bq-bd);border-radius:0 var(--r) var(--r) 0;color:var(--muted);font-style:italic}
.blockquote p{margin:0}

/* lists */
.content ul,.content ol{margin:0 0 1.1rem;padding-left:1.75rem}
.content li{margin:.25rem 0}
.content li>p{margin:.25rem 0}

/* tables */
.table-wrap{overflow-x:auto;margin:1.25rem 0;border-radius:var(--r);border:1px solid var(--border);box-shadow:0 1px 3px var(--shadow)}
.content table{width:100%;border-collapse:collapse;font-size:.9rem}
.content thead{background:var(--bg2)}
.content th{padding:.65rem 1rem;text-align:left;font-weight:600;border-bottom:2px solid var(--border);color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
.content td{padding:.6rem 1rem;border-bottom:1px solid var(--border);vertical-align:top}
.content tr:last-child td{border-bottom:none}
.content tbody tr:hover{background:var(--bg2)}

/* images */
.img-figure{margin:1.5rem 0;text-align:center}
.img-figure img{max-width:100%;border-radius:var(--r);border:1px solid var(--border);box-shadow:0 2px 8px var(--shadow)}
.img-figure figcaption{margin-top:.5rem;font-size:.8rem;color:var(--muted);font-style:italic}

/* hr */
.content hr{border:none;border-top:2px solid var(--hbdr);margin:2rem 0}

/* TOC */
.toc{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:1.25rem 1.5rem;font-size:.875rem}
@media(max-width:1119px){.toc{order:-1}}
.toc-title{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:600;margin-bottom:.75rem}
.toc-list,.toc-sub{list-style:none;padding:0}
.toc-sub{padding-left:1rem;margin-top:.25rem}
.toc-list li{margin:.3rem 0}
.toc-list a{color:var(--muted);text-decoration:none;transition:color .15s;display:block;line-height:1.4}
.toc-list a:hover,.toc-list a.on{color:var(--accent)}
.toc-list a.on{font-weight:500}

/* highlight.js theme */
.hljs{background:transparent;color:${isDark?'#e6edf3':'#24292f'}}
.hljs-keyword,.hljs-selector-tag{color:${isDark?'#ff7b72':'#cf222e'};font-weight:500}
.hljs-string,.hljs-attr{color:${isDark?'#a5d6ff':'#0a3069'}}
.hljs-title,.hljs-section,.hljs-name{color:${isDark?'#d2a8ff':'#8250df'};font-weight:600}
.hljs-comment,.hljs-quote{color:${isDark?'#8b949e':'#6e7781'};font-style:italic}
.hljs-number,.hljs-literal,.hljs-symbol{color:${isDark?'#79c0ff':'#0550ae'}}
.hljs-variable,.hljs-template-variable,.hljs-type,.hljs-built_in{color:${isDark?'#ffa657':'#953800'}}
.hljs-addition{color:${isDark?'#56d364':'#116329'};background:${isDark?'#1a2b1a':'#dafbe1'}}
.hljs-deletion{color:${isDark?'#ffa198':'#82071e'};background:${isDark?'#2d0e0e':'#ffebe9'}}
.hljs-meta{color:${isDark?'#79c0ff':'#0550ae'}}
.hljs-tag{color:${isDark?'#7ee787':'#116329'}}
.hljs-attribute{color:${isDark?'#79c0ff':'#0550ae'}}
`;

  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="layout">
    ${toc ? `<aside>${toc}</aside>` : ''}
    <main class="content">
      <header class="page-header">
        <h1 class="page-title">${esc(title)}</h1>
        <p class="page-meta">From <code>${esc(path.basename(sourceFile))}</code> &nbsp;·&nbsp; ${dateStr}</p>
      </header>
      ${body}
    </main>
  </div>
  <script>
    function copyCode(btn){
      navigator.clipboard.writeText(btn.closest('.code-block').querySelector('pre').innerText)
        .then(()=>{ btn.textContent='Copied!'; btn.classList.add('ok');
          setTimeout(()=>{ btn.textContent='Copy'; btn.classList.remove('ok'); }, 2000); });
    }
    (function(){
      const links=[...document.querySelectorAll('.toc-list a')];
      if(!links.length)return;
      const obs=new IntersectionObserver(entries=>{
        entries.forEach(e=>{
          const a=document.querySelector('.toc-list a[href="#'+e.target.id+'"]');
          if(a)a.classList.toggle('on',e.isIntersecting);
        });
      },{rootMargin:'-10% 0px -80% 0px'});
      document.querySelectorAll('h1[id],h2[id],h3[id]').forEach(h=>obs.observe(h));
    })();
  </script>
</body>
</html>`;
}

// ─── Convert one file ─────────────────────────────────────────────────────────
function convertFile(inputFile, outputFile, theme, toc, quiet) {
  const md  = fs.readFileSync(inputFile, 'utf-8');
  const out = buildHtml(md, inputFile, theme, toc);
  ensureDir(outputFile);
  fs.writeFileSync(outputFile, out, 'utf-8');
  if (!quiet) {
    const from = path.relative(process.cwd(), inputFile);
    const to   = path.relative(process.cwd(), outputFile);
    console.log(`  ${A.green('✓')} ${A.dim(from)} ${A.gray('→')} ${A.cyan(to)}`);
  }
  return outputFile;
}

function openBrowser(file) {
  const { execSync } = require('child_process');
  const abs = path.resolve(file);
  try {
    if      (process.platform === 'win32')  execSync(`start "" "${abs}"`);
    else if (process.platform === 'darwin') execSync(`open "${abs}"`);
    else                                    execSync(`xdg-open "${abs}"`);
  } catch {}
}

// ─── Watch mode ───────────────────────────────────────────────────────────────
function startWatch(jobs, theme, toc) {
  console.log(A.yellow(`\n  Watching ${jobs.length} file(s) — Ctrl+C to stop\n`));
  const timers = new Map();
  for (const { input, output } of jobs) {
    fs.watch(input, (ev) => {
      if (ev !== 'change' && ev !== 'rename') return;
      clearTimeout(timers.get(input));
      timers.set(input, setTimeout(() => {
        try {
          convertFile(input, output, theme, toc, false);
          console.log(A.dim(`    Rebuilt ${new Date().toLocaleTimeString()}`));
        } catch (e) { console.error(A.red(`  ✗ ${e.message}`)); }
      }, 150));
    });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const opts = parseArgs(process.argv.slice(2));

(async () => {
  let inputPath, isDir, outMode = 'same', customOutDir = null;

  if (opts.positional.length === 0 || opts.interactive) {
    const r = await runWizard(opts);
    inputPath    = r.inputPath;
    isDir        = r.isDir;
    outMode      = r.outMode;
    customOutDir = r.customOutDir;
  } else {
    inputPath = path.resolve(opts.positional[0]);
    if (!fs.existsSync(inputPath)) { console.error(A.red(`  Not found: ${inputPath}`)); process.exit(1); }
    isDir      = fs.statSync(inputPath).isDirectory();
    opts.theme = opts.theme || 'light';
    if (opts.toc === null) opts.toc = true;

    // Single file
    if (!isDir) {
      const out = opts.positional[1]
        ? path.resolve(opts.positional[1])
        : inputPath.replace(/\.md$/i, '.html');
      const done = convertFile(inputPath, out, opts.theme, opts.toc, opts.quiet);
      if (opts.open) openBrowser(done);
      if (opts.watch) startWatch([{ input: inputPath, output: done }], opts.theme, opts.toc);
      return;
    }

    // Folder — resolve --out
    if (!opts.out || opts.out === 'same') { outMode = 'same'; }
    else if (opts.out === 'parallel')      { outMode = 'parallel'; }
    else { outMode = 'custom'; customOutDir = path.resolve(opts.out); }
  }

  // ── Batch ─────────────────────────────────────────────────────────────────
  const files = collectMdFiles(inputPath, opts.recursive);
  if (!files.length) { console.log(A.yellow(`  No .md files found in ${inputPath}`)); return; }

  const outRoot = outMode === 'parallel'
    ? path.join(path.dirname(inputPath), path.basename(inputPath) + '-html')
    : outMode === 'custom' ? customOutDir : null;

  console.log('');
  console.log(A.bold(`  Converting ${files.length} file(s)…`));
  if (outRoot) console.log(A.dim(`  Output: ${outRoot}`));
  console.log('');

  const jobs = [];
  let ok = 0, skipped = 0, failed = 0;
  const t0 = Date.now();

  for (const f of files) {
    const out = resolveOutput(f, outMode, inputPath, outRoot);
    if (!opts.overwrite && fs.existsSync(out)) {
      if (!opts.quiet) console.log(`  ${A.yellow('↷')} ${A.dim(path.relative(process.cwd(), f))} ${A.gray('(skipped)')}`);
      skipped++; continue;
    }
    try {
      convertFile(f, out, opts.theme, opts.toc, opts.quiet);
      jobs.push({ input: f, output: out });
      ok++;
    } catch (e) {
      console.error(`  ${A.red('✗')} ${path.relative(process.cwd(),f)}: ${A.red(e.message)}`);
      failed++;
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log('');
  console.log(A.bold('  Done'));
  process.stdout.write(`  ${A.green(`✓ ${ok} converted`)}`);
  if (skipped) process.stdout.write(`   ${A.yellow(`↷ ${skipped} skipped`)}`);
  if (failed)  process.stdout.write(`   ${A.red(`✗ ${failed} failed`)}`);
  process.stdout.write(`   ${A.dim(`(${elapsed}s)`)}\n`);
  if (outRoot && ok > 0) console.log(A.dim(`  Output folder: ${outRoot}`));
  console.log('');

  if (opts.open && jobs.length > 0) openBrowser(jobs[0].output);
  if (opts.watch && jobs.length > 0) startWatch(jobs, opts.theme, opts.toc);
})().catch(e => {
  console.error(A.red(`\n  Fatal: ${e.message}`));
  process.exit(1);
});
