/* eslint-disable no-unused-expressions  */

const fs = require('fs-extra');
const td = require('testdouble');
const { expect } = require('chai');
const Source = require('../src/source');
const { Mortero, test } = require('./helpers');

/* global beforeEach, afterEach, describe, it */

beforeEach(() => {
  td.replace(fs, 'outputFileSync', td.func('write'));
  td.replace(fs, 'copySync', td.func('copy'));
});
afterEach(() => {
  td.reset();
});

describe('destination', () => {
  it('should resolve the output file in a deterministic way', () => {
    const tpl = new Source('src/x.pug', { write: false, quiet: true }, '');

    expect(tpl.extension).to.eql('html');
    expect(tpl.directory).to.eql(`${process.cwd()}/build`);
    expect(tpl.destination).to.eql(`${process.cwd()}/build/src/x.html`);

    const tpl2 = new Source('src/x.pug', { write: false, quiet: true, rename: x => x.replace('/src/', '/') }, '');

    expect(tpl2.extension).to.eql('html');
    expect(tpl2.directory).to.eql(`${process.cwd()}/build`);
    expect(tpl2.destination).to.eql(`${process.cwd()}/build/x.html`);
  });
});

describe('conditionals', () => {
  test(['should discard code within IF/ENDIF marks', 'x.y', '<!--IF_NOT x-->y<!--ENDIF-->', {
    globals: { x: false },
  }], result => {
    expect(result.source).to.contain('y');
  });
});

describe('front-matter', () => {
  test(['should set any found front-matter as locals', 'x.ejs', `
    ---
    foo: bar
    ---
    <%= foo %>
  `], result => {
    expect(result.source).to.contain('bar');
  });
});

describe('extensions', () => {
  test(['should allow to remap custom extensions', 'x.foo', '{{foo}}', {
    extensions: { foo: 'hbs' },
  }], result => {
    expect(result.source).to.eql('bar');
    expect(result.extension).to.eql('html');
  }, { foo: 'bar' });

  test(['should stop if any extensions is false', 'x.foo.hbs', '{{foo}}', {
    extensions: { foo: false },
  }], result => {
    expect(result.source).to.eql('bar');
    expect(result.extension).to.eql('foo.hbs');
  }, { foo: 'bar' });
});

describe('esbuild', () => {
  // FIXME: modules, remote, and such...
  describe('platform', () => {
    test(['should apply options.platform as output', 'x.js', 'import "./a/test/example"', {
      platform: 'browser',
    }], result => {
      expect(result.source).to.contain('{osom: 42}');
    });

    test(['should set node as default options.platform', 'x.js', 'import "./a/test/example"'], result => {
      expect(result.source).to.contain('RE_EXPORT');
    });

    test(['should override options.platform if $platform is given', 'x.js', `
      /**
      ---
      $platform: browser
      ---
      */
      import "./a/test/example"
    `], result => {
      expect(result.source).to.contain('{osom: 42}');
    });
  });

  describe('external', () => {
    test(['should replace from options.external', 'x.js', 'import re from "rewrite-exports";console.log(re("export {}"))', {
      external: ['rewrite-exports'],
    }], result => {
      expect(result.source).to.contain("require('rewrite-exports')");
    });

    test(['should override options.external if $external is given', 'x.js', `
      /**
      ---
      $external: rewrite-exports
      ---
      */
      import re from "rewrite-exports";
      console.log(re("export {}"))
    `], result => {
      expect(result.source).to.contain("require('rewrite-exports')");
    });
  });

  describe('globals', () => {
    test(['should replace from options.globals', 'x.js', 'console.log(process.env.NODE_ENV)', {
      globals: { NODE_ENV: 'development' },
    }], result => {
      expect(result.source).to.contain('console.log("development")');
    });

    test(['should inline from /* global */ comments', 'x.js', '/* global test */console.log(test)', {
      globals: { test: '42' },
    }], result => {
      expect(result.source).to.contain('var test = 42');
      expect(result.source).to.contain('console.log(test)');
    });
  });

  describe('format', () => {
    test(['should apply options.format as output', 'x.js', 'console.log(42)', {
      format: 'iife',
    }], result => {
      expect(result.source).to.contain('(() => {');
      expect(result.source).to.contain('console.log(42)');
      expect(result.source).to.contain('})();');
    });

    test(['should override options.format if $format is given', 'x.js', '/**\n---\n$format: iife\n---\n*/console.log(42)'], result => {
      expect(result.source).to.contain('(() => {');
      expect(result.source).to.contain('console.log(42)');
      expect(result.source).to.contain('})();');
    });
  });

  describe('target', () => {
    test(['should apply options.target as output', 'x.js', 'let x = 42; console.log(x)', {
      target: 'es5',
      format: 'iife',
    }], result => {
      expect(result.failure.message).to.match(/Transforming let to the configured target environment.*is not supported yet/);
    });

    test(['should override options.target if $target is given', 'x.js', '/**\n---\n$target: es5\n---\n*/let x = 42; console.log(x)', {
      format: 'cjs',
    }], result => {
      expect(result.failure.message).to.match(/Transforming let to the configured target environment.*is not supported yet/);
    });
  });

  describe('debug', () => {
    test(['should apply options.debug as output', 'x.js', 'console.log(42)', {
      debug: true,
    }], result => {
      expect(result.source).to.contain('//# sourceMappingURL');
    });

    test(['should override options.debug if $debug is given', 'x.js', '/**\n---\n$debug: true\n---\n*/console.log(42)'], result => {
      expect(result.source).to.contain('//# sourceMappingURL');
    });
  });

  describe('cwd', () => {
    test(['should apply options.cwd as input', 'x.js', 'import "./fixtures/a/test/example"', {
      cwd: __dirname,
    }], result => {
      expect(result.source).to.contain('RE_EXPORT');
    });
  });
});

