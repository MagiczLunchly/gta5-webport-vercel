const {test} = require('node:test');
const assert = require('node:assert/strict');
const library = import('../server.js');
const bytes = Uint8Array.from({length:100},(_,i)=>i);
const index = {packs:[{name:'game-data-00.bin',size:100}],files:{'one.rpf':[0,10,10],'two.rpf':[0,30,10]}};
function upstreamMock() {
  const calls = [];
  const fetcher = async (url,options) => {
    calls.push({url,options});
    if (url.startsWith('https://github.com/')) return new Response(null,{status:302,headers:{Location:'https://release-assets.githubusercontent.com/test'}});
    assert.equal(url,'https://release-assets.githubusercontent.com/test');
    const [start,end] = options.headers.Range.slice(6).split('-').map(Number);
    return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/100`}});
  };
  return {calls,fetcher};
}
test('translates file ranges to pack offsets and keeps responses same-origin',async () => {
  const {createDataServer} = await library;
  const mock = upstreamMock(), handle = createDataServer(index,mock.fetcher);
  const response = await handle(new Request('https://game.example/data/one.rpf',{headers:{Range:'bytes=2-5'}}));
  assert.equal(response.status,206);
  assert.equal(response.headers.get('Content-Range'),'bytes 2-5/10');
  assert.equal(response.headers.get('Location'),null);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[12,13,14,15]);
  await handle(new Request('https://game.example/data/two.rpf',{headers:{Range:'bytes=0-1'}}));
  assert.equal(mock.calls.filter(c=>c.url.startsWith('https://github.com/')).length,1);
});
test('supports suffix, open-ended and clamped ranges while rejecting malformed ranges',async () => {
  const {parseRange} = await library;
  assert.deepEqual(parseRange('bytes=-3',10),[7,9]);
  assert.deepEqual(parseRange('bytes=4-',10),[4,9]);
  assert.deepEqual(parseRange('bytes=0-100',10),[0,9]);
  for (const range of ['bytes=10-11','bytes=4-2','bytes=0-1,3-4','bytes=-0','bytes=9007199254740993-','bad']) assert.throws(()=>parseRange(range,10));
});
test('batch preserves request order, clamps EOF and merges nearby source reads',async () => {
  const {createDataServer} = await library;
  const mock = upstreamMock(), handle = createDataServer(index,mock.fetcher);
  const response = await handle(new Request('https://game.example/data/batch?gz=1',{method:'POST',body:JSON.stringify([['two.rpf',7,50],['one.rpf',1,3],['two.rpf',20,30]])}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('X-Run-Lengths'),'3,3,0');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[37,38,39,11,12,13]);
  assert.equal(mock.calls.filter(c=>c.url.startsWith('https://release-assets.')).length,1);
});
test('invalid paths, methods, ranges and batch inputs never fetch an upstream',async () => {
  const {createDataServer} = await library;
  let calls = 0;
  const handle = createDataServer(index,async()=>{calls++;throw Error('Unexpected fetch');});
  assert.equal((await handle(new Request('https://game.example/data/%2e%2e%2fsecret'))).status,404);
  assert.equal((await handle(new Request('https://game.example/data/constructor'))).status,404);
  assert.equal((await handle(new Request('https://game.example/data/one.rpf',{method:'POST'}))).status,405);
  assert.equal((await handle(new Request('https://game.example/data/one.rpf',{headers:{Range:'bytes=100-200'}}))).status,416);
  for (const body of ['{}','bad','[]',JSON.stringify([['one.rpf',-1,3]]),JSON.stringify([['missing',0,3]])]) {
    assert.equal((await handle(new Request('https://game.example/data/batch',{method:'POST',body}))).status,400);
  }
  assert.equal(calls,0);
});
test('HEAD returns metadata without downloading any game bytes',async () => {
  const {createDataServer} = await library;
  const handle = createDataServer(index,()=>{throw Error('Unexpected fetch');});
  const response = await handle(new Request('https://game.example/data/one.rpf',{method:'HEAD'}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Content-Length'),'10');
  assert.equal(await response.text(),'');
});
test('upstream errors and incorrect ranges are retryable without leaking signed URLs',async () => {
  const {createDataServer} = await library;
  const handle = createDataServer(index,async url => url.startsWith('https://github.com/')
    ? new Response(null,{status:302,headers:{Location:'https://release-assets.githubusercontent.com/private-signed-value'}})
    : new Response('wrong',{status:200}));
  const response = await handle(new Request('https://game.example/data/one.rpf',{headers:{Range:'bytes=0-2'}}));
  assert.equal(response.status,503);
  assert.equal(response.headers.get('Retry-After'),'2');
  assert.doesNotMatch(await response.text(),/signed-value/);
});
test('supports Vercel destination query parameters without losing the requested file',async () => {
  const {createDataServer} = await library;
  const mock = upstreamMock();
  const response = await createDataServer(index,mock.fetcher)(new Request('https://game.example/data?file=one.rpf',{headers:{Range:'bytes=0-1'}}));
  assert.equal(response.status,206);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[10,11]);
});
test('batch streams its first file while a later source is still loading',{timeout:3000},async () => {
  const {createDataServer} = await library;
  const twoPacks = {packs:[{name:'game-data-00.bin',size:100},{name:'game-data-01.bin',size:100}],files:{'first':[0,10,2],'second':[1,30,2]}};
  let unblock;
  const gate = new Promise(resolve=>unblock=resolve);
  let waiting = false;
  const fetcher = async (url,options) => {
    if (url.startsWith('https://github.com/')) return new Response(null,{status:302,headers:{Location:'https://release-assets.githubusercontent.com/' + url.split('/').at(-1)}});
    if (url.endsWith('01.bin')) {waiting=true;await gate;}
    const [start,end] = options.headers.Range.slice(6).split('-').map(Number);
    return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/100`}});
  };
  try {
    const response = await createDataServer(twoPacks,fetcher)(new Request('https://game.example/data/batch',{method:'POST',body:JSON.stringify([['first',0,1],['second',0,1]])}));
    const reader=response.body.getReader();
    assert.deepEqual([...(await reader.read()).value],[10,11]);
    assert.equal(waiting,true);
    unblock();
    assert.deepEqual([...(await reader.read()).value],[30,31]);
    assert.equal((await reader.read()).done,true);
  } finally {unblock();}
});
