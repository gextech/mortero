const Source = require('../source');

const {
  keys,
  array,
  fetch,
  mtime,
  isFile,
  resolve,
  extname,
  dirname,
  readFile,
  relative,
  joinPath,
  writeFile,
} = require('../common');

const {
  modules,
  getModule,
  getExtensions,
  isSupported,
  isLocal,
  TEMP_DIR,
} = require('../support');

const memoized = {};

const Mortero = (entry, external) => ({
  name: 'mortero',
  setup(build) {
    if (!Source.has(entry.filepath)) {
      Source.set(entry.filepath, { instance: entry });
    }

    const paths = array(entry.options.paths);
    const aliases = keys(entry.options.aliases).reduce((memo, cur) => {
      let value = entry.options.aliases[cur];
      if (Object.prototype.toString.call(value) === '[object Object]') {
        if (value[process.env.NODE_ENV]) value = value[process.env.NODE_ENV];
        if (value) Object.assign(memo, value);
      } else {
        memo[cur] = value;
      }
      return memo;
    }, {});

    async function buildSource(path, locals) {
      if (/\.(?:esm?|[mc]js|json|(?<!post\.)css)$/.test(path)) return null;
      if (/\.[jt]sx?$/.test(path) && !isLocal(path, entry.options)) return null;
      if (!isFile(path)) throw new Error(`File not found: ${path}`);

      if (typeof entry.options.resolve === 'function') {
        const result = entry.options.resolve(path, locals);

        if (typeof result !== 'undefined') {
          return result;
        }
      }

      const tmpFile = joinPath(TEMP_DIR, `${path.replace(/\W/g, '_')}@out`);

      let params = Source.get(path);
      if (params && params.dirty === false && isFile(tmpFile) && (mtime(path) <= mtime(tmpFile))) {
        const buffer = readFile(tmpFile);
        const offset = buffer.indexOf('\n');

        return {
          loader: buffer.substr(0, offset),
          contents: buffer.substr(offset + 1),
          resolveDir: dirname(path),
        };
      }

      if (!params || !params.instance || !params.input || params.input !== params.instance.source) {
        if (!params || !params.instance || !params.input) {
          params = { instance: new Source(path, entry.options) };
        }

        Object.assign(params.instance.locals, locals);

        params.instance._dependency = true;

        try {
          await params.instance.compile();
        } catch (e) {
          params.instance.failure = e;
        }

        if (params.instance.resources) {
          entry.resources = entry.resources || [];
          entry.resources.push(...params.instance.resources);
        }

        if (module.exports[params.instance.extension]) {
          params.instance.loader = params.instance.extension;
        }

        Source.set(path, params = {
          ...params,
          input: params.instance.source,
          output: {
            loader: params.instance.loader,
            contents: params.instance.source,
            resolveDir: dirname(path),
          },
        });

        writeFile(tmpFile, `${params.output.loader}\n${params.output.contents}`);
      }
      return params.output;
    }

    async function fetchSource(path) {
      const tmpFile = joinPath(TEMP_DIR, path.replace(/\W/g, '_'));

      if (!isFile(tmpFile)) {
        await fetch(path, tmpFile);
      }

      return {
        contents: readFile(tmpFile),
      };
    }

    build.onResolve({ filter: /^https?:\/\// }, args => ({
      path: args.path,
      namespace: 'http-url',
    }));

    build.onResolve({ filter: /.*/ }, async args => {
      if (args.namespace === 'http-url' || args.path.charAt() === '/') return;

      if (/^https?:\/\//.test(args.path)) {
        return { path: args.path, namespace: 'http-url' };
      }

      if (memoized[args.resolveDir + args.path]) {
        return { path: memoized[args.resolveDir + args.path] };
      }

      if (aliases[args.path]) {
        args.path = aliases[args.path];
        args.alias = true;
        if (args.path.charAt() === '.') {
          args.path = resolve(args.path);
        }
      }

      let fixedModule = args.path.indexOf('~/') === 0
        ? resolve(args.path.substr(2))
        : resolve(args.path, args.resolveDir);

      fixedModule = getModule(fixedModule, null) || getModule(args.path, [args.resolveDir].concat(paths));

      const name = args.path.split('/')[0];

      if (!fixedModule && !'~.'.includes(name.charAt()) && !external.includes(name)) {
        fixedModule = await modules(args.path, entry, true);
      }

      if (fixedModule) {
        memoized[args.resolveDir + args.path] = fixedModule;
        return { path: fixedModule };
      }

      if (name.charAt() === '.' && !isSupported(args.path)) {
        const src = joinPath(args.resolveDir, args.path);

        return { path: src, namespace: 'resource' };
      }

      if (args.alias) {
        return { path: args.path };
      }
    });

    build.onLoad({ filter: getExtensions(true) }, ({ path, namespace }) => {
      if (namespace === 'http-url') return fetchSource(path);
      if (!entry.children.includes(path) && !path.includes('node_modules')) {
        entry.children.push(path);
      }
      return buildSource(path);
    });

    build.onLoad({ filter: /.*/, namespace: 'resource' }, ({ path }) => {
      const ext = extname(path, true);

      if (!entry.options.extensions || !entry.options.extensions[ext]) {
        return { contents: `export default "#!@@locate<${path}>"` };
      }
      return buildSource(path, entry.locals);
    });

    build.onResolve({ filter: /.*/, namespace: 'http-url' }, args => ({
      path: new URL(args.path, args.importer).toString(),
      namespace: 'http-url',
    }));

    build.onLoad({ filter: /.*/, namespace: 'http-url' }, ({ path }) => fetchSource(path));
  },
});

