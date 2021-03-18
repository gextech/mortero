const Source = require('./source');

const {
  array,
  dirname,
} = require('./common');

const {
  load,
  plugins,
  getModule,
  getContext,
} = require('./support');

function wrap(file, opts, input) {
  return (data, cb = (e, out) => out) => {
    const ctx = getContext(opts);
    const tpl = new Source(file, opts, input);

    return tpl.compile(data, ctx).then(() => cb(undefined, tpl)).catch(e => cb(e, tpl));
  };
}

module.exports = {
  run: argv => require('./main')(argv),
  use: hooks => load(plugins(array(hooks))),
  load: (file, opts) => wrap(file, opts, null),
  parse: (file, code, opts) => wrap(file, opts || {}, code),
  resolve: (src, file, paths) => getModule(src, [dirname(file)].concat(array(paths))),
};
