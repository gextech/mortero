const { spawn } = require('child_process');
const liveserver = require('live-server');
const chokidar = require('chokidar');
const wargs = require('wargs');

const { bin, name, version } = require('../package.json');

process.start = Date.now();
process.name = `${name} v${version}`;

const Source = require('./source');

const {
  ms,
  size,
  puts,
  keys,
  copy,
  bytes,
  defer,
  mtime,
  raise,
  quote,
  array,
  exists,
  unlink,
  lsFiles,
  extname,
  inspect,
  resolve,
  dirname,
  basename,
  relative,
  isMarkup,
  joinPath,
  readFile,
  writeFile,
} = require('./common');

const {
  load,
  rename,
  plugins,
  getHooks,
  configure,
  checkDirty,
  isSupported,
} = require('./support');

let cache = {};
if (exists('./cache.json')) {
  try {
    cache = JSON.parse(readFile('./cache.json'));
    keys(cache).forEach(entry => {
      if (Array.isArray(cache[entry].destination)) {
        if (!cache[entry].destination.every(exists)) {
          Object.entries(cache).forEach(([key, value]) => {
            if (entry === value.namespace) {
              delete cache[key];
              Source.set(key, { dirty: true });
            }
          });
        }
      } else {
        const dirty = checkDirty(entry, cache[entry]);

        cache[entry].dirty = dirty;
        Source.set(entry, { instance: cache[entry], dirty });
      }
    });
  } catch (e) {
    // ignore this
  }
}

let update;
function sync(flags) {
  if (flags.write !== false) {
    clearTimeout(update);
    update = setTimeout(() => {
      writeFile('./cache.json', JSON.stringify(cache, null, 2));
    }, 50);
  }
}

let child;
function exec(dest, flags) {
  return new Promise(next => {
    if (child) {
      child.kill('SIGINT');
    }

    puts('\r{%gray. %s%}\n', flags.exec.map(arg => quote(arg)).join(' '));

    child = spawn(flags.exec[0], flags.exec.slice(1), {
      cwd: flags.cwd || dest,
      detached: true,
    });

    child.stdout.pipe(process.stdout);
    child.stderr.on('data', data => {
      const line = data.toString().trim();

      if (line) {
        raise(line);
      }
    });

    child.on('close', exitCode => {
      if (exitCode && !flags.watch) process.exit(exitCode);
      if (!flags.watch) process.exit();
      next();
    });
  });
}

function svg(source, props, ctx) {
  if (source === false) {
    return `<pre>File not found: ${props.src || props.from}</pre>`;
  }
  return source.replace('<svg', `<svg${ctx.attributes(props, ['src', 'from', 'inline'])}`);
}

function json(entry) {
  return {
    sizes: entry.sizes,
    width: entry.width,
    height: entry.height,
    filesize: entry.filesize,
    destination: entry.destination,
    modified: +mtime(entry.filepath),
    filepath: entry.filepath,
    filename: entry.filename,
    children: entry.children,
  };
}

let total = 0;
function debug(deferred) {
  return deferred.then(tpl => {
    if (tpl.destination && !tpl.options.quiet) {
      const length = size(tpl.destination);
      const end = tpl.options.progress !== false ? '\n' : '';

      puts('\r{%cyan write%} %s {%magenta.arrow. %s%} {%gray (%s)%}', relative(tpl.destination), bytes(length), ms(tpl.worktime));
      puts(end);

      total += length;
    }
    cache[tpl.filepath] = json(tpl);
    return tpl;
  });
}

function write(set, dest, flags, pending, deferred) {
  return deferred.then(result => {
    let changed;
    result.filter(Array.isArray).forEach(([group, changes]) => {
      const start = new Date();

      let all = 0;
      let diff = 0;
      changes.forEach(file => {
        const destFile = resolve(flags.rename(file.dest));

        if (file.src) {
          const key = resolve(file.src);
          const time = mtime(key);

          cache[key] = json({
            ...cache[key],
            ...file,
            filepath: key,
            modified: +time,
            destination: destFile,
          });

          if (!(flags.force || (time - mtime(destFile)) > 0)) return false;
        } else {
          cache[group] = cache[group] || {
            namespace: group,
            destination: [],
          };

          if (!cache[group].destination.includes(destFile)) {
            cache[group].destination.push(destFile);
          }
        }

        let kind;
        if (typeof file.data === 'string' || file.data instanceof Buffer) {
          diff += 1;
          kind = '{%cyan write%}';
          writeFile(destFile, file.data);
        } else {
          diff += 1;
          kind = '{%cyanBright copy%}';
          copy(file.src, destFile);
        }

        const length = size(destFile);

        if (!flags.quiet) puts(`\r${kind} %s {%magenta.arrow. %s%}`, relative(destFile), bytes(length));
        if (!flags.quiet && flags.progress !== false) puts('\n');
        pending.push(destFile);
        all += length;
        return true;
      });

      total += all;
      changed = true;
      if (!flags.quiet) {
        puts('\r{% gray. %s: +%s file%s (%s)%} {%magenta.arrow. %s%}\n', group, diff, diff === 1 ? '' : 's', ms(Date.now() - start), bytes(all));
      }
    });
    if (!changed) set.length = 0;
  });
}