function esbuild(params, next, ext) {
  const external = array(params.data.$external, params.options.external);
  const platform = params.data.$platform || params.options.platform;
  const banner = params.data.$banner || params.options.banner;
  const inject = params.data.$inject || params.options.inject;
  const footer = params.data.$footer || params.options.footer;
  const bundle = params.data.$bundle || params.options.bundle;
  const format = params.data.$format || params.options.format;
  const target = params.data.$target || params.options.target;
  const shake = params.data.$shake || params.options.shake;
  const name = params.data.$name || params.options.name;
  const esnext = !format || format === 'esm';

  const _module = params.options.modules;
  const _bundle = typeof bundle === 'function'
    ? bundle(relative(params.filepath))
    : bundle;

  params.isModule = _module;
  params.isBundle = !_module && _bundle;

  const options = {
    resolveExtensions: getExtensions(false, params.options.extensions),
    mainFields: ['svelte', 'module', 'main'],
    treeShaking: shake !== false,
    legalComments: 'inline',
    target: !esnext ? target || 'node10.23' : undefined,
    define: keys(process.env).reduce((memo, k) => {
      if (typeof process.env[k] !== 'object' && k.indexOf('npm_') === -1) {
        memo[`process.env.${k}`] = JSON.stringify(process.env[k]);
      }
      return memo;
    }, {}),
    logLevel: (params.options.quiet && 'silent') || undefined,
    inject: [].concat(inject || []),
    sourcemap: params.options.debug && params.debug !== false ? 'inline' : undefined,
    sourcesContent: false,
    platform: platform || 'node',
    format: format || 'esm',
    globalName: name,
    banner,
    footer,
    stdin: {
      sourcefile: relative(params.filepath).replace(/[^/]+\//g, '../'),
      resolveDir: dirname(params.filepath, params.options.cwd),
      contents: params.source,
      loader: ext,
    },
    color: true,
    write: false,
    bundle: params.isBundle,
    minify: params.options.minify,
    external: params.isBundle ? external : undefined,
    plugins: [Mortero(params, external)],
  };

  if (params.options.dest) {
    options.outdir = params.options.dest;
  }

  require('esbuild').build(options).then(result => {
    const stylesheet = result.outputFiles.find(x => x.path.includes('.css'));
    const javascript = result.outputFiles.find(x => x.path === '<stdout>');

    return Source.rewrite(params, javascript ? javascript.text : '')
      .then(output => {
        params._rewrite = true;
        params.source = output;
        params.source = typeof params.options.rewrite === 'function'
          ? params.options.rewrite(output, params)
          : output;

        if (stylesheet) {
          params.resources = params.resources || [];
          params.resources.push(['css', stylesheet.text]);
        }
        next();
      });
  }).catch(next);
}

function wrap(ext) {
  return function fn(params, next) {
    return esbuild.call(this, params, next, ext);
  };
}

module.exports = {
  js: [wrap('js'), 'js'],
  jsx: [wrap('jsx'), 'js'],
  ts: [wrap('ts'), 'js'],
  tsx: [wrap('tsx'), 'js'],
  json: [wrap('json'), 'js'],
};
