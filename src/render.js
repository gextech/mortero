const parse = require('./parse');
const data = require('./data');

const {
  exists,
  dirname,
  resolve,
  relative,
  joinPath,
  readFile,
} = require('./common');

const {
  getEngines,
} = require('./support');

module.exports = function render(params, done) {
  const engines = getEngines();

  function push(engine, previous) {
    return new Promise((next, reject) => {
      params.next = previous;
      try {
        const _ctx = { render, parse, data };

        params.locals = params.locals || {};
        params.locals.self = params.locals.self || {};
        params.locals.self.cwd = params.locals.self.cwd || resolve('.');
        params.locals.self.parent = params.locals.self.parent || relative(params.filepath);
        params.locals.self.filepath = params.locals.self.filepath || relative(params.filepath);

        engine.call(_ctx, params, err => {
          if (err) reject(err);
          else next();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  params.locals = {
    ...params.options.globals,
    ...params.options.locals,
    ...params.locals,
    ...params.data,
  };

  const pipeline = params.parts.slice().reverse();
  const extensions = params.options.extensions || {};
  const knownExtensions = ['es', 'esm', 'cjs', 'umd', 'iife', 'test', 'spec', 'bundle'];

  // automatic-modes based on extensions
  params.parts.forEach(ext => {
    if (ext === 'bundle') params.data.$bundle = true;
    if (ext === 'es' || ext === 'esm') params.data.$format = 'esm';
    if (ext === 'umd' || ext === 'cjs' || ext === 'iife') params.data.$format = ext;
  });

  // clean out special locals
  delete params.locals.$modules;
  delete params.locals.$include;
  delete params.locals.$nofiles;
  delete params.locals.$render;
  delete params.locals.$unpkg;
  delete params.locals.$format;
  delete params.locals.$external;

  return pipeline
    .reduce((prev, cur, i) =>
      prev.then(() => {
        params.extension = cur;
        if (extensions[cur] !== false) {
          if (engines[cur]) {
            if (engines[cur][1]) {
              params.extension = engines[cur][1];
            }
            return push(engines[cur][0], pipeline[i + 1]);
          }
        }
      }), Promise.resolve())
    .then(() => {
      if (knownExtensions.includes(params.extension) || extensions[params.extension] === false) {
        params.extension = params.parts.join('.');
      }

      if (params.data.$render) {
        const _layout = params.data.$render.indexOf('~/') === 0
          ? params.data.$render.replace(/^~\//, `${resolve('.')}/`)
          : joinPath(params.options.cwd || dirname(params.filepath), params.data.$render);

        if (!exists(_layout)) {
          throw new ReferenceError(`File not found '${_layout}'`);
        }

        const _params = parse(_layout, readFile(_layout), params.options);

        _params.locals = { ..._params.locals, ...params.locals };
        _params.locals.yield = params.source;
        _params.locals.self = _params.locals.self || {};
        _params.locals.self.cwd = _params.locals.self.cwd || resolve('.');
        _params.locals.self.parent = _params.locals.self.parent || relative(params.filepath);
        _params.locals.self.filepath = _params.locals.self.filepath || relative(_params.filepath);

        delete params.data.$render;

        render(_params, (err, result) => {
          if (!err) {
            params.source = result.source;
            params.children.push(_layout);
            result.children.forEach(dep => {
              if (!params.children.includes(dep)) params.children.push(dep);
            });
          }

          done(err, params);
        });
      } else {
        done(undefined, params);
      }
    })
    .catch(error => done(error, params));
};
