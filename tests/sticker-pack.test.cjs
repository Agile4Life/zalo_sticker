const test = require('node:test');
const assert = require('node:assert/strict');
const {zipSync,unzipSync,strToU8,strFromU8} = require('fflate');
const packs = require('../src/sticker-pack.js');
const fs = require('node:fs'), path = require('node:path');
const archivePath = process.env.GIAOLANG_TEST_ASAR || path.join(__dirname,'../build/app-26.11.12-giaolang.asar');
const image = new Uint8Array([137,80,78,71,13,10,26,10,0,1,2,3,4]);
const blob = new Blob([image],{type:'image/png'});
const item = {name:'Xin chào 👋',width:128,height:128,pngWidth:128,pngHeight:128,blob,
  owner:'private-account',sourceMessageId:'private-message',url:'https://private.zdn.vn/token',cookie:'PRIVATE'};
const exportOne = () => packs.exportPack([item], x => x.blob);

test('ZIP round-trip preserves image bytes and Unicode names', async () => {
  const bytes = await exportOne(), imported = await packs.importPack(bytes);
  assert.equal(imported.length,1);
  assert.equal(imported[0].name,item.name);
  assert.deepEqual(new Uint8Array(await imported[0].blob.arrayBuffer()),image);
  assert.equal(imported[0].blob.type,'image/png');
});
test('ZIP contains image bytes, with no account, message, remote URLs or session metadata',async () => {
  const files = unzipSync(await exportOne());
  assert.deepEqual(Object.keys(files).sort(),['manifest.json','stickers/0001.png']);
  const manifest = strFromU8(files['manifest.json']);
  for (const secret of ['private-account','private-message','private.zdn.vn','PRIVATE']) assert.ok(!manifest.includes(secret));
  assert.deepEqual(Object.keys(JSON.parse(manifest).stickers[0]).sort(),['animated','file','height','name','sha256','width']);
});
test('JPEG bytes are accepted without incorrectly decoding them as UTF-8',async () => {
  const jpeg = new Blob([new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1])]);
  const bytes = await packs.exportPack([{...item,blob:jpeg}], x=>x.blob);
  assert.equal((await packs.importPack(bytes))[0].blob.type,'image/jpeg');
});
test('corrupted image bytes fail their SHA-256 check',async () => {
  const files = unzipSync(await exportOne());files['stickers/0001.png'][12] ^= 1;
  await assert.rejects(packs.importPack(zipSync(files)),/bị hỏng/);
});
test('traversal and unexpected scripts are rejected',async () => {
  for (const name of ['../account.json','stickers/../../evil.js','app.js']) {
    const files=unzipSync(await exportOne());files[name]=strToU8('untrusted');
    await assert.rejects(packs.importPack(zipSync(files)),/ngoài bộ sticker/);
  }
});
test('ZIP bombs are rejected before the oversized member is allocated',async () => {
  const bytes=await exportOne();const altered=Buffer.from(bytes);
  const at=altered.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  assert.ok(at>=0);altered.writeUInt32LE(11*1024*1024,at+24);
  await assert.rejects(packs.importPack(new Uint8Array(altered)),/quá lớn/);
});
test('missing and unsupported manifests are rejected',async () => {
  await assert.rejects(packs.importPack(zipSync({'stickers/0001.png':image})),/Hãy chọn gói ZIP/);
  const files=unzipSync(await exportOne());const manifest=JSON.parse(strFromU8(files['manifest.json']));
  manifest.version=99;files['manifest.json']=strToU8(JSON.stringify(manifest));
  await assert.rejects(packs.importPack(zipSync(files)),/chưa được hỗ trợ/);
});
test('export is all-or-nothing when an image is unavailable',async () => {
  await assert.rejects(packs.exportPack([item,item],async x=>{throw new Error('Ảnh không còn tồn tại');}),/không còn tồn tại/);
});
test('pack scripts from the actual ASAR work with Electron-style module globals',
  {skip:!fs.existsSync(archivePath) && 'Run npm run patch:build to enable ASAR integration tests.'},async () => {
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const archive=fs.readFileSync(archivePath);
  const base=8+archive.readUInt32LE(4),header=JSON.parse(archive.subarray(16,16+archive.readUInt32LE(12)).toString());
  const read=name=>{const entry=header.files['pc-dist'].files[name];return archive.subarray(base+Number(entry.offset),base+Number(entry.offset)+entry.size).toString();};
  const sandbox={TextEncoder,TextDecoder,Blob,crypto,console,module:{exports:{}},exports:{}};
  sandbox.self=sandbox;sandbox.window=sandbox;
  const context=vm.createContext(sandbox);
  vm.runInContext(read('giaolang-zip.js'),context);
  vm.runInContext(read('giaolang-pack.js'),context);
  assert.equal(typeof sandbox.GiaoLangZip.zipSync,'function');
  const bytes=await sandbox.GiaoLangStickerPack.exportPack([item],x=>x.blob);
  // Use the same realm to decode the typed array produced by the bundled codec.
  const result=await sandbox.GiaoLangStickerPack.importPack(bytes);
  assert.deepEqual(new Uint8Array(await result[0].blob.arrayBuffer()),image);
});