function watch(src, dest, flags, filter, callback) {
  const sources = src.concat(flags.watch !== true ? array(flags.watch)
    .filter(x => typeof x === 'string')
    .map(x => resolve(x)) : []);

  const loader = load(plugins(array(flags.plugins).concat(require('./talavera'))), dest, flags, cache);

  sources.forEach(dir => {
    if (!exists(dir)) {
      throw new Error(`Invalid directory to watch, given '${dir}'`);
    }
  });

  function enqueue(file, target, pending) {
    return debug(Source.compileFile(file, null, flags)).then(tpl => {
      pending.push(tpl.destination);
      Source.set(file, {
        ...target,
        dirty: false,
        instance: tpl,
      });
    });
  }

  let ready;
  function rebuild(files) {
    if (!ready) return;
    Source.forEach(({ instance }) => {
      if (!(instance && instance.children)) return;
      for (let i = 0; i < instance.children.length; i += 1) {
        if (files.includes(instance.children[i])) {
          change(instance.filepath); // eslint-disable-line
          break;
        }
      }
    });
  }

  function prune(deps, target) {
    for (let i = 0; i < deps.length; i += 1) {
      if (target.children.includes(deps[i])) {
        Source.set(target.filepath, { dirty: true });
        Source.set(deps[i], {});
        return true;
      }
    }
  }

  let deferred = Promise.resolve();
  async function compile(skip) {
    compile.next = null;
    compile.deps = [];
    compile.queue = [];
    compile.missed = [];
    compile.pending = [];

    clearTimeout(compile.timeout);
    compile.timeout = setTimeout(() => {
      Source.forEach((target, file) => {
        if (!target.dirty) return;

        const test = isSupported(file);
        const dep = !filter(file, relative(file));

        if (test) compile.deps.push(file);
        if (dep) {
          if (!test) compile.missed.push(file);
          return;
        }

        if (src.some(x => file.includes(x))) {
          compile.queue[isMarkup(file) ? 'push' : 'unshift'](() => compile.next && enqueue(file, target, compile.pending));
        }
      });

      let changed;
      if (!skip) {
        Source.forEach((_, file) => {
          if (cache[file] && cache[file].children && prune(compile.deps, cache[file])) changed = true;
        });
      }

      deferred = deferred
        .then(() => { compile.next = true; })
        .then(() => changed && compile(true))
        .then(() => {
          if (compile.next && compile.missed.length) {
            const missed = compile.missed.slice();

            missed.forEach(x => {
              Source.set(x, { dirty: false });
            });
            compile.missed = [];

            return write(missed, dest, flags, compile.pending, loader(missed, dest, flags));
          }
        })
        .then(() => compile.next && defer(compile.queue))
        .then(() => compile.next && rebuild(compile.pending))
        .then(() => compile.next && (sync(flags) || (flags.exec && exec(dest, flags))))
        .then(() => {
          if (!ready) {
            Source.forEach((_, file) => {
              change(file, true, false); // eslint-disable-line
            });
          }

          ready = true;
          puts('\r{%gray. waiting for changes... [press CTRL-C to quit]%}');
        });
    }, flags.timeout || 100);
  }

  function ok(file) {
    return !filter(null, relative(file));
  }

  function add(file) {
    if (ok(file)) {
      if (!Source.has(file)) {
        Source.set(file, cache[file] = { filepath: file, dirty: true });
      }
      compile();
    }
  }

  function change(file, skip, dirty = true) {
    if (ok(file)) {
      Source.set(file, { ...Source.get(file), dirty });
      cache[file] = { ...cache[file], dirty };
      if (!skip) compile();
    }
  }

  function removal(file) {
    if (Source.has(file)) {
      const { instance } = Source.get(file);

      delete cache[file];
      Source.delete(file);
      sync(flags);

      if (instance && instance.destination) {
        unlink(instance.destination);
        puts('\r{%gray delete%} %s\n', relative(instance.destination));
      }
    }
  }

  puts('\r{%yellowBright watch%} %s', sources.map(x => `./${relative(x)}`).join(', '));
  callback(() => {
    compile();
    puts('\n');

    process.on('SIGINT', () => process.exit());
    process.on('exit', () => puts('\n'));

    const watcher = chokidar.watch(sources, {
      ignored: /(^|[/\\])\../,
      ignoreInitial: false,
      persistent: true,
    });

    watcher
      .on('all', (type, file) => {
        if (type === 'add') add(file);
        if (type === 'change') change(file);
        if (type === 'unlink') removal(file);
      });
  });
}

