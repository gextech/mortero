const { dirname, joinPath } = require('../common');

const Source = require('../source');

// taken from coffee-script source
function fixLiterate(code) {
  let maybeCode = true;

  const lines = [];

  code.split('\n').forEach(line => {
    if (maybeCode && /^([ ]{4}|[ ]{0,3}\t)/.test(line)) {
      lines.push(line);
    } else {
      maybeCode = /^\s*$/.test(line);

      if (maybeCode) {
        lines.push(line);
      } else {
        lines.push(`# ${line}`);
      }
    }
  });

  return lines.join('\n');
}

function markdown(params, next) {
  if (params.next === 'coffee') {
    params.source = fixLiterate(params.source);
    next();
  } else {
    const kramed = require('kramed');
    const renderer = new kramed.Renderer();

    renderer.blockquote = quote => {
      if (quote.indexOf('<p>[!') === 0) {
        let type;
        const clean = quote.replace(/\[!([A-Z]+)\]/, (_, kind) => {
          type = kind.toLowerCase();
          return '';
        });

        return `<blockquote class="is-${type}">${clean.trim()}</blockquote>`;
      }
      return `<blockquote>${quote}</blockquote>`;
    };

    const opts = { ...params.options.kramed, renderer };
    const hi = typeof opts.highlight === 'string'
      ? opts.highlight
      : 'highlight.js';

    if (opts.highlight && typeof opts.highlight !== 'function') {
      opts.highlight = (code, lang, end) => {
        Source.highlight(code, lang, {
          ...opts,
          highlight: hi,
          filepath: params.filepath,
        }).then(result => end(null, result)).catch(end);
      };
    }

    kramed(params.source, opts, (err, content) => {
      const className = hi === 'highlight.js' ? 'hljs' : hi;

      if (!err) params.source = content.replace(/<pre>/g, `<pre class="${className}">`);
      next(err
        ? new Error(`Unable to run ${hi}: ${err.message || err.toString()}`)
        : null);
    });
  }
}

function pug(params, next) {
  const Pug = require('pug');
  const opts = { ...params.options.pug };

  opts.cache = false;
  opts.pretty = true;
  opts.filename = params.filepath;

  const tpl = Pug.compile(params.source, opts);

  function render() {
    params.source = tpl(params.locals);
    params.children = params.children.concat(tpl.dependencies);
    next();
  }

  if (params.data.$import) {
    const base = dirname(params.filepath);
    const mod = joinPath(base === '.' ? params.options.cwd : base, params.data.$import);

    import(mod).then(result => {
      Object.assign(params.locals, result);
      tpl.dependencies.push(mod);
      render();
    }).catch(next);
  } else {
    render();
  }
}

function asciidoc(params, next) {
  const AsciiDoc = require('@asciidoctor/core')();
  const opts = { showtitle: true, ...params.options.asciidoc };

  params.source = AsciiDoc.convert(params.source, { mkdirs: true, attributes: opts });
  next();
}

module.exports = {
  md: [markdown, 'html'],
  mkd: [markdown, 'html'],
  pug: [pug, 'html'],
  asc: [asciidoc, 'html'],
  adoc: [asciidoc, 'html'],
  asciidoc: [asciidoc, 'html'],
};
