const Source = require('../source');

const {
  expr,
  keys,
  array,
  fetch,
  exists,
  resolve,
  extname,
  dirname,
  readFile,
  relative,
  joinPath,
} = require('../common');

const {
  modules,
  getModule,
  getExtensions,
  isSupported,
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
      if (/\.(?:mjs|[jt]sx?|json)$/.test(path)) {
        if (path.includes('.json') || path.includes('node_modules')) return null;
      }

      let params = Source.get(path);
      if (!params || !params.instance || !params.input || params.input !== params.instance.source) {
        if (!params || !params.instance || !params.input) {
          params = { instance: new Source(path, entry.options) };
        }

        Object.assign(params.instance.locals, locals);

        await params.instance.compile();
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
      }
      return params.output;
    }

    async function fetchSource(path) {
      const tmpFile = joinPath(TEMP_DIR, path.replace(/\W/g, '_'));

      if (!exists(tmpFile)) {
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

      fixedModule = getModule(fixedModule) || getModule(args.path, [args.resolveDir].concat(paths));

      const name = args.path.split('/')[0];

      if (!fixedModule && name.charAt() !== '.' && !external.includes(name)) {
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
  const name = params.data.$name || params.options.name;
  const esnext = !format || format === 'esm';

  const _module = params.data.$modules !== false
    ? (params.data.$modules || params.options.modules)
    : false;

  const _bundle = typeof bundle === 'function'
    ? bundle(relative(params.filepath))
    : bundle;

  params.isModule = _module;
  params.isBundle = !_module && _bundle;

  require('esbuild').build({
    resolveExtensions: getExtensions(false, params.options.extensions),
    mainFields: ['svelte', 'module', 'main'],
    target: !esnext ? target || 'node10.23' : undefined,
    define: keys(params.options.globals).reduce((memo, k) => {
      if (typeof params.options.globals[k] !== 'object') {
        memo[`process.env.${k}`] = expr(params.options.globals[k]);
      }
      return memo;
    }, {}),
    logLevel: (params.options.quiet && 'silent') || undefined,
    inject: [].concat(inject || []),
    sourcemap: params.options.debug ? 'inline' : undefined,
    sourcesContent: false,
    platform: platform || 'node',
    format: format || 'esm',
    globalName: name,
    banner,
    footer,
    stdin: {
      sourcefile: relative(params.filepath).replace(/[^/]+\//g, '../'),
      resolveDir: params.options.cwd || dirname(params.filepath),
      contents: params.source,
      loader: ext,
    },
    color: true,
    write: false,
    bundle: params.isBundle,
    minify: params.options.minify,
    external: params.isBundle ? external : undefined,
    plugins: [Mortero(params, external)],
  }).then(result => {
    return Promise.resolve()
      .then(() => Source.rewrite(params, result.outputFiles[0].text))
      .then(output => {
        params._rewrite = true;
        params.source = output;
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
