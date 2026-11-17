/* Portable sticker packs. Only whitelisted image bytes and names cross machines. */
(function(root) {
  'use strict';
  const zip = root.GiaoLangZip || (typeof module === 'object' && module.exports ? require('fflate') : null);
  const MAX_IMAGE = 10 * 1024 * 1024, MAX_TOTAL = 100 * 1024 * 1024, MAX_ITEMS = 200;
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
  const fail = text => { throw new Error(text); };
  function mime(bytes) {
    if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return ['image/png','png'];
    if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0,4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8,12)) === 'WEBP') return ['image/webp','webp'];
    if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0,6)).match(/^GIF8[79]a$/)) return ['image/gif','gif'];
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg','jpg'];
    return fail('Gói sticker chứa ảnh không hợp lệ.');
  }
  const hash = async bytes => Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2,'0')).join('');
  function dimension(value) { return Number.isSafeInteger(value) && value > 0 && value <= 20000; }
  async function exportPack(items, readImage) {
    if (!zip) fail('Chưa nạp được công cụ ZIP. Hãy cập nhật bản vá.');
    if (!items.length || items.length > MAX_ITEMS) fail('Mỗi gói cần có từ 1 đến 200 sticker.');
    const files = Object.create(null), entries = [];
    let total = 0;
    for (const [index,item] of items.entries()) {
      const blob = await readImage(item);
      if (!blob || blob.size > MAX_IMAGE) fail('Không đọc được ảnh: ' + String(item.name || index + 1));
      total += blob.size;
      if (total > MAX_TOTAL) fail('Bộ sticker vượt quá 100 MB.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const [type,extension] = mime(bytes);
      const file = 'stickers/' + String(index + 1).padStart(4,'0') + '.' + extension;
      files[file] = bytes;
      entries.push({name:String(item.name || 'Sticker ' + (index + 1)).slice(0,100), file,
        width:dimension(item.pngWidth) ? item.pngWidth : item.width,
        height:dimension(item.pngHeight) ? item.pngHeight : item.height,
        animated:!!item.animated && (type === 'image/gif' || type === 'image/webp'), sha256:await hash(bytes)});
    }
    files['manifest.json'] = encoder.encode(JSON.stringify({format:'giaolang-sticker-pack',version:1,name:'Sticker của tôi',stickers:entries},null,2));
    return zip.zipSync(files, {level:0});
  }
  async function importPack(input) {
    if (!zip) fail('Chưa nạp được công cụ ZIP. Hãy cập nhật bản vá.');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > MAX_TOTAL + 1024 * 1024) fail('Gói ZIP vượt quá 100 MB.');
    let total = 0;
    const seen = new Set();
    const files = zip.unzipSync(bytes, {filter:file => {
      if (seen.has(file.name)) fail('Gói ZIP có tên tệp trùng nhau.');
      seen.add(file.name);
      if (seen.size > MAX_ITEMS + 1) fail('Gói ZIP có quá nhiều tệp.');
      if (file.name !== 'manifest.json' && !/^stickers\/\d{4}\.(png|webp|gif|jpg)$/.test(file.name)) fail('Gói ZIP chứa tệp ngoài bộ sticker.');
      if (file.originalSize > (file.name === 'manifest.json' ? 128 * 1024 : MAX_IMAGE)) fail('Ảnh trong ZIP quá lớn.');
      total += file.originalSize;
      if (total > MAX_TOTAL) fail('Bộ sticker giải nén vượt quá 100 MB.');
      return true;
    }});
    if (!files['manifest.json']) fail('Hãy chọn gói ZIP xuất từ Sticker của tôi.');
    let manifest;
    try { manifest = JSON.parse(decoder.decode(files['manifest.json'])); } catch { fail('Thông tin bộ sticker không hợp lệ.'); }
    if (manifest.format !== 'giaolang-sticker-pack' || manifest.version !== 1 || !Array.isArray(manifest.stickers) || !manifest.stickers.length || manifest.stickers.length > MAX_ITEMS)
      fail('Định dạng hoặc phiên bản bộ sticker chưa được hỗ trợ.');
    const entries = [], used = new Set();
    for (const entry of manifest.stickers) {
      if (!entry || typeof entry.file !== 'string' || !/^stickers\/\d{4}\.(png|webp|gif|jpg)$/.test(entry.file) || used.has(entry.file)) fail('Danh sách ảnh trong gói không hợp lệ.');
      used.add(entry.file);
      const data = files[entry.file];
      if (!data || !dimension(entry.width) || !dimension(entry.height)) fail('Ảnh trong bộ bị thiếu hoặc sai kích thước.');
      if (typeof entry.sha256 !== 'string' || await hash(data) !== entry.sha256) fail('Ảnh trong bộ bị hỏng: ' + String(entry.name || entry.file));
      const [type] = mime(data);
      entries.push({name:String(entry.name || 'Sticker').slice(0,100),blob:new Blob([data],{type}),
        width:entry.width,height:entry.height,animated:!!entry.animated && (type === 'image/gif' || type === 'image/webp'),assetHash:entry.sha256});
    }
    if (used.size !== Object.keys(files).length - 1) fail('Gói ZIP có ảnh không nằm trong danh sách.');
    return entries;
  }
  const api = {exportPack,importPack,hash};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GiaoLangStickerPack = api;
})(globalThis);
