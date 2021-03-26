const RE_PRE_CODE = /<pre>(\s*<code[^<>]*>)/g;

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
    const opts = { ...params.options.kramed };
    const hi = typeof opts.highlight === 'string'
      ? opts.highlight
      : 'highlight.js';

    let className = '';
    if (opts.highlight && typeof opts.highlight !== 'function') {
      opts.highlight = (code, lang, end) => {
        try {
          switch (hi) {
            case 'pygmentize-bundled':
              require(hi)({ lang, format: 'html' }, code, (err, result) => {
                end(err, result.toString());
              });
              break;

            case 'rainbow-code':
              end(null, require(hi).colorSync(code, lang));
              break;

            case 'highlight.js':
              className = 'hljs';
              end(null, !lang
                ? require(hi).highlightAuto(code).value
                : require(hi).highlight(code, { language: lang }).value);
              break;

            case 'shiki':
              require(hi).getHighlighter({
                ...params.options.shiki,
              }).then(highlighter => {
                end(null, highlighter.codeToHtml(code, lang));
              });
              break;

            default:
              end(new Error(`Unsupported highlighter: ${hi}`));
          }
        } catch (e) {
          end(e);
        }
      };
    }

    kramed(params.source, opts, (err, content) => {
      if (!err) {
        if (className) {
          params.source = content.replace(RE_PRE_CODE, `<pre class="${className}">$1`);
        } else {
          params.source = content;
        }
      }

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

  params.source = tpl(params.locals);
  params.children = params.children.concat(tpl.dependencies);
  next();
}

function asciidoc(params, next) {
  const AsciiDoc = require('asciidoctor.js')();
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
