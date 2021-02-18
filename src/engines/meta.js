const {
  resolve,
} = require('../common');

function ejs(params, next) {
  const EJS = require('ejs');

  params.source = EJS.render(params.source, params.locals, {
    filename: params.filepath,
  });
  next();
}

function liquid(params, next) {
  const Liquid = require('liquid');
  const opts = { ...params.options.liquid };
  const engine = new Liquid.Engine();

  try {
    if (opts.filters) {
      if (typeof opts.filters === 'string') {
        try {
          opts.filters = require(opts.filters);
        } catch (e) {
          opts.filters = require(resolve(opts.filters));
        }
      }
      engine.registerFilters(opts.filters);
    }

    engine
      .parseAndRender(params.source, params.locals)
      .then(result => {
        params.source = result;
        next();
      })
      .catch(next);
  } catch (e) {
    next(e);
  }
}

function handlebars(params, next) {
  const Handlebars = require('handlebars');
  const tpl = Handlebars.compile(params.source, { ...params.options.handlebars });

  params.source = tpl(params.locals);
  next();
}

module.exports = {
  ejs: [ejs, 'html'],
  liquid: [liquid, 'html'],
  hbs: [handlebars, 'html'],
};
