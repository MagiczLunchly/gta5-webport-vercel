import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {Readable} from 'node:stream';
import {createDataServer,parseRange} from './server.js';
const index = JSON.parse(await readFile('asset-index.json','utf8'));
const packRoot = resolve('../GTA5Webport-Download/release-packs');
const publicRoot = resolve('public');
const data = createDataServer(index,async (url,options) => {
  if (url.startsWith('https://github.com/')) return new Response(null,{status:302,headers:{Location:'https://release-assets.githubusercontent.com/' + url.split('/').at(-1)}});
  const pack = index.packs.find(p=>p.name===new URL(url).pathname.slice(1));
  if (!pack) return new Response(null,{status:404});
  const [start,end] = parseRange(options.headers.Range,pack.size);
  return new Response(Readable.toWeb(createReadStream(resolve(packRoot,pack.name),{start,end})),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${pack.size}`}});
});
const types={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.webp':'image/webp','.woff':'font/woff'};
createServer(async (req,res) => {
  const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Accept-Ranges':'bytes'};
  try {
    const url = new URL(req.url,'http://127.0.0.1:8127');
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const path = resolve(publicRoot,'.' + name);
    if (!path.startsWith(publicRoot + sep)) {res.writeHead(404,headers).end();return;}
    let info;
    try {info=await stat(path);} catch {}
    if (req.method === 'GET' && info?.isFile()) {
      const [start,end] = parseRange(req.headers.range || null,info.size);
      if (req.headers.range) headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
      headers['Content-Type']=types[extname(path)]||'application/octet-stream';
      headers['Content-Length']=String(end-start+1);
      res.writeHead(req.headers.range?206:200,headers);
      createReadStream(path,{start,end}).pipe(res); return;
    }
    if (url.pathname === '/log') {res.writeHead(204,headers).end();return;}
    if (!url.pathname.startsWith('/data/')) {res.writeHead(404,headers).end();return;}
    const parts=[];for await (const part of req) parts.push(part);
    const response=await data(new Request(url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(parts):undefined}));
    res.writeHead(response.status,{...headers,...Object.fromEntries(response.headers)});
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch (error) {res.writeHead(500,headers).end(String(error.message));}
}).listen(8127,'127.0.0.1',()=>console.log('Local game check: http://127.0.0.1:8127'));
