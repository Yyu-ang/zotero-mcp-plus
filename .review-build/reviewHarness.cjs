const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
function loadTS(path, mocks = {}, globals = {}) {
  const exports = {};
  const context = {
    exports, module: { exports }, console, URL, URLSearchParams,
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Map, Set, Date,
    crypto: webcrypto, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }, ...globals,
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context, { filename: path });
  return exports;
}
module.exports = { loadTS };
