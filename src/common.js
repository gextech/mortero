const url = require('url');
const http = require('http');
const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const util = require('util');
const logpose = require('log-pose');
const { exec } = require('child_process');

const SCRIPTS = ['yml', 'yaml', 'json', 'js', 'cjs', 'coffee', 'litcoffee', 'svelte', 'es', 'mjs', 'es6', 'jsx', 'ts', 'tsx'];
const STYLES = ['sass', 'scss', 'css', 'less', 'post', 'stylus'];
const MARKUP = ['md', 'mkd', 'asciidoc', 'adoc', 'asc', 'pug', 'jade'];
const META = ['ejs', 'hbs', 'liquid'];

const EXTENSIONS = [...SCRIPTS, ...STYLES, ...MARKUP, ...META];
const COMPONENTS = { _: Object.create(null), cache: {}, length: 0 };

const RE_JSON = /^(?:".+?"|\[.+?\]|\{.+?\}|null|false|true|-?\d+(?:\.\d+)?)$/;

logpose.setLevel('verbose');

const stdLog = logpose.getLogger(42, process.stdout);
const errLog = logpose.getLogger(42, process.stderr);

function ms(d) {
  const suffix = d > 1000 ? 's' : 'ms';
  const value = d > 1000 ? d / 1000 : d;

  return value + suffix;
}

function npm(cmd, opts = {}) {
  return new Promise((ok, err) => {
    exec(`npm ${cmd}`, opts, (e, stdout, stderr) => {
      if (!e) ok({ stdout, stderr });
      else err(e);
    });
  });
}

function set(target, key) {
  const value = RE_JSON.test(target[key])
    ? JSON.parse(target[key])
    : target[key];

  const _keys = key.split('.');

  delete target[key];

  let obj = target;
  while (_keys.length > 1) {
    const prop = _keys.shift();

    obj = obj[prop] || (obj[prop] = {});
  }

  let _key = _keys.shift();
  if (key.substr(-2) === '[]') {
    _key = _key.replace('[]', '');
    if (!obj[_key]) obj[_key] = [];
    if (!Array.isArray(obj[_key])) obj[_key] = [obj[_key]];
    obj[_key].push(value);
  } else {
    obj[_key] = value;
  }
}

function caps(value) {
  return value.replace(/(?:^|\W)([a-z])/g, (_, re) => ` ${re.toUpperCase()}${re.substr(1).toLowerCase()}`).trim();
}

function keys(obj) {
  return Object.prototype.toString.call(obj) === '[object Object]'
    ? Object.keys(obj)
    : [];
}

function array(...args) {
  return args.reduce((prev, cur) => {
    if (typeof cur === 'string') {
      cur = cur.split(/[;\s]/).filter(x => x.length);
    }

    return prev.concat(cur && !Array.isArray(cur) ? [cur] : cur || []);
  }, []);
}

function strip(html) {
  html = html.replace(/<(style|script|svg|pre)[^<>]*>[^]*?<\/\1>/g, '');
  html = html.replace(/ +/g, ' ').replace(/\n +/g, '\n').replace(/\n+/g, '\n');
  return html.trim();
}

function quote(obj, safe) {
  if (safe) {
    return JSON.stringify(obj).replace(/[`$]/g, '\\$&');
  }

  if (typeof obj === 'string') return obj.includes(' ') ? quote(obj, true) : obj.replace(/[`$\\]/g, '\\$&');
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  return quote(obj, true);
}

function inspect(obj) {
  return util.inspect(obj, { depth: 3, colors: process.env.NODE_ENV !== 'test' });
}

function copy(src, dest) {
  fs.copySync(src, dest);
}

function size(src) {
  return fs.statSync(src).size;
}

function exists(src) {
  return src && fs.existsSync(src);
}

function isDir(src) {
  return exists(src) && fs.statSync(src).isDirectory();
}

function isFile(src) {
  return exists(src) && fs.statSync(src).isFile();
}

function mtime(src) {
  return exists(src) ? fs.statSync(src).mtime : 0;
}

function lsFiles(src, opts) {
  return glob.sync(src, opts);
}

function basename(filepath, ext) {
  if (Array.isArray(ext)) {
    const found = ext.find(x => filepath.includes(x));

    if (found) {
      return path.relative(found, filepath);
    }
    return path.basename(filepath);
  }
  return path.basename(filepath, ext);
}

function relative(filepath, base) {
  return path.relative(base || '.', filepath);
}

function readFile(filepath, keep) {
  const buffer = exists(filepath) && fs.readFileSync(filepath);

  return buffer && (keep ? buffer : buffer.toString());
}

function writeFile(filepath, content) {
  fs.outputFileSync(filepath, content);
  return filepath;
}

function joinPath(...args) {
  return path.join(...args);
}

function resolve(src, _path, _array) {
  if (Array.isArray(src)) {
    src = src.filter(Boolean).reduce((prev, cur) => prev.concat(resolve(cur)), []);
    return !src.length ? [path.resolve(_path)] : src;
  }
  src = path.resolve(src || _path);
  if (_array) return [src];
  return src;
}

function extname(filepath, trim) {
  const ext = path.extname(filepath);

  return trim ? ext.substr(1) : ext;
}

function dirname(filepath, _path) {
  const dir = path.dirname(filepath);

  if (_path && dir === '.') return _path;
  return dir;
}

function unlink(filepath) {
  if (exists(filepath)) {
    fs.unlinkSync(filepath);
  }
}

function raise(...args) {
  errLog.printf(...args);
  process.exit(1);
}

function warn(...args) {
  errLog.printf(...args);
}

function puts(...args) {
  stdLog.printf(...args);
}

function cls() {
  stdLog.write('\r');
}

function defer(p, cb, list = []) {
  return p.reduce((prev, cur) => prev.then(cur).then(v => list.push(v)), Promise.resolve())
    .then(() => list.filter(Boolean))
    .then(x => (cb && cb(x)) || x);
}

function fetch(_url, filepath) {
  return new Promise((_resolve, reject) => {
    let dest;
    let file;

    if (filepath) {
      dest = resolve(filepath);
      file = fs.createWriteStream(dest);
    }

    (_url.indexOf('https:') !== -1 ? https : http)
      .get(_url, async response => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response = await fetch(url.resolve(_url, response.headers.location));
        }

        if (file) {
          response.pipe(file);
          file.on('finish', () => file.close(() => _resolve(dest)));
        } else _resolve(response);
      }).on('error', err => {
        unlink(dest);
        reject(err);
      });
  });
}

function bytes(n) {
  if (n >= 1048576) n = `${(n / 1048576).toFixed(2)} MB`;
  else if (n >= 1024) n = `${(n / 1024).toFixed(2)} KB`;
  else if (n > 1) n = `${n} bytes`;
  else if (n === 1) n = `${n} byte`;
  else n = '0 bytes';
  return n;
}

function isMarkup(src) {
  return MARKUP.includes(extname(src, true));
}

module.exports = {
  ms,
  cls,
  set,
  npm,
  size,
  copy,
  puts,
  warn,
  keys,
  caps,
  strip,
  quote,
  array,
  mtime,
  raise,
  defer,
  bytes,
  fetch,
  isDir,
  isFile,
  exists,
  unlink,
  inspect,
  lsFiles,
  resolve,
  extname,
  dirname,
  basename,
  isMarkup,
  joinPath,
  relative,
  readFile,
  writeFile,
  EXTENSIONS,
  COMPONENTS,
};
