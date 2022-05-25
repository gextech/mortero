const {
  keys,
  warn,
  readFile,
} = require('../common');

const {
  plugins,
} = require('../support');

function stylus(params, next) {
  const Stylus = require('stylus');
  const opts = { ...params.options.stylus };

  params.source = Stylus.render(params.source, {
    use: plugins(opts.plugins || [], opts),
    paths: opts.includePaths || [],
    globals: params.locals,
    imports: params.imports,
    compress: opts.compress || false,
    sourcemap: params.data.$debug || params.options.debug,
    filename: params.filepath,
  });
  next();
}

function sass(params, next) {
  const NodeSass = require('sass');
  const opts = { ...params.options.sass };

  NodeSass.render({
    outFile: params.filepath,
    file: params.filepath,
    data: params.source,
    indentedSyntax: params.filepath.indexOf('.sass') > -1,
    includePaths: opts.includePaths || [],
    outputStyle: opts.outputStyle || 'compressed',
    sourceMap: params.data.$debug || params.options.debug,
    sourceMapEmbed: true,
  }, (error, result) => {
    if (!error) {
      params.source = result.css.toString();
      params.sourceMap = result.map ? JSON.parse(result.map.toString()) : undefined;
      params.children = params.children.concat(result.stats.includedFiles);
    }
    next(error);
  });
}

function less(params, next) {
  const LESS = require('less');
  const opts = { ...params.options.less };

  opts.paths = opts.paths || [];
  opts.globalVars = { ...params.locals };

  keys(opts.globalVars).forEach(k => {
    if (typeof opts.globalVars[k] !== 'string') {
      delete opts.globalVars[k];
    } else if (/[^\s\w]/.test(opts.globalVars[k])) {
      opts.globalVars[k] = JSON.stringify(opts.globalVars[k]);
    }
  });

  const globals = keys(opts.globalVars).length;

  if (!globals) {
    delete opts.globalVars;
  }

  opts.sync = true;
  opts.syncImport = true;
  opts.filename = params.filepath;
  opts.plugins = plugins(opts.plugins || [], opts);
  opts.sourceMap = params.data.$debug || params.options.debug;

  LESS.render(params.source, opts, (err, _data) => {
    if (err) {
      err.line -= globals;
    } else {
      params.source = _data.css;
      params.sourceMap = _data.map ? JSON.parse(_data.map) : undefined;

      if (params.sourceMap) {
        params.sourceMap.sources = params.sourceMap.sources.filter(src => src.indexOf('<input') === -1);
      }
      params.children = params.children.concat(_data.imports);
    }
    next(err);
  });
}

function postcss(params, next) {
  const PostCSS = require('postcss');
  const opts = { ...params.options.postcss };

  opts['postcss-import'] = opts['postcss-import'] || {};
  opts['postcss-import'].load = readFile;
  opts['postcss-import'].onImport = files => {
    files.forEach(file => {
      if (file !== params.filepath && params.children.indexOf(file) === -1) {
        params.children.push(file);
      }
    });
  };

  opts.from = params.filepath;
  opts.to = params.filepath;

  PostCSS(plugins(opts.plugins || [], opts))
    .process(params.source, opts)
    .then(result => {
      if (params.options.verbose) {
        result.warnings().forEach(msg => {
          warn('\r{%yellow postcss%} %s: %s\n', msg.type, msg.dest);
        });
      }

      params.source = result.css;
      next();
    }).catch(next);
}

module.exports = {
  stylus: [stylus, 'css'],
  less: [less, 'css'],
  sass: [sass, 'css'],
  scss: [sass, 'css'],
  post: [postcss, 'css'],
  postcss: [postcss, 'css'],
};
