const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

// Inspect the actual generated app archive, rather than a hand-written copy
// of the patched handler. No Zalo process, network or account is used.
const archivePath = process.env.GIAOLANG_TEST_ASAR || path.join(__dirname, '../build/app-26.11.12-giaolang.asar');
if (!fs.existsSync(archivePath)) {
  test('native ASAR integration', {skip:'Run npm run patch:build on a machine with the supported Zalo installation.'}, () => {});
} else {
const archive = fs.readFileSync(archivePath);
const base = 8 + archive.readUInt32LE(4);
const tree = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString('utf8'));
const lazy = tree.files['pc-dist'].files.lazy.files;
const member = lazy[Object.keys(lazy).find(name => name.startsWith('default-login-main-startup-shared-worker-znotification.'))];
const source = archive.subarray(base + Number(member.offset), base + Number(member.offset) + member.size).toString('utf8');
const ast = acorn.parse(source, {ecmaVersion:'latest'});
const modules = ast.body[0].expression.arguments[0].elements[1].properties;
const factory = modules.find(p => (p.key.name ?? p.key.value) === 'Em8I').value;
const capture = factory.body.body.find(node => node.type === 'VariableDeclaration' && node.declarations.some(d => d.id.name === '__giaoLangRequire'));
let method;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'MethodDefinition' && node.key.name === '_sendSticker') method = node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(factory);
assert.ok(method, 'Native sticker handler missing from generated archive');
const methodCode = source.slice(method.start, method.end);
const captureCode = capture && source.slice(capture.start, capture.end);

function fixture(code = methodCode) {
  const calls = [];
  const mockRequire = id => {
    if (id === 'UYGI') return {b:{uploadFile: async (...args) => { calls.push(args); return {uploaded:true}; }}};
    if (id === '1+6A') return {c:{File:1},a:{SendMsg:1}};
    throw new Error('Unexpected module: ' + id);
  };
  const context = {
    mockRequire, L:{GROUPID_PREFIX:'g'}, R:{a:{}}, j:{}, E:{a:{next:()=> 'fixture-upload-id'}},
    c:{ModuleContainer:{resolve:()=>({verifySetting:()=>false})}},
    gt:{b:'fixture-guard',d:()=> 'fixture-error'},pt:{TOAST_TYPE:{ERROR:1}},
    window:{GiaoLangSticker:{bridge:(_controller,_request,native)=>native}},
  };
  const handler = vm.runInNewContext(`(a => { ${captureCode || ''} return {${code}}; })(mockRequire)`, context);
  return {handler,calls};
}

test('webpack loader is captured in the native module scope', () => {
  assert.ok(capture);
  const declaration = capture.declarations.find(d => d.id.name === '__giaoLangRequire');
  assert.equal(declaration.init.name, factory.params[2].name);
});

for (const flag of [undefined, false, true]) {
  test(`native upload works with original fourth parameter ${String(flag)}`, async () => {
    const {handler,calls} = fixture();
    const native = handler._sendSticker({__giaoLang:true}, null, null, flag);
    const file = {name:'fixture.webp',type:'image/webp'};
    await native.upload(file,'fixture-cloud');
    assert.equal(calls.length,1);
    assert.equal(calls[0][0].rawFile,file);
    assert.equal(calls[0][0].toUid,'fixture-cloud');
    assert.equal(calls[0][0].extData.uploadMainType,1);
    assert.equal(calls[0][0].feature,1);
    assert.equal(native.locked(),false);
  });
}

test('regression detects the previous shadowed-loader bug', () => {
  const {handler} = fixture(methodCode.replaceAll('__giaoLangRequire(', 'a('));
  const native = handler._sendSticker({__giaoLang:true});
  assert.throws(() => native.upload({},'fixture-cloud'), /a is not a function/);
});
}
