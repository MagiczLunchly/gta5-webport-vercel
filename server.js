const RELEASE = 'https://github.com/MagiczLunchly/gta5-webport-vercel/releases/download/game-data-v2/';
const MiB = 1024 * 1024;
const BASE_HEADERS = {'Cross-Origin-Resource-Policy':'same-origin','Accept-Ranges':'bytes'};
const TYPES = {json:'application/json',html:'text/html; charset=utf-8',xml:'application/xml',txt:'text/plain; charset=utf-8'};
export function parseRange(value, size) {
  if (value === null) return [0, size - 1];
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error('Invalid range');
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error('Invalid suffix');
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error('Invalid range');
  return [start, end];
}
export function createDataServer(index, fetcher = fetch) {
  const redirects = new Map();
  async function location(pack) {
    const cached = redirects.get(pack.name);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
      const response = await fetcher(RELEASE + pack.name, {redirect:'manual',headers:{Range:'bytes=0-0'}});
      const target = response.headers.get('Location');
      if (response.body) await response.body.cancel();
      if (![301,302,303,307,308].includes(response.status) || !target || new URL(target).origin !== 'https://release-assets.githubusercontent.com') {
        throw new Error('The game-data pack is unavailable.');
      }
      return target;
    })();
    redirects.set(pack.name, {promise, expires:Date.now() + 5 * 60 * 1000});
    try { return await promise; }
    catch (error) { redirects.delete(pack.name); throw error; }
  }
  async function upstream(packNumber, start, end, signal) {
    const pack = index.packs[packNumber];
    let url = await location(pack);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetcher(url, {headers:{Range:`bytes=${start}-${end}`,'Accept-Encoding':'identity'},signal});
      if (response.status === 206 && response.headers.get('Content-Range') === `bytes ${start}-${end}/${pack.size}` && response.body) return response;
      if (response.body) await response.body.cancel();
      redirects.delete(pack.name);
      if (attempt === 0) url = await location(pack);
    }
    throw new Error('The game-data range is unavailable.');
  }
  function file(name) {
    if (!name || name.includes('\\') || name.split('/').includes('..') || !Object.hasOwn(index.files, name)) return null;
    return index.files[name];
  }
  async function batch(request) {
    if (Number(request.headers.get('Content-Length')) > MiB) return new Response('Batch too large', {status:413});
    const text = await request.text();
    if (text.length > MiB) return new Response('Batch too large', {status:413});
    let runs;
    try { runs = JSON.parse(text); } catch { return new Response('Invalid batch', {status:400}); }
    if (!Array.isArray(runs) || !runs.length || runs.length > 1000) return new Response('Invalid batch', {status:400});
    const selected = [], lengths = [];
    let total = 0;
    for (const run of runs) {
      if (!Array.isArray(run) || run.length !== 3) return new Response('Invalid batch run', {status:400});
      const [name, start, requestedEnd] = run;
      const record = typeof name === 'string' ? file(name) : null;
      if (!record || !Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start) return new Response('Invalid batch file or range', {status:400});
      const [pack, offset, size] = record;
      const length = Math.max(0, Math.min(requestedEnd + 1, size) - start);
      total += length;
      if (total > 16 * MiB) return new Response('Batch exceeds 16 MiB', {status:413});
      lengths.push(length);
      if (length) selected.push({pack, start:offset + start, end:offset + start + length - 1, order:lengths.length - 1});
    }
    // Merge nearby small files into a few release range requests.
    const groups = [];
    for (const run of [...selected].sort((a,b) => a.pack - b.pack || a.start - b.start)) {
      const last = groups.at(-1);
      if (last && last.pack === run.pack && run.start <= last.end + 16384 && run.end - last.start < 2 * MiB) {
        last.end = Math.max(last.end, run.end); last.runs.push(run);
      } else groups.push({pack:run.pack,start:run.start,end:run.end,runs:[run]});
    }
    // Send the first requested group as soon as it arrives, rather than waiting
    // for the entire batch before starting Vercel's streaming response.
    groups.sort((a,b) => Math.min(...a.runs.map(r=>r.order)) - Math.min(...b.runs.map(r=>r.order)));
    const pieces = new Map();
    for (const group of groups) {
      group.promise = new Promise((resolve,reject) => {group.resolve=resolve;group.reject=reject;});
      group.promise.catch(()=>{});
      for (const run of group.runs) pieces.set(run.order,{group,run});
    }
    let next = 0;
    const workers = Promise.all(Array.from({length:Math.min(4,groups.length)},async () => {
      while (next < groups.length) {
        const group = groups[next++];
        try {
          const response = await upstream(group.pack,group.start,group.end,request.signal);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== group.end - group.start + 1) throw new Error('Short game-data batch');
          group.resolve(bytes);
        } catch (error) {group.reject(error);throw error;}
      }
    }));
    workers.catch(error => {for (const group of groups) group.reject(error);});
    let order = 0;
    const stream = new ReadableStream({async pull(controller) {
      while (order < lengths.length) {
        const piece = pieces.get(order++);
        if (piece) {
          const {group,run} = piece;
          const bytes = await group.promise;
          controller.enqueue(bytes.subarray(run.start - group.start,run.end - group.start + 1));return;
        }
      }
      controller.close();
    }});
    return new Response(stream, {headers:{...BASE_HEADERS,'Content-Type':'application/octet-stream','Content-Length':String(total),
      'X-Run-Lengths':lengths.join(','),'Cache-Control':'no-store'}});
  }
  return async function handle(request) {
    let name;
    try {
      const url = new URL(request.url);
      name = url.searchParams.get('file') ?? decodeURIComponent(url.pathname.replace(/^\/data\//, ''));
    }
    catch { return new Response('Invalid path', {status:400}); }
    try {
      if (name === 'batch') {
        if (request.method !== 'POST') return new Response('Use POST', {status:405,headers:{Allow:'POST'}});
        return await batch(request);
      }
      if (!['GET','HEAD'].includes(request.method)) return new Response('Use GET or HEAD', {status:405,headers:{Allow:'GET, HEAD'}});
      const record = file(name);
      if (!record) return new Response('File not found', {status:404});
      const [pack, offset, size] = record;
      if (size === 0 && !request.headers.has('Range')) return new Response(null,{headers:{...BASE_HEADERS,'Content-Length':'0'}});
      let start, end;
      try { [start,end] = parseRange(request.headers.get('Range'),size); }
      catch { return new Response('Invalid range', {status:416,headers:{...BASE_HEADERS,'Content-Range':`bytes */${size}`}}); }
      const partial = request.headers.has('Range');
      const length = end - start + 1;
      const headers = {...BASE_HEADERS,'Content-Type':TYPES[name.split('.').at(-1)] || 'application/octet-stream',
        'Content-Length':String(length),'Cache-Control':'public, max-age=86400','Vercel-CDN-Cache-Control':'public, max-age=86400'};
      if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      if (request.method === 'HEAD') return new Response(null,{status:partial ? 206 : 200,headers});
      if (length > 8 * MiB) return new Response('Read this file in byte ranges of at most 8 MiB.',{status:416,headers:{...BASE_HEADERS,'Content-Range':`bytes */${size}`}});
      const response = await upstream(pack,offset + start,offset + end,request.signal);
      return new Response(response.body,{status:partial ? 206 : 200,headers});
    } catch {
      return new Response('Game data temporarily unavailable. Please retry.',{status:503,headers:{...BASE_HEADERS,'Cache-Control':'no-store','Retry-After':'2'}});
    }
  };
}
