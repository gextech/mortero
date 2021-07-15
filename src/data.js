const yaml = require('js-yaml');

const {
  warn,
  dirname,
  resolve,
  relative,
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

    const text = readFile(inc);

    if (ctx.src.indexOf('.json') !== -1) {
      const data = new IncludedFile(true, JSON.parse(text));

      files.push(ctx.src);
      return data;
    }

    let data;
    if (inc.indexOf('.yml') !== -1 || inc.indexOf('.yaml') !== -1) {
      data = new IncludedFile(true, _load({ ...ctx, src: inc }, text, files));
    } else {
      data = new IncludedFile(false, readFile(inc));
    }

    files.push(inc);
    return data;
  };
}

function load(ctx, text, files) {
  try {
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
  } catch (e) {
    if (e.mark) {
      warn('\r{%error. %s: %s in %s%}\n%s\n', e.name, e.reason, relative(ctx.src), e.mark.snippet);
    } else {
      warn('\r{%error. %s in %s%}\n', e.message, relative(ctx.src));
    }
  }
}

module.exports = (cwd, src, text) => {
  const files = [];
  const data = load({ cwd, src }, text, files) || {};
  return {
    obj: data,
    src: files,
  };
};