function init(src, dest, flags, length) {
  if (!process.silent) {
    puts('\r{%gray. %s (%s — %s)%}\n', process.name, ms(Date.now() - process.start), process.env.NODE_ENV || 'development');
  }

  if (!flags.quiet) {
    const dirs = src.map(x => `./${relative(x)}`).join(', ');

    if (length >= 0 && flags.progress === false) {
      puts('\r{%gray. %s file%s from %s%}\n', length, length === 1 ? '' : 's', dirs);
    } else if (length >= 0) {
      puts('\r{%yellow. from%} %s {%gray. (%s file%s)%}\n', dirs, length, length === 1 ? '' : 's');
    } else {
      puts('\r{%yellow. from%} %s\n', dirs);
    }
  } else if (!process.silent && length >= 0) {
    puts('\r{%gray. processing %s file%s...%}', length, length === 1 ? '' : 's');
  }

  let count = 0;
  array(flags.copy).forEach(x => {
    const [_src, _dest] = x.split(':');
    const _length = lsFiles(resolve(_src)).reduce((prev, cur) => prev + size(cur), 0);

    total += _length;
    count += 1;

    if (!flags.quiet && flags.progress !== false) {
      puts('\r{%cyanBright copy%} %s {%magenta.arrow. %s%}\n', _src, bytes(_length));
    }

    copy(resolve(_src), joinPath(dest, _dest));
  });

  if (!flags.quiet && flags.progress === false) {
    puts('\r{%gray. %s source%s copied %} {%magenta.arrow. %s%}\n', count, count === 1 ? '' : 's', bytes(total));
  }
}

