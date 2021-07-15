const parse = require('./parse');
const data = require('./data');

const {
  exists,
  dirname,
  resolve,
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
        engine.call({ render, parse, data }, params, err => {
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
  delete params.locals.$external;
  delete params.locals.$platform;
  delete params.locals.$inject;
  delete params.locals.$bundle;
  delete params.locals.$format;
  delete params.locals.$target;
  delete params.locals.$debug;
  delete params.locals.$render;
  delete params.locals.$modules;
  delete params.locals.$remote;
  delete params.locals.$footer;
  delete params.locals.$name;

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
