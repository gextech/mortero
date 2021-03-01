const reImport = require('rewrite-imports');
const reExport = require('rewrite-exports');

const Source = require('../source');

const {
  expr,
  keys,
  array,
  defer,
  fetch,
  resolve,
  dirname,
  relative,
  writeFile,
} = require('../common');

const {
  modules,
  getModule,
  getExtensions,
} = require('../support');

const RE_MATCH_IMPORT = /(?<=(?:^|\b)import\s+[^;]*?\bfrom\s+)(["'])(@?[\w-].*?)\1/;
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

    build.onResolve({ filter: /.*/ }, async args => {
      if (memoized[args.resolveDir + args.path]) {
        return { path: memoized[args.resolveDir + args.path] };
      }

      if (aliases[args.path]) {
        args.path = aliases[args.path];
        if (args.path.charAt() === '.') {
          args.path = resolve(args.path);
        }
      }

      let fixedModule = args.path.indexOf('~/') === 0
        ? resolve(args.path.substr(2))
        : resolve(args.path, args.resolveDir);

      fixedModule = getModule(fixedModule) || getModule(args.path, [args.resolveDir].concat(paths));

      if (!fixedModule && args.path.charAt() !== '.' && !external.some(x => args.path.includes(x))) {
        fixedModule = await modules(args.path, entry, true);
      }

      if (fixedModule) {
        memoized[args.resolveDir + args.path] = fixedModule;
        return { path: fixedModule };
      }
    });

    build.onLoad({ filter: getExtensions(true) }, async ({ path }) => {
      if (!/\.(?:[jt]sx?|json)$/.test(path)) {
        let params = Source.get(path);
        if (!params || !params.instance || !params.input || params.input !== params.instance.source) {
          const dest = resolve(entry.options.dest, './build');

          if (!params || !params.instance || !params.input) {
            params = { instance: new Source(path, entry.options) };
          }

          await params.instance.compile(dest);
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

        if (!entry.children.includes(path) && !path.includes('node_modules')) {
          entry.children.push(path);
        }
        return params.output;
      }
    });

    build.onResolve({ filter: /^https?:\/\// }, args => ({
      path: args.path,
      namespace: 'http-url',
    }));

    build.onResolve({ filter: /.*/, namespace: 'http-url' }, args => ({
      path: new URL(args.path, args.importer).toString(),
      namespace: 'http-url',
    }));

    build.onLoad({ filter: /.*/, namespace: 'http-url' }, async args => ({ contents: await fetch(args.path) }));
  },
});

async function rewrite(_module, { src, text, params }) {
  if (!_module) {
    const test = typeof params.data.$rewrite !== 'undefined' ? params.data.$rewrite : params.options.rewrite;

    if (test !== false && src.includes('.js')) {
      text = reExport(reImport(text)).replace(/await(\s+)import/g, '/* */$1require');
    }
  } else {
    const destDir = typeof _module === 'string' ? _module : 'web_modules';
    const moduleTasks = [];

    text = text.replace(RE_MATCH_IMPORT, (_, qt, name) => {
      if (params.data.$unpkg || params.options.unpkg) {
        return `${qt}//unpkg.com/${name}?module${qt}`;
      }
      if (params.options.write !== false) {
        moduleTasks.push(() => modules(name, params));
      } else {
        moduleTasks.push(() => `${destDir}/${name}`);
      }
      return `${qt}/*#!@@mod*/${qt}`;
    });

    await defer(moduleTasks, resolved => {
      text = text.replace(/\/\*#!@@mod\*\//g, () => `/${resolved.shift()}`);
    });
  }
  return text;
}

function esbuild(params, next, ext) {
  const external = array(params.data.$external, params.options.external);
  const platform = params.data.$platform || params.options.platform;
  const bundle = params.data.$bundle || params.options.bundle;
  const format = params.data.$format || params.options.format;
  const target = params.data.$target || params.options.target;
  const debug = params.data.$debug || params.options.debug;
  const esnext = !format || format === 'esm';

  const _module = params.data.$modules !== false
    ? (params.data.$modules || params.options.modules)
    : false;

  const _bundle = typeof bundle === 'function'
    ? bundle(relative(params.filepath))
    : bundle;

  require('esbuild').build({
    external,
    resolveExtensions: getExtensions(),
    target: !esnext ? target || 'node10.23' : undefined,
    outdir: esnext ? params.directory : undefined,
    define: keys(params.options.globals).reduce((memo, k) => {
      if (typeof params.options.globals[k] !== 'object') {
        memo[`process.env.${k}`] = expr(params.options.globals[k]);
      }
      return memo;
    }, {}),
    logLevel: (params.options.quiet && 'silent') || undefined,
    splitting: esnext || undefined,
    sourcemap: debug ? 'inline' : undefined,
    platform: platform || 'node',
    format: format || 'esm',
    stdin: {
      resolveDir: params.options.cwd || dirname(params.filepath),
      sourcefile: params.filepath,
      contents: params.source,
      loader: ext,
    },
    color: true,
    write: false,
    bundle: !_module || _bundle,
    plugins: [Mortero(params, external)],
  }).then(result => {
    const rewriteTasks = [];

    if (result.outputFiles.length > 1) {
      for (let i = 1; i < result.outputFiles.length; i += 1) {
        const { path, text } = result.outputFiles[i];

        if (params.options.write !== false) {
          rewriteTasks.push([path, rewrite(_module, { src: path, params, text })]);
        }
      }
    }

    return Promise.all(rewriteTasks.map(([path, deferred]) => deferred.then(_result => writeFile(path, _result))))
      .then(() => rewrite(_module, { src: params.filepath, text: result.outputFiles[0].text, params }))
      .then(_result => {
        params.source = _result;
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