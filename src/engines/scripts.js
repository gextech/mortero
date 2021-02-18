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

function svelte(params, next) {
  try {
    const Svelte = require('svelte/compiler');
    const { js, warnings } = Svelte.compile(params.source, { filename: params.filepath });
    const contents = `${js.code}//# sourceMappingURL=${js.map.toUrl()}`;

    if (warnings.length && params.options.verbose) {
      warnings.forEach(msg => {
        warn('\r{%yellow svelte%} %s\n', msg);
      });
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

module.exports = {
  yml: [yaml, 'json'],
  yaml: [yaml, 'json'],
  svelte: [svelte, 'js'],
  coffee: [coffeescript, 'js'],
  litcoffee: [coffeescript, 'js'],
};
