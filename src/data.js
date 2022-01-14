const yaml = require('js-yaml');

const {
  dirname,
  resolve,
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

function parse(ctx, _load, files) {
  return value => {
    const inc = value.indexOf('~/') === 0
      ? value.replace(/^~\//, `${ctx.cwd}/`)
      : resolve(joinPath(dirname(ctx.src), value));

    let data;
    if (inc.indexOf('.yml') !== -1 || inc.indexOf('.yaml') !== -1) {
      data = new IncludedFile(true, _load({ ...ctx, src: inc }, readFile(inc)));
    } else if (inc.indexOf('.json')) {
      data = JSON.parse(readFile(inc));
    } else {
      data = readFile(inc);
    }

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