describe('modules', () => {
  if (process.env.CI) {
    test(['should install missing dependencies', 'x.js', 'import {render} from "somedom";console.log(render("x"))'], result => {
      expect(result.source).to.contain('childNodes');
    });
  }

  test(['should rewrite imports if options.modules is enabled', 'x.js', 'import {render} from "somedom";console.log(render("x"))', {
    modules: true,
  }], result => {
    expect(result.source).to.contain('/web_modules/somedom');
  });

  test(['should copy resolved modules into web_modules if enabled', 'x.js', `
    import { render } from "somedom";
    import { foo } from "./c/example";
    console.log(render("x"), foo);
  `, {
    modules: true,
    write: true,
  }], () => {
    expect(td.explain(fs.outputFileSync).callCount).to.eql(1);
    expect(td.explain(fs.copySync).callCount).to.eql(7);
  });

  test(['should override options.modules if $modules is given', 'x.js', `
    /**
    ---
    $modules: true
    ---
    */
    import {render} from "somedom";
    console.log(render("x"))
  `], result => {
    expect(result.source).to.contain('/web_modules/somedom');
  });

  test(['should use skypack if options.online or $online is also given', 'x.js', `
    /**
    ---
    $modules: true
    $online: true
    ---
    */
    import {render} from "somedom";
    console.log(render("x"))
  `], result => {
    expect(result.source).to.contain('skypack.dev/somedom');
  });
});

describe('aliases', () => {
  test(['should translate from given options.aliases', 'x.js', 'import x from "foo"; console.log(x)', {
    aliases: { foo: './dummy' },
  }], result => {
    expect(result.source).to.contain('{osom: 42}');
  });
});

describe('paths', () => {
  test(['should resolve modules from given options.paths', 'x.js', 'import x from "foo"; console.log(x)', {
    aliases: { foo: 'example' },
    paths: ['tests/fixtures/c'],
  }], result => {
    expect(result.source).to.contain('{foo, baz}');
  });
});

describe('render', () => {
  test(['should yield a template if $render is given', 'x.pug', `//-
  ---
  $render: b/layout.hbs
  ---
h1 It works!`], result => {
    expect(result.failure).to.be.undefined;
    expect(result.data).to.eql({});
    expect(result.source).to.contain('<main>');
    expect(result.source).to.contain('<h1>It works!');
    expect(result.children.length).to.eql(1);
    expect(result.children[0]).to.contain('layout.hbs');
  });
});

describe('markup', () => {
  test(['should process and embed resources on .html files', 'x.pug', `
script(src='b/main.js' inline)
link(rel='stylesheet' inline href='b/home.css')
  `], result => {
    expect(result.children.length).to.eql(2);
    expect(result.children[0]).to.contain('main.js');
    expect(result.children[1]).to.contain('home.css');
    expect(result.source).to.contain('console.log');
    expect(result.source).to.contain('color: red');
  });
});

describe('hooks', () => {
  let callback;
  let loader;
  beforeEach(() => {
    callback = td.func('handler');
    loader = Mortero.use({
      name: 'test',
      run: ({ filter, register }) => {
        filter(/\/foo\/(.+?)\.(x|y)$/, callback);
        filter(/\/bar\/(.+?)\.(a|b|c)$/, callback);

        register(['foo'], (params, next) => {
          params.source = `[${params.source}]`;
          next();
        }, 'bar');
      },
    });

    td.when(callback(td.matchers.isA(Array), td.matchers.isA(String), td.matchers.isA(Object)))
      .thenResolve(new Promise(ok => process.nextTick(ok)));
  });

  test(['should allow to set engines through plugins', 'x.foo', 'y'], result => {
    expect(result.source).to.eql('[y]');
    expect(result.extension).to.eql('bar');
  });

  it('should allow to process additional sources', async () => {
    await loader(['x/foo/bar.x'], '/tmp');
    await loader(['x/bar/baz/buzz.c'], '/tmp');

    expect(td.explain(callback).callCount).to.eql(2);
  });
});
