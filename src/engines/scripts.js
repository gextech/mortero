const data = require('../data');

const {
  warn,
  resolve,
} = require('../common');

function coffeescript(params, next) {
  const CoffeeScript = require('coffeescript');
  const opts = { ...params.options.coffee };

  opts.sourceMap = params.data.$debug || params.options.debug;
  opts.literate = params.filepath.indexOf('.litcoffee') > -1;
  opts.filename = params.filepath;
  opts.bare = true;

  const _data = CoffeeScript.compile(params.source, opts);

  params.source = _data.js || _data;
  params.sourceMap = _data.v3SourceMap ? JSON.parse(_data.v3SourceMap) : undefined;
  next();
}

async function svelte(params, next) {
  try {
    const opts = { ...params.options.svelte };
    const allowed = opts.warnings || ['module-script-reactive-declaration'];

    let preprocess = [];
    if (params._local && opts.preprocess) {
      preprocess = [{
        async style({ content, filename, attributes }) {
          const render = require('./styles')[attributes.lang];

          if (render) {
            const chunk = {
              ...params,
              parts: [render[1]],
              source: content,
              filepath: filename,
              extension: render[1],
            };

            await new Promise(_resolve => {
              render[0](chunk, _resolve);
            });
            return { code: chunk.source };
          }
          return { code: content };
        },
        async script({ content, filename, attributes }) {
          if (!(
            typeof attributes.lang === 'string'
            && (/typescript|ts/).test(attributes.lang)
          )) return { code: content };

          const esbuild = require('esbuild');
          const result = await esbuild.transform(content, {
            loader: 'ts',
            target: 'esnext',
            sourcefile: filename,
            tsconfigRaw: {
              compilerOptions: {
                importsNotUsedAsValues: 'preserve',
              },
            },
          });

          return { code: result.code };
        },
      }];
    }

    const Svelte = require('svelte/compiler');

    if (preprocess.length > 0) {
      const processed = await Svelte.preprocess(params.source, preprocess, {
        filename: params.filepath,
      });

      params.source = processed.code;
      if (processed.map) params.sourceMap = processed.map;
    }

    const { js, css, warnings } = Svelte.compile(params.source, {
      css: opts.css || 'injected',
      generate: opts.generate || 'dom',
      hydratable: opts.hydratable || false,
      filename: params.filepath,
      sourcemap: params.sourceMap,
    });

    const contents = `${js.code}//# sourceMappingURL=${js.map.toUrl()}`;

    if (warnings.length && params.options.verbose) {
      warnings.forEach(msg => {
        if (!allowed.includes(msg.code)) {
          warn('\r{%yellow svelte%} %s\n', msg);
        }
      });
    }

    if (css && css.code && !contents.includes(css.code)) {
      params.resources = params.resources || [];
      params.resources.push(['css', css.code]);
    }
    params.source = contents;
    next();
  } catch (e) {
    next(e);
  }
}

function yaml(params, next) {
  const out = data(resolve('.'), params.filepath, params.source);

  out.src.forEach(x => {
    params.children.push(x);
  });

  params.source = JSON.stringify(out.obj);
  next();
}

function json(params, next) {
  params.source = `export default ${JSON.stringify(params.source)}`;
  next();
}

module.exports = {
  json: [json, 'js'],
  yml: [yaml, 'json'],
  yaml: [yaml, 'json'],
  svelte: [svelte, 'js'],
  coffee: [coffeescript, 'js'],
  litcoffee: [coffeescript, 'js'],
};
