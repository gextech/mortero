const micromatch = require('micromatch');
const os = require('os');

const RE_MACROS = /(?:#|<!--|\/[/*])\s*(IF(?:_?NOT|NDEF)?)\s+([\s\S]*?)(?:#|<!--|\/[/*])\s*ENDIF/;
const RE_GLOBAL = /\/\*+\s*global\s+([\s\S]+?)\s*\*+\//g;

const TEMP_DIR = os.tmpdir();

const {
  npm,
  puts,
  warn,
  copy,
  keys,
  expr,
  mtime,
  defer,
  fetch,
  array,
  exists,
  extname,
  dirname,
  basename,
  resolve,
  relative,
  joinPath,
  inspect,
  lsFiles,
  readFile,
  writeFile,
  EXTENSIONS,
  COMPONENTS,
} = require('./common');

let _length;
let _regex;
function getExtensions(regex) {
  if (regex) {
    if (EXTENSIONS.length !== _length) {
      _regex = new RegExp(`.(?:${EXTENSIONS.join('|')})$`);
      _length = EXTENSIONS.length;
    }
    return _regex;
  }
  return EXTENSIONS.map(x => `.${x}`);
}

function getEngines() {
  return require('./engines');
}

function getHooks(tpl, dest, context) {
  const _keys = Object.keys(COMPONENTS._);

  if (_keys.length !== COMPONENTS.length) {
    COMPONENTS.re = new RegExp(`<(${_keys.join('|')})\\s*([^<>]*)(?:\\/>|>(.*)<\\/\\1>)|\\{@(${_keys.join('|')})\\s*(\\{[^{}]*\\}|[^{}]*)\\}`, 'g');
  }

  if (tpl) {
    return () => {
      let matches;
      tpl.source = tpl.source.replace(COMPONENTS.re, (_, a, b, c, d, e) => {
        const tag = a || d;
        const attrs = b || e;
        const content = c || '';

        const backup = [];
        const tmp = attrs
          .replace(/"[^]*?"/g, match => backup.push(match) && '"@@str"')
          .replace(/(?:^|\s)(\w+)(?=\s\w+=|$)/g, ' $1:true')
          .replace(/,?\s*(\w+)[=:]/g, ',"$1":')
          .replace(/^,/, '')
          .replace(/\{\s*,/, '{')
          .replace(/"@@str"/g, () => backup.shift());

        try {
          const props = JSON.parse(tmp.charAt() !== '{' ? `{${tmp}}` : tmp);

          matches = matches || tag === 'image';
          return COMPONENTS._[tag]({ tpl, props, content }, context);
        } catch (_e) {
          warn('\r{%yellow. %s%} Unable to parse `%s`\n', tag || _, attrs);
          return _;
        }
      });

      if (matches) {
        tpl.source = tpl.source.replace(/<\/head|body>|$/, _ => `<script>${readFile(require('talavera').preload)}</script>${_}`);
      }
    };
  }

  return COMPONENTS._;
}

function getModule(src, paths) {
  let file;
  if (paths) {
    const folders = paths.map(x => resolve(x));

    for (let j = 0; j < folders.length; j += 1) {
      file = getModule(joinPath(folders[j], src));
      if (file) return file;
    }
  } else {
    const exts = getExtensions();

    for (let i = 0, c = exts.length; i < c; i += 1) {
      file = joinPath(src + exts[i]);
      if (exists(file)) return file;
      file = joinPath(src, `index${exts[i]}`);
      if (exists(file)) return file;
    }
  }
}

function include(path) {
  const suffix = process.env.NODE_ENV === 'production'
    ? `?t=${Date.now()}`
    : '?livereload=';

  if (path.includes('.css')) return `<link rel="stylesheet" href="${path + suffix}">`;
  if (path.includes('.js')) return `<script src="${path + suffix}"></script>`;

  throw new Error(`Cannot include '${path}'`);
}

function serialize(value) {
  if (typeof value === 'object') {
    value = JSON.stringify(value);
  }
  return String(value).replace(/"/g, '&quot;');
}

function attributes(props, omit) {
  return Object.keys(props).reduce((prev, k) => {
    if ((!omit || !omit.includes(k)) && typeof props[k] !== 'undefined' && props[k] !== null) {
      prev += ` ${k}="${serialize(props[k])}"`;
    }
    return prev;
  }, '');
}

function getContext(dest, options) {
  function locate(path) {
    let destFile = joinPath(dest, path);
    if (exists(destFile)) return { dest: path };

    for (let i = 0; i < options.root.length; i += 1) {
      destFile = joinPath(options.root[i], path);
      if (exists(destFile)) return { src: path };
    }
    if (exists(path)) {
      const entry = options.tmp[resolve(path)];

      if (entry && entry.destination) {
        return { dest: relative(entry.destination, dest), entry };
      }
      return { path, entry };
    }

    for (const k in options.tmp) { // eslint-disable-line
      const entry = options.tmp[k] || {};

      if (typeof entry.filename === 'string' && entry.filename.includes(path)) {
        if (entry.destination) return { dest: relative(entry.destination, dest), entry };
        return { path: entry.filepath, entry };
      }

      if (typeof entry.filepath === 'string' && relative(entry.filepath).includes(path)) {
        return { path: entry.filepath, entry };
      }
    }

    throw new Error(`Unable to locate '${path}'`);
  }

  return {
    locate,
    include,
    serialize,
    attributes,
  };
}

function isSupported(src) {
  const name = basename(src);
  const parts = name.split('.');

  parts.shift();
  return parts.some(x => EXTENSIONS.includes(x));
}

function checkDirty(key, entry) {
  if (!entry) return true;
  if (entry.destination) {
    return !exists(entry.destination) || (mtime(key) - mtime(entry.destination)) > 0;
  }
  if (entry.modified) return (mtime(key) - entry.modified) > 0;
}

function filters(any, filter) {
  filter = filter.filter(Boolean).map(x => (typeof x !== 'function'
    ? micromatch.matcher(x, { dot: true })
    : x));

  return filepath => {
    let length = filter.length - 1;
    let res = false;
    let pass = 0;

    while (length >= 0) {
      if (filter[length](filepath)) {
        if (any) {
          res = true;
          break;
        }
        pass += 1;
      }
      length -= 1;
    }
    return res || pass === filter.length;
  };
}

function configure(flags, pkg) {
  if (pkg.mortero) {
    if (pkg.mortero.external) flags.external = array(flags.external, pkg.mortero.external);
    if (pkg.mortero.extensions) flags.ext = array(flags.ext, pkg.mortero.extensions);
    if (pkg.mortero.aliases) flags.alias = array(flags.alias, pkg.mortero.aliases);
    if (pkg.mortero.copy) flags.copy = array(flags.copy, pkg.mortero.copy);
    if (pkg.mortero.rename) flags.rename = array(flags.rename, pkg.mortero.rename);
    if (pkg.mortero.filter) flags.filter = array(flags.filter, pkg.mortero.filter);
    if (pkg.mortero.ignore) flags.ignore = array(flags.ignore, pkg.mortero.ignore);
    if (pkg.mortero.exclude) flags.exclude = array(flags.exclude, pkg.mortero.exclude);

    Object.keys(pkg.mortero.options).forEach(key => {
      if (typeof flags[key] === 'undefined') {
        flags[key] = pkg.mortero.options[key];
      }
    });
  }

  const fixedExtensions = array(flags.ext).reduce((memo, cur) => {
    const parts = cur.replace(/^\./, '').split('.');

    memo[parts.shift()] = parts;
    return memo;
  }, {});

  const fixedAliases = array(flags.alias).reduce((memo, cur) => {
    const [from, to] = cur.split(':');

    memo[from] = to;
    return memo;
  }, {});

  const filterInput = array(flags.filter || '**').concat(array(flags.exclude).map(x => {
    if (x.charAt() === '.') return `!**/*${x}`;
    if (x.includes('*')) return `!${x}`;
    if (x.includes('.')) return `!**/${x}`;
    return `!**/${x}/**`;
  }));

  const ignoreInput = array(flags.ignoreFrom).reduce((memo, x) => {
    if (exists(x)) {
      const lines = readFile(x).split('\n');

      lines.forEach(line => {
        if (line.length && line[0] !== '#') {
          memo.push(line);
        }
      });
    }
    return memo;
  }, []).reduce((memo, x) => {
    if (memo.includes(x)) return memo;
    if (x.charAt() === '*') {
      memo.push(x);
    } else {
      const offset = x.indexOf('/');

      if (offset === -1) {
        memo.push(`**/${x}`);
        if (!(x.includes('.') || x.includes('*'))) {
          memo.push(`**/${x}/**`);
          memo.push(`${x}/**`);
        }
        memo.push(x);
      } else {
        if (offset === 0) x = x.substring(1);
        else memo.push(`**/${x}`);

        if (x.charAt(x.length - 1) === '/') {
          memo.push(x.slice(0, -1));
          memo.push(`${x}**`);
        } else {
          memo.push(x);
        }
      }
    }
    return memo;
  }, []).concat(array(flags.ignore || '!**'));

  const isFiltered = filters(false, filterInput);
  const isIgnored = filters(true, ignoreInput);
  const isBundle = filters(true, array(flags.bundle));

  return {
    fixedExtensions,
    fixedAliases,
    isFiltered,
    isIgnored,
    isBundle,
  };
}

function generate(cwd, filter) {
  return (value, _rename) => {
    const rel = relative(value, cwd).replace(/^(\.{1,2}\/)+/, '');
    const ok = filter(rel);
    const ext = extname(rel);

    if (ok) {
      return joinPath(cwd, (_rename || ok).replace(/\{(basedir|filepath)(?:\/(.+?))?\}/, (_, type, match) => {
        const parts = type !== 'filepath' ? dirname(rel).split('/') : rel.split('/');
        const _keys = match ? match.split('/') : [];
        const _test = [];

        let h = 0;
        let j = 0;
        while (true) { // eslint-disable-line
          const a = parts[j];
          const b = _keys[h];

          if (typeof a === 'undefined' && b) break;
          if (typeof b === 'undefined' && typeof a === 'undefined') break;

          if (/^\d+$/.test(b)) {
            parts.splice(j, +b);
            j = 0;
            h += 1;
            continue; // eslint-disable-line
          }

          if (a === b) {
            h += 1;
            parts[j] = _keys[h];
            h += 1;
            j += 1;
            continue; // eslint-disable-line
          }

          _test.push(a);
          j += 1;
        }

        return _test.join('/');
      }).replace('{filename}', basename(rel, ext))
        .replace('{extname}', ext.substr(1)))
        .replace('{fname}', basename(rel))
        .replace('{name}', basename(rel, ext))
        .replace('{path}', rel)
        .replace('{ext}', ext);
    }
  };
}

function plugins(defaults, options = {}) {
  if (Object.prototype.toString.call(defaults) === '[object Object]') {
    defaults = keys(defaults).map(key => {
      options[key] = defaults[key];
      return key;
    });
  }

  return defaults.map(plugin => {
    if (typeof plugin === 'string') {
      let Plugin = require(plugin.charAt() === '.' ? resolve(plugin) : plugin);
      Plugin = Plugin.default || Plugin;

      if (typeof Plugin === 'function') {
        try {
          plugin = new Plugin(options[plugin] || {});
        } catch (e) {
          plugin = Plugin(options[plugin] || {});
        }
      } else {
        plugin = Plugin;
      }
    }
    return plugin;
  });
}

async function modules(src, entry, isHook) {
  const [base, sub] = src.split('/').slice(0, 2);

  let pkgName = base;
  if (base.charAt() === '@' && sub) pkgName += `/${sub}`;

  let mod;
  try {
    mod = require.resolve(pkgName);
  } catch (e) {
    mod = exists(resolve(`./node_modules/${pkgName}`));
  }

  if (entry.options.install !== false && !mod) {
    if (!entry.options.quiet) puts('\r{%magentaBright install%} %s ', pkgName);

    let timer;
    let done;
    let d = 500;
    if (!entry.options.quiet) {
      ;(function tick() { // eslint-disable-line
        if (!done) timer = setTimeout(tick, d);
        d *= 1.5;
        puts('.');
      })();
    }

    const start = Date.now();
    const { stderr, stdout } = await npm(`i ${pkgName} --save-dev`);
    const diff = Date.now() - start;

    done = true;
    entry.install += diff;
    clearTimeout(timer);

    if (!entry.options.quiet) {
      puts('\r{%magentaBright install%} %s {%gray %s%}', pkgName, `${diff / 1000}s`);
    }

    if (stderr.length && !entry.options.quiet) warn(stderr);
    if (stdout.length && !entry.options.quiet) puts(stdout);
  }

  if (!isHook) {
    const chunks = require.resolve(pkgName).split('/');
    const offset = chunks.indexOf('node_modules');
    const pkgDir = chunks.slice(0, offset + 2).join('/');
    const pkgFile = joinPath(pkgDir, 'package.json');
    const destDir = resolve(entry.options.dest, './build');
    const modulesPath = entry.data.$modules || entry.options.modules;
    const fixedModuleDir = typeof modulesPath === 'string' ? modulesPath : 'web_modules';

    try {
      const pkgInfo = require(pkgFile);
      const mainFile = pkgInfo.module || pkgInfo.browser || pkgInfo.unpkg;

      if (mainFile) {
        const moduleDir = joinPath(destDir, fixedModuleDir, pkgName);
        const moduleFile = joinPath(moduleDir, mainFile);

        copy(joinPath(pkgDir, mainFile), moduleFile);
        copy(pkgFile, joinPath(moduleDir, 'package.json'));

        let found;
        if (!(entry.data.$nofiles || entry.options.nofiles)) {
          (pkgInfo.files || []).forEach(_src => {
            lsFiles(joinPath(pkgDir, _src)).forEach(file => {
              if (exists(file)) {
                const destFile = joinPath(moduleDir, relative(file, pkgDir));

                if (!entry.options.quiet) puts('\r{%cyanBright copy%} %s\n', relative(destFile));
                copy(file, destFile);
                found = true;
              }
            });
          });
        }

        if (found) {
          return relative(moduleFile, destDir);
        }
      }
    } catch (e) {
      // do nothing
    }
  }
}

async function embed(tpl, dest, html, render) {
  const embedTasks = [];
  const comments = [];
  const data = {};

  html = html.replace(/<!--[^]*?-->/g, match => comments.push(match) && '<!--!#@@-->');
  html = html.replace(/<link[^<>]*?href=(.*?)[^<>]*?>|<script[^<>]*?src=(.*?)[^<>]*?>|url\s*\(.*?\)/g, sub => {
    if (sub.charAt() === '<' && !/\sinline(?:=(["']?)(?:inline|true)\1)?(?:\b|$)/.test(sub)) return sub;

    const src = sub.match(/(?:(?:href|src)=(["'])(.*?)\1)|url\((["']?)(.*?)\3\)/);
    const base = tpl.options.base || `http://localhost:${process.env.PORT || 8080}`;

    let _url = src[2] || src[4];
    if (_url.indexOf('//') === 0) {
      _url = `http:${_url}`;
    } else if (_url.charAt() === '/') {
      _url = `${base}${_url}`;
    }

    const key = [tpl.filepath, _url].join('_').replace(/\W/g, '_');

    embedTasks.push(async () => {
      const name = _url.split('#')[0].split('?')[0];
      const file = joinPath(TEMP_DIR, key);
      const local = joinPath(dest, name.replace(base, '.'));
      const resource = joinPath(tpl.options.cwd || dirname(tpl.filepath), name);

      let out = '';
      if (exists(local)) {
        out = readFile(local, true);
      } else if (exists(resource) && (tpl.options.force || !exists(file) || (mtime(resource) - mtime(file)) > 0)) {
        const tmp = await render(resource, tpl);

        writeFile(file, tmp.source);
        out = tmp.source;
      } else if (!exists(file) || tpl.options.force) {
        if (!tpl.options.quiet) {
          puts('\r{%blue fetch%} %s', _url);
        }

        await fetch(_url, file);

        out = readFile(file, true);
        if (!tpl.options.quiet && tpl.options.verbose) {
          if (out === false) {
            warn('\r{%yellow. not found%} %s\n', _url);
          } else {
            puts('\r{%green. found%} %s\n', _url);
          }
        }

        if (out === false) {
          out = `// not found: ${_url}`;
        }
      } else {
        out = readFile(file, true);
      }

      if (exists(resource) && !tpl.children.includes(resource)) {
        tpl.children.push(resource);
      } else if (exists(local) && !tpl.children.includes(local)) {
        tpl.children.push(local);
      }

      if (sub.includes('<script')) {
        data[key] = `<script>//<![CDATA[\n${out.toString().replace(/<\/script>/g, '<\\/script>')}\n//]]>`;
      } else if (sub.includes('<link')) {
        out = await embed(tpl, dest, out.toString(), render);
        data[key] = `<style>${out.replace(/\s+/g, ' ').trim()}</style>`;
      } else if (sub.includes('url(')) {
        const ext = _url.match(/\.(\w+)$(?=\?.*?|$)$/)[1];

        let type = `image/${ext}`;
        if (ext === 'ttf') {
          type = 'application/x-font-ttf';
        } else if (ext.indexOf('woff') === 0) {
          type = `font/${ext}`;
        }

        data[key] = `url('data:${type};base64,${out.toString('base64')}')`;
      }
    });
    return `/*#!${key}*/`;
  });

  await defer(embedTasks, () => {
    html = html.replace(/<!--!#@@-->/g, () => comments.shift())
      .replace(/\/\*#!(\w+)\*\//g, (_, key) => data[key])
      .replace(/\s*\n|<\/style>\s*<style>/g, '\n')
      .replace(/<(\w+)>\s*<\/\1>/g, '');
  });
  return html;
}

function rename(dest, filter) {
  const re = array(filter).reduce((memo, cur) => {
    if (typeof cur === 'function') memo.push({ fn: generate(dest, cur) });
    if (typeof cur === 'string') cur = cur.split(':');
    if (Array.isArray(cur)) {
      if (!(cur[0] instanceof RegExp)) cur[0] = micromatch.makeRe(cur[0], { dot: true });
      memo.push({ fn: generate(dest, RegExp.prototype.test.bind(cur[0])), re: cur[1] });
    }
    return memo;
  }, []);

  return _dest => {
    return re.reduce((prev, cur) => cur.fn(prev, cur.re) || prev, _dest);
  };
}

function load(set, dest, flags = {}, cache = {}) {
  const cwd = resolve('.');
  const hooks = getHooks();
  const engines = getEngines();
  const resolved = [];

  function register(supported, handler, ext) {
    supported.forEach(x => {
      if (!EXTENSIONS.includes(x)) {
        EXTENSIONS.push(x);
      }
      engines[x] = [handler, ext || 'js'];
    });
  }

  function filter(regex, callback, namespace) {
    namespace = namespace || callback.name;
    resolved.push({ regex, callback, namespace });
  }

  function setup(supported) {
    Object.assign(hooks, supported);
  }

  set.reduce((prev, cur) => prev.concat(cur || []), [])
    .filter(Boolean)
    .forEach(cb => {
      if (!cb || typeof cb !== 'object') {
        throw new Error(`Invalid plugin, given '${inspect(cb)}'`);
      }

      if (!cb.name) {
        throw new Error(`Missing plugin name, given '${inspect(cb)}'`);
      }

      if (typeof cb.run !== 'function') {
        throw new Error(`Invalid or missing callback, given '${inspect(cb)}'`);
      }

      cb.run({
        cwd, dest, flags, cache, setup, filter, register,
      });
    });

  return (src, _dest) => defer(resolved.map(cur => {
    let matched;
    src = src.filter(x => {
      if (!flags.force && cache[x] && !cache[x].dirty) return false;

      const matches = x.match(cur.regex);

      if (!matches) return true;
      cache[x] = cache[x] || {};
      cache[x].namespace = cur.namespace;
      cache[x].filepath = x;
      cache[x].modified = +mtime(x);
      cache[x].filename = cache[x].destination
        ? relative(cache[x].destination, dest)
        : `${matches[1]}.${matches[2]}`;
      matched = true;
      return false;
    });

    if (matched) {
      matched = [];
      keys(cache).forEach(key => {
        if (cache[key].namespace === cur.namespace) matched.push(cache[key].filepath);
      });
      return () => Promise.resolve()
        .then(() => cur.callback(matched, _dest || dest, flags))
        .then(files => [cur.namespace, files])
        .catch(e => {
          throw new Error(`Cannot process '${cur.namespace}': ${e.stack}`);
        });
    }
    return null;
  }));
}

function globals(source, vars) {
  const values = {};

  keys(vars).forEach(prop => {
    values[prop] = typeof vars[prop] === 'function'
      ? String(vars[prop]()).trim()
      : expr(vars[prop]);
  });

  return source
    .replace(RE_GLOBAL, (_, sub) => {
      const out = [];

      sub.split(/[\s,]+/).forEach(k => {
        if (typeof values[k] !== 'undefined') {
          out.push(`${k}=${values[k]}`);
        }
      });

      return out.length ? `var ${out.join(', ')};` : '';
    });
}

function replaceMacro(text, _globals) {
  const ifRegex = /^\s*(?:#|<!--|\/[/*])\s*IF(?:DEF)?/;
  const endRegex = /^\s*(?:#|<!--|\/[/*])\s*ENDIF/;
  const getValuesRegex = /\s*(?:#|<!--|\/[/*])\s*IF(_?NOT|NDEF)?\s+([a-zA-Z_]+)/;

  const lines = text.replace(/>(?!\n)/g, '>\n').replace(/(?!\n)</g, '\n<').split('\n');

  let startFound = 0;
  let endFound = 0;
  for (let i = 0; i <= lines.length; i += 1) {
    if (ifRegex.test(lines[i])) startFound = i;
    if (endRegex.test(lines[i])) {
      endFound = i;
      break;
    }
  }

  const startMatch = getValuesRegex.exec(lines[startFound]);
  const flag = _globals[startMatch[2]] === 'true' || _globals[startMatch[2]] === true;
  const keepBlock = startMatch[1] ? !flag : flag;

  if (keepBlock) {
    lines.splice(startFound, 1);
    lines.splice(endFound - 1, 1);
  } else {
    lines.splice(startFound, endFound - startFound + 1);
  }

  return lines.join('\n');
}

function conditionals(text, _globals) {
  while (RE_MACROS.test(text)) text = replaceMacro(text, _globals);
  return text;
}

module.exports = {
  getExtensions,
  getEngines,
  getHooks,
  getModule,
  getContext,
  isSupported,
  checkDirty,
  filters,
  configure,
  generate,
  plugins,
  modules,
  embed,
  rename,
  load,
  globals,
  conditionals,
};
