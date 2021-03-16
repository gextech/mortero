const redent = require('redent');

const data = require('./data');

const {
  resolve,
  relative,
  basename,
} = require('./common');

const {
  globals,
  conditionals,
} = require('./support');

module.exports = (filepath, source, opts) => {
  if (source.charAt(0) === '\uFEFF') {
    source = source.slice(1);
  }

  const options = opts || {};
  const parts = basename(filepath, options.root).split('.');
  const delims = Array.isArray(options.delims) ? options.delims : [options.delims || '---'];

  const start = source.indexOf(`${delims[0]}\n`);
  const end = source.indexOf(`${delims[1] || delims[0]}\n`, start + delims[0].length);

  parts.shift();

  const exts = options.extensions || {};
  const slug = relative(filepath.replace(/\.[.\w]+$/, ''));
  const hasMkd = parts.some(x => /mk?d|litcoffee/.test(x));

  if (parts.length === 1 && exts[parts[0]]) {
    parts.unshift(exts[parts[0]]);
  }

  // replace globals and macros before parsing front-matter
  options.globals = options.globals || {};
  source = globals(conditionals(source, options.globals), options.globals);

  // extract front-matter
  const ls = source.substr(start - 1, 1);
  const rs = source.substr(end - 1, 1);

  let fm;
  let obj;
  if ((end > start && start >= 0) && (ls === ' ' || ls === '\n' || ls === '') && (rs === ' ' || rs === '\n' || rs === '')) {
    const slen = delims[0].length;
    const elen = (delims[1] || delims[0]).length;

    let error;
    try {
      const raw = source.substr(start + slen + 1, end - (start + elen + 1));

      fm = data(options.cwd || resolve('.'), filepath, redent(raw));

      // cleanup
      fm.clr = () => {
        // fill with blank lines to help source-maps tools
        if (!fm._fixed) {
          fm._fixed = `${source.substr(0, start)}${
            new Array(raw.split('\n').length + 1).join('\n')
          }${source.substr(end + elen)}`;
        }
        return fm._fixed;
      };

      // strip front-matter for non-markdown sources
      if (!hasMkd || options.frontMatter === false) {
        source = fm.clr();
      }

      obj = fm.obj;
    } catch (e) {
      error = e;
    }

    if (error) {
      error.message = error.reason;
      error.filepath = filepath;
      delete error.mark;
      throw error;
    }
  }

  if (hasMkd && obj && obj.$render) {
    source = fm.clr();
  }

  return {
    filepath,
    options,
    source,
    parts,
    slug,
    data: obj || {},
    children: fm ? fm.src : [],
  };
};
