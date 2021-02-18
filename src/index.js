const Source = require('./source');

const {
  array,
  resolve,
  dirname,
} = require('./common');

const {
  load,
  plugins,
  getModule,
} = require('./support');

function wrap(file, opts, input) {
  const dest = resolve(opts.dest, './build');
  const tpl = new Source(file, opts, input);

  return {
    render(data, cb) {
      return tpl.compile(dest, data).then(() => {
        cb(undefined, tpl);
      }).catch(e => {
        cb(e, tpl);
      });
    },
  };
}

module.exports = {
  run: argv => require('./main')(argv),
  use: hooks => load(plugins(array(hooks))),
  load: (file, opts) => wrap(file, opts, null),
  parse: (file, code, opts) => wrap(file, opts || {}, code),
  resolve: (src, file, paths) => getModule(src, [dirname(file)].concat(array(paths))),
};
