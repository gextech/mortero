const micromatch = require('micromatch');
const url = require('url');
const os = require('os');

const RE_COMMENTS_PATTERN = /\/\*.*?\*\//g;
const RE_ALL_SELECTORS_PATTERN = /(?:^|\})?\s*([^{}]+)\s*[,{](?![{])/g;
const RE_EXCLUDED_PATTERNS = /^\s*(?:@media|@keyframes|to|from|@font-face|\d+%)/;
const RE_SINGLE_SELECTOR = /((?:(?:\[[^\]+]\])|(?:[^\s+>~:]))+)((?:::?[^\s+>~(:]+(?:\([^)]+\))?)*\s*[\s+>~]?)\s*/g;
const RE_MATCH_SCOPE = /\sscope=(["']?)(.+?)\1/;

const RE_SOURCES = /<link[^<>]*?href=(.*?)[^<>]*?>|<script[^<>]*?src=(.*?)[^<>]*?>|(?<=:\s*)url\(.*?\)/g;
const RE_IMPORT = /(?:^|\b)(?:url\((["']?)([^\s)]+)\1|import\s+(?:([^;]*?)?\s*from\s+(["'])(.+?)\4))/g;
const RE_MACROS = /(?:#|<!--|\/[/*])\s*(IF(?:_?NOT|NDEF)?)\s+([\s\S]*?)(?:#|<!--|\/[/*])\s*ENDIF/;
const RE_LINKS = /(?:(?:href|src)=(["'])(.*?)\1)|url\((["']?)(.*?)\3\)/;
const RE_INLINE = /\sinline(?:=(["']?)(?:inline|true)\1)?(?:\b|$)/;
const RE_GLOBAL = /\/\*+\s*global\s+([A-Z_\d\s,]+?)\s*\*+\//g;
const RE_EXT = /\.(\w+)$(?=\?.*?|$)$/;

const RE_IF = /^\s*(?:#|<!--|\/[/*])\s*IF(?:DEF)?\s*/;
const RE_END = /^\s*(?:#|<!--|\/[/*])\s*ENDIF\s*/;
const RE_VALUES = /\s*(?:#|<!--|\/[/*])\s*IF(_?NOT|NDEF)?\s+([a-zA-Z_]+)\s*/;

const TEMP_DIR = os.tmpdir();

const {
  set,
  npm,
  puts,
  warn,
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
  readFile,
  writeFile,
  EXTENSIONS,
  COMPONENTS,
} = require('./common');

let _length;
let _regex;
function getExtensions(regex, extensions) {
  const fixed = [...new Set(EXTENSIONS.concat(Object.keys(extensions || {})))];

  if (regex) {
    if (fixed.length !== _length) {
      _regex = new RegExp(`.(?:${fixed.join('|')})$`);
      _length = fixed.length;
    }
    return _regex;
  }
  return fixed.map(x => `.${x}`);
}

function getEngines() {
  return require('./engines');
}

function getHooks(tpl, ctx) {
  const _keys = Object.keys(COMPONENTS._);

  if (_keys.length !== COMPONENTS.length) {
    COMPONENTS.re = new RegExp(`<(${_keys.join('|')})\\s*([^<>]*)(?:\\/>|>(.*)<\\/\\1>)|\\{@(${_keys.join('|')})\\s*(\\{[^{}]*\\}|[^{}]*)\\}`, 'g');
  }

  if (tpl) {
    return () => {
      const hookTasks = [];

      let matches;
      tpl.source = tpl.source.replace(COMPONENTS.re, (_, a, b, c, d, e) => {
        const tag = a || d;
        const attrs = b || e || '';
        const content = c || '';

        const backup = [];
        const tmp = attrs
          .replace(/"[^]*?"/g, match => backup.push(match) && '"@@str"')
          .replace(/(?:^|\s)(\w+)(?=\s\w+=|$)/g, ' $1:true')
          .replace(/,?\s*(\w+)[=:]/g, ',"$1":')
          .replace(/^,/, '')
          .replace(/\{\s*,/, '{')
          .replace(/&quot;/g, '"')
          .replace(/"@@str"/g, () => backup.shift());

        try {
          const props = JSON.parse(tmp.charAt() !== '{' ? `{${tmp}}` : tmp);

          matches = matches || tag === 'image';
          hookTasks.push(COMPONENTS._[tag]({ tpl, props, content }, { ...ctx, locate: ctx.locate.bind(null, tpl) }));
          return '<!#@@hook>';
        } catch (_e) {
          warn('\r{%yellow. %s%} Failed rendering `%s`\n%s\n', tag || _, attrs, _e.message);
          return _;
        }
      });

      return Promise.all(hookTasks).then(results => {
        tpl.source = tpl.source.replace(/<!#@@hook>/g, () => results.shift());
        if (matches) {
          tpl.source = tpl.source.replace(/<\/head|body>|$/, _ => `<script>${readFile(require('talavera').preload)}</script>${_}`);
        }
      });
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

function isLocal(src, opts) {
  return src.indexOf(opts.cwd) === 0 && !src.includes('node_modules');
}

function trace(error) {
  if (error.type === 'Parse') {
    return `${error.message}\n${error.extract.join('\n')}`;
  }
  if (error.path) {
    return error.message.replace(error.path, `./${relative(error.path)}`);
  }
  return error.message;
}

function include(path, attrs) {
  const suffix = process.env.NODE_ENV === 'production'
    ? `?t=${Date.now()}`
    : '?livereload';

  if (path.includes('.css')) return `<link rel="stylesheet" href="${path + suffix}"${attrs}>`;
  if (path.includes('.js')) return `<script type="module" src="${path + suffix}"${attrs}></script>`;

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

function stylesheet(ref, styles) {
  return styles.replace(RE_COMMENTS_PATTERN, '')
    .replace(RE_ALL_SELECTORS_PATTERN, (_, $1) => {
      if (RE_EXCLUDED_PATTERNS.test($1)) {
        return _;
      }

      const selectors = $1.split(',').map(s => s.trim());
      const scoped = selectors.map(s => {
        const matches = [];

        let match;
        while (match = RE_SINGLE_SELECTOR.exec(s)) { // eslint-disable-line
          matches.push([match[0], `${ref} ${match[1]}${match[2]} `]);
        }

        matches.forEach(m => {
          s = s.replace(m[0], m[1]);
        });

        return s;
      });

      return _.replace($1, scoped.join(', ')).replace(/\s,/g, ',');
    });
}

function getContext(options) {
  const dest = resolve(options.dest, './build');

  function push(tpl, skip, entry) {
    if (!skip && tpl) {
      let path = entry.destination || entry.filepath || entry.path || entry.src;
      if (entry.dest) path = joinPath(dest, entry.dest);
      if (!tpl.children.includes(path)) tpl.children.push(path);
    }
    return entry;
  }

  function locate(tpl, path, ignore) {
    let destFile = joinPath(dest, path);
    if (exists(destFile)) return push(tpl, ignore, { dest: path });

    for (let i = 0; i < options.root.length; i += 1) {
      destFile = joinPath(options.root[i], path);
      if (exists(destFile)) return push(tpl, ignore, { src: path });
    }

    if (exists(path)) {
      const entry = options.tmp[resolve(path)];

      if (entry && entry.destination) {
        return { dest: relative(push(tpl, ignore, entry).destination, dest) };
      }
      return push(tpl, ignore, { path });
    }

    for (const k in options.tmp) { // eslint-disable-line
      const entry = options.tmp[k] || {};

      if (typeof entry.filename === 'string' && path.includes(entry.filename)) {
        return { dest: relative(push(tpl, ignore, entry).destination, dest) };
      }

      if (typeof entry.filepath === 'string' && relative(entry.filepath).includes(path)) {
        if (entry.destination) return { dest: relative(push(tpl, ignore, entry).destination, dest) };
        return push(tpl, ignore, { path: entry.filepath });
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

function isSupported(src, exts = {}) {
  const name = basename(src);
  const parts = name.split('.');

  parts.shift();
  return parts.some(x => EXTENSIONS.includes(x) || x in exts);
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
    if (!filter.length) return false;

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
    if (pkg.mortero.bundle) flags.bundle = array(flags.bundle, pkg.mortero.bundle);
    if (pkg.mortero.rename) flags.rename = array(flags.rename, pkg.mortero.rename);
    if (pkg.mortero.filter) flags.filter = array(flags.filter, pkg.mortero.filter);
    if (pkg.mortero.ignore) flags.ignore = array(flags.ignore, pkg.mortero.ignore);
    if (pkg.mortero.exclude) flags.exclude = array(flags.exclude, pkg.mortero.exclude);

    if (pkg.mortero.options) {
      Object.keys(pkg.mortero.options).forEach(key => {
        if (typeof flags[key] === 'undefined') {
          flags[key] = pkg.mortero.options[key];
        }
      });
    }
  }

  Object.keys(flags).forEach(key => {
    if (key.includes('.')) set(flags, key);
  });

  const fixedExtensions = array(flags.ext).reduce((memo, cur) => {
    const [key, ...exts] = cur.replace(/^\./, '').split('.');

    memo[key] = exts.length ? exts : false;
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

async function modules(src, entry, _bundle) {
  const [base, sub] = src.split('/').slice(0, 2);

  let pkgName = base;
  if (base.charAt() === '@' && sub) pkgName += `/${sub}`;

  let mod;
  try {
    mod = require.resolve(pkgName);
  } catch (e) {
    mod = exists(resolve(`./node_modules/${pkgName}`));
  }

  if (!mod && !pkgName) {
    throw new Error(`Cannot resolve '${src}' as module`);
  }

  if (entry._local && entry.options.install !== false && !mod) {
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
      puts('\r{%magentaBright install%} %s {%gray %s%}', pkgName, `${diff / 1000}s\n`);
    }

    if (stderr.length && !entry.options.quiet) warn(stderr);
    if (stdout.length && !entry.options.quiet) puts(stdout);
  }
  if (_bundle) return;
  if (typeof mod === 'string' && !mod.includes('node_modules')) return mod;
}

async function embed(tpl, html, render) {
  const embedTasks = [];
  const comments = [];
  const data = {};

  html = html.replace(/<!--[^]*?-->/g, match => comments.push(match) && '<!--!#@@-->');
  html = html.replace(RE_SOURCES, sub => {
    if (sub.charAt() === '<' && !RE_INLINE.test(sub)) return sub;
    if (sub.includes('data:') || sub.length > 250) return sub;

    const src = sub.match(RE_LINKS);
    const base = tpl.options.base || `http://localhost:${process.env.PORT || 8080}`;

    let _url = src[2] || src[4];
    if (_url.indexOf('//') === 0) {
      _url = `http:${_url}`;
    } else {
      _url = url.resolve(base, _url);
    }

    const key = _url.replace(/\W/g, '_');

    embedTasks.push(async () => {
      const name = _url.split('#')[0].split('?')[0].replace(base, '.');
      const file = joinPath(TEMP_DIR, key);
      const local = joinPath(tpl.directory, name);
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
          puts('\r{%blue fetch%} %s\r', _url);
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
        out = await embed(tpl, out.toString(), render);

        const matches = sub.match(RE_MATCH_SCOPE);

        if (matches) {
          out = stylesheet(matches[2], out);
        }

        data[key] = `<style>${out.replace(/\s+/g, ' ').trim()}</style>`;
      } else if (sub.includes('url(')) {
        const ext = _url.match(RE_EXT)[1];

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
      .replace(/<\/style>\s*<style>/g, '\n')
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

function load(all, dest, flags = {}, cache = {}) {
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

  all.reduce((prev, cur) => prev.concat(cur || []), [])
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
    if (typeof vars[prop] !== 'object') {
      values[prop] = typeof vars[prop] === 'function'
        ? String(vars[prop]()).trim()
        : expr(vars[prop]);
    }
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
  const lines = text.split(/(?<=\n)/);

  let startFound = 0;
  let endFound = 0;
  for (let i = 0; i <= lines.length; i += 1) {
    if (RE_IF.test(lines[i])) startFound = i;
    if (RE_END.test(lines[i])) {
      endFound = i;
      break;
    }
  }

  const startMatch = RE_VALUES.exec(lines[startFound]);
  const endMatch = RE_END.exec(lines[endFound]);

  const flag = _globals[startMatch[2]] === 'true' || _globals[startMatch[2]] === true;
  const keepBlock = startMatch[1] ? !flag : flag;

  if (keepBlock) {
    lines[startFound] = startMatch.input.includes('\n') ? '\n' : '';
    lines[endFound] = (endMatch && endMatch.input.includes('\n')) ? '\n' : '';
  } else {
    while (startFound <= endFound) {
      lines[startFound] = lines[startFound].includes('\n') ? '\n' : '';
      startFound++;
    }
  }

  return lines.join('');
}

function conditionals(text, _globals) {
  while (RE_MACROS.test(text)) text = replaceMacro(text, _globals);
  return text;
}

module.exports = {
  RE_IMPORT,
  TEMP_DIR,
  getExtensions,
  getEngines,
  getHooks,
  getModule,
  getContext,
  isLocal,
  isSupported,
  checkDirty,
  filters,
  configure,
  generate,
  plugins,
  modules,
  embed,
  rename,
  trace,
  load,
  globals,
  conditionals,
};
