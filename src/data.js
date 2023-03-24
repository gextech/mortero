const yaml = require('js-yaml');

const {
  dirname,
  resolve,
  relative,
  basename,
  lsFiles,
  joinPath,
  readFile,
} = require('./common');

function IncludedFile(mixed, obj) {
  if (!mixed) {
    this.contents = obj;
  } else {
    Object.assign(this, obj);
  }
}

function entry(cwd, filepath) {
  const obj = {
    directory: dirname(filepath),
    filename: basename(filepath),
    relative: relative(filepath),
    basepath: relative(cwd),
    filepath,
  };

  let body;
  Object.defineProperty(obj, 'contents', {
    // eslint-disable-next-line no-return-assign
    get: () => body || (body = readFile(filepath)),
  });

  return obj;
}

function include(cwd, file, files, context, callback) {
  let data;
  if (file.indexOf('.yml') !== -1 || file.indexOf('.yaml') !== -1) {
    data = new IncludedFile(true, callback({ ...context, src: file }, readFile(file), files));
  } else if (file.includes('.json')) {
    data = JSON.parse(readFile(file));
  } else {
    data = entry(cwd, file);
  }
  return data;
}

function glob(cwd, value, files, context, callback) {
  return lsFiles(value, { cwd }).map(x => include(cwd, joinPath(cwd, x), files, context, callback));
}

function parse(ctx, _load, files) {
  return value => {
    const cwd = dirname(ctx.src);

    if (value.includes('*')) {
      const result = glob(cwd, value, files, ctx, _load);
      result.forEach(x => files.push(x.filepath));
      return result;
    }

    const inc = value.indexOf('~/') === 0
      ? value.replace(/^~\//, `${ctx.cwd}/`)
      : resolve(joinPath(cwd, value));

    const data = include(cwd, inc, files, ctx, _load);

    files.push(inc);
    return data;
  };
}

function load(ctx, text, files) {
  const construct = parse(ctx, load, files);

  return yaml.load(text, {
    filename: ctx.src,
    schema: yaml.JSON_SCHEMA.extend([
      new yaml.Type('!include', {
        construct,
        resolve(value) {
          return typeof value === 'string';
        },
        kind: 'scalar',
        instanceOf: IncludedFile,
      }),
    ]),
  });
}

module.exports = (cwd, src, text) => {
  const files = [];
  const data = (text && load({ cwd, src }, text, files)) || {};

  if (Object.prototype.toString.call(data) !== '[object Object]') {
    throw new TypeError(`Expecting object, given '${typeof data}'`);
  }

  return {
    obj: data,
    src: files,
  };
};