async function main({
  _, raw, data, flags, params,
}) {
  const cwd = resolve('.');
  const src = resolve(_, './src', true);
  const dest = resolve(flags.dest, './build');

  if (flags.processName) {
    process.name = `${flags.processName} / ${process.name}`;
  }

  if (flags.version) {
    puts([
      '            .-.',
      '           /  /',
      '   _______/__/_',
      '  |            |',
      '   \\          /',
      '    \\________/',
      '',
    ].join('\n'));
    puts('{%bold %s%} v%s\n', name, version);
    return;
  }

  if (flags.help) {
    const USAGE_INFO = readFile(resolve(`${__dirname}/../usage.txt`));
    const README_INFO = readFile(resolve(`${__dirname}/../README.md`)).match(/(?<=```\n)[^]*?(?=\n```)/g);

    init(src, dest, { quiet: true });
    puts(USAGE_INFO.replace('$0', Object.keys(bin)[0]).replace(/\$(\d)/, ($0, x) => README_INFO[parseInt(x, 10) - 1]));
    return;
  }

  const pkg = exists('package.json')
    ? JSON.parse(readFile('package.json'))
    : {};

  const {
    fixedExtensions,
    fixedAliases,
    isFiltered,
    isIgnored,
    isBundle,
  } = configure(flags, pkg);

  const isIncluded = file => {
    if (isIgnored(file) || file.includes(dest)) return false;
    if (Array.isArray(flags.only)) {
      return flags.only.some(chunk => file.includes(chunk));
    }
    if (typeof flags.only === 'string') {
      return file.includes(flags.only);
    }
    return true;
  };

  const match = (x, rel) => {
    if (!x) return isIgnored(rel);
    if (!x.includes(cwd)) return false;
    return isIncluded(rel) && isFiltered(rel) && isSupported(rel);
  };

  flags.tmp = cache;
  flags.exec = raw.length ? raw : undefined;
  flags.root = src.filter(x => resolve(x) !== cwd).map(x => relative(x));
  flags.debug = flags.debug || process.env.NODE_ENV !== 'production';
  flags.bundle = x => flags.bundle && isBundle(x);
  flags.rename = rename(dest, flags.rename);
  flags.globals = { ...data, pkg };
  flags.aliases = fixedAliases;
  flags.extensions = fixedExtensions;

  if (flags.install !== false) {
    flags.install = flags.install || process.env.NODE_ENV === 'development';
  }

  if (!flags.root.length) {
    throw new Error('Missing sources');
  }

  flags.root.forEach(dir => {
    if (!exists(dir)) {
      throw new Error(`Invalid source directory, given '${dir}'`);
    }
  });

  keys(process.env).forEach(key => {
    if (key.indexOf('npm_') === -1) {
      flags.globals[key] = process.env[key];
    }
  });

  Object.assign(getHooks(), {
    source: async ({ tpl, ctx, props }) => {
      if (props.src) {
        return `<source ${ctx.attributes(props)}>`;
      }

      if (!props.path) {
        throw new Error(`Missing 'path' attribute, given ${inspect(props)}`);
      }

      let _src = props.path;
      if (props.path.charAt() === '.') {
        _src = joinPath(dirname(tpl.filepath), _src);
      }

      const buffer = readFile(_src);

      if (buffer === false) {
        throw new Error(`Source not found: ${props.path}`);
      }

      const lang = extname(props.path).substr(1);
      const code = await Source.highlight(buffer, lang, props);

      if (!code.includes('<pre')) {
        const className = props.highlight === 'highlight.js' ? 'hljs' : props.highlight || 'hljs';

        return `<pre class="${className}"><code class="lang-${lang || 'auto'}">${code}</code></pre>`;
      }
      return code;
    },
    import: ({ tpl, props }, ctx) => {
      if (!props.from) {
        throw new Error(`Missing 'from' attribute, given ${inspect(props)}`);
      }

      return array(props.from).reduce((prev, cur) => {
        const chunk = ctx.locate(cur);

        if (chunk.dest) {
          const asset = chunk.dest.includes('.svg')
            ? svg(readFile(joinPath(dest, chunk.dest)), props, ctx)
            : ctx.include(chunk.dest);

          prev += asset;
        } else if (chunk.path) {
          prev += chunk.path.includes('.svg')
            ? svg(readFile(chunk.path), props, ctx)
            : readFile(chunk.path);
        } else {
          const file = joinPath(dirname(tpl.filepath), chunk.src);

          prev += chunk.src.includes('.svg')
            ? svg(readFile(file), props, ctx)
            : readFile(file);
        }
        return prev;
      }, '');
    },
    alink: ({ tpl, props, content }, ctx) => {
      if (!props.for) {
        throw new Error(`Missing 'for' attribute, given ${inspect(props)}`);
      }

      const url = tpl.locals.location.pathname;
      const base = props.for.split('#')[0].split('?')[0];

      props.href = (!props.for.includes('://') && (props.for !== '/' ? `.${props.for}` : '.')) || props.for;
      props.target = props.target || props.external ? '_blank' : undefined;

      const attrs = ctx.attributes(props, ['for', 'text', 'external']);

      let matches = props.exact && base === url;
      if (!props.exact) {
        matches = url.indexOf(base) === 0 && (base === url || url.charAt(base.length) === '/');
      }
      if (matches) {
        return `<a aria-current="page"${attrs}>${content || props.text}</a>`;
      }
      return `<a${attrs}>${content || props.text}</a>`;
    },
    data: ({ tpl, props }, ctx) => {
      if (!props.from) {
        throw new Error(`Missing 'from' attribute, given ${inspect(props)}`);
      }

      const chunk = ctx.locate(props.from);

      let buffer;
      let file;
      if (chunk.dest) {
        file = chunk.dest;
        buffer = readFile(joinPath(dest, file));
      } else if (chunk.path) {
        file = chunk.path;
        buffer = readFile(file);
      } else {
        file = chunk.src;
        buffer = readFile(joinPath(dirname(tpl.filepath), file));
      }

      const type = props.type || `image/${extname(file).substr(1)}`;

      return `data:${type};base64,${Buffer.from(buffer).toString('base64')}`;
    },
  });

  if (flags.watch) {
    init(src, dest, flags);
    watch(src, dest, flags, match, next => {
      if (flags.serve !== false) {
        const dirs = array(flags.serve);
        const opts = {
          port: flags.port || undefined,
          root: dest,
          open: false,
          logLevel: 0,
          watch: dirs.concat(dest),
          mount: Object.entries(params).concat(dirs.map(x => ['/', x])),
        };

        if (flags.proxy) {
          opts.proxy = array(flags.proxy).reduce((memo, chunk) => {
            const _part = chunk.trim();

            let _parts;
            if (_part.includes('->') || _part.includes(' ') || _part.charAt() === '/') {
              _parts = _part.split(/\s*->\s*|\s+|:/);

              let _dest = _parts.slice(1).join(':');
              if (/^\d+/.test(_dest)) _dest = `:${_dest}`;
              if (_dest.charAt() === ':') _dest = `0.0.0.0${_dest}`;
              if (!_dest.includes('://')) _dest = `http://${_dest}`;

              _parts[0].split(',').forEach(sub => {
                memo.push([sub, `${_dest.replace(/\/$/, '')}${_dest.substr(-1) !== '/' ? sub : ''}`]);
              });
            } else {
              _parts = _part.match(/^(\w+:\/\/[\w:.]+)(\/.*?)?$/);
              memo.push([(_parts && _parts[2]) || '/', _part]);
            }
            return memo;
          }, []);
        }

        const server = liveserver.start(opts).on('error', () => {
          raise('\r{%red. cannot start live-server%}\n');
          process.exit(1);
        }).on('listening', () => {
          const { address, port } = server.address();

          puts('\n{%gray %s%}', `server http://${address}:${port}`);
          next();
        });
      } else {
        next();
      }
    });
  } else {
    const start = Date.now();
    const missed = [];
    const loader = load(plugins(array(flags.plugins).concat(require('./talavera'))), dest, flags, cache);
    const srcFiles = Source.listFiles(src).sort((a, b) => isMarkup(a) - isMarkup(b)).filter(x => {
      if (match(x, relative(x))) return flags.force || checkDirty(x, cache[x]);
      if (!isSupported(x) && isIncluded(relative(x))) missed.push(x);
      return false;
    });

    init(src, dest, flags, srcFiles.length);

    if (!flags.quiet && flags.progress === false) {
      const limit = Math.max(0, flags.show ? parseInt(flags.show, 10) : 3);
      const files = srcFiles.slice(0, limit).map(file => basename(file)).join(', ');

      if (srcFiles.length > limit && limit > 0) {
        const diff = srcFiles.length - limit;

        puts('\r{%blue render%} %s (and %s file%s more)\n', files, diff, diff === 1 ? '' : 's');
      } else if (files && limit > 0) {
        puts('\r{%blue render%} %s\n', files);
      }
    }

    let status = '{%gray. without changes%}';
    await Promise.resolve().then(() => write(missed, dest, flags, [], loader(missed, dest, flags)))
      .then(() => defer(srcFiles.map(x => () => debug(Source.compileFile(x, null, flags)))))
      .then(() => sync(flags) || (flags.exec && exec(dest, flags)))
      .then(() => {
        if (srcFiles.length || missed.length) {
          const count = srcFiles.length + missed.length;
          const plus = count > srcFiles.length ? '+' : '';
          const msg = flags.quiet ? `${count}${plus} file${count === 1 ? '' : 's'} written` : 'done';

          status = `{%gray. ${msg} in ${ms(Date.now() - start)}%} {%magenta.arrow. ${bytes(total)}%}`;
        }
        if (!process.silent) puts(`\r${status}\n`);
      });
  }
}

module.exports = argv => {
  const options = wargs(argv, {
    boolean: 'nqwfdVSWEAROM',
    string: 'CeDbcyopPsaBriIFXLTNH',
    alias: {
      C: 'cwd',
      e: 'ext',
      D: 'dest',
      b: 'base',
      c: 'copy',
      y: 'only',
      o: 'show',
      p: 'port',
      P: 'proxy',
      s: 'serve',
      q: 'quiet',
      w: 'watch',
      a: 'alias',
      f: 'force',
      d: 'debug',
      H: 'paths',
      B: 'bundle',
      n: 'online',
      M: 'modules',
      N: 'external',
      r: 'rename',
      i: 'ignore',
      I: 'ignore-from',
      F: 'filter',
      X: 'exclude',
      L: 'plugins',
      T: 'timeout',
      V: 'verbose',
      S: 'no-serve',
      W: 'no-write',
      E: 'no-embed',
      A: 'no-install',
      R: 'no-rewrite',
      O: 'no-progress',
    },
  });

  return main(options).catch(e => {
    raise('\r{%red. failure%} %s\n', e[options.verbose ? 'stack' : 'message']);
    process.exit(1);
  });
};
