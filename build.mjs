import {mkdir, cp, writeFile, readFile} from 'node:fs/promises';
const out = '.vercel/output';
await mkdir(out + '/functions/data.func', {recursive:true});
await cp('public', out + '/static', {recursive:true});
for (const file of ['server.js', 'asset-index.json']) await cp(file, out + '/functions/data.func/' + file);
await writeFile(out + '/functions/data.func/index.js', `import {createDataServer} from './server.js';\nimport index from './asset-index.json';\nexport default createDataServer(index);\n`);
await writeFile(out + '/functions/data.func/.vc-config.json', JSON.stringify({runtime:'edge',entrypoint:'index.js'}));
const config = {version:3,routes:[
  {src:'/(.*)',headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'},continue:true},
  {src:'/b/(.*)',headers:{'Cache-Control':'public, max-age=31536000, immutable'},continue:true},
  {src:'/data/batchc/(.*)',headers:{'Cache-Control':'public, max-age=31536000, immutable'},continue:true},
  {src:'/data/(?:manifest|bootset|bootset_low)\\.json',headers:{'Cache-Control':'no-cache'},continue:true},
  {handle:'filesystem'},
  {src:'/data/(.*)',dest:'/data?file=$1'},
  {src:'/log',status:204},
]};
await writeFile(out + '/config.json', JSON.stringify(config, null, 2));
const index = JSON.parse(await readFile('asset-index.json', 'utf8'));
if (!index.files || !index.packs.length) throw new Error('Game data index is missing.');
console.log(`Prepared Vercel site and range server for ${Object.keys(index.files).length} game files.`);
