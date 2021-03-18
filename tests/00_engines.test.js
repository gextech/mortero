const { expect } = require('chai');
const { test } = require('./helpers');

/* global describe */

describe('meta', () => {
  describe('EJS', () => {
    test(['x.ejs', '<%= 1 %>'], result => {
      expect(result.source).to.eql('1');
      expect(result.extension).to.eql('html');
    });

    test(['x.y.ejs', '<%= 1 %>'], result => {
      expect(result.source).to.eql('1');
      expect(result.extension).to.eql('y');
    });

    test(['x.js.ejs', 'console.log(<%= 1 %>)'], result => {
      expect(result.source).to.contain('console.log(1)');
      expect(result.extension).to.eql('js');
    });
  });

  describe('Liquid', () => {
    test(['x.liquid', '{% assign x = "y" %}{{x}}'], result => {
      expect(result.source).to.eql('y');
      expect(result.extension).to.eql('html');
    });
  });

  describe('Handlebars', () => {
    test(['x.hbs', '<x>{{x}}</x>'], result => {
      expect(result.source).to.contain('<x>y</x>');
      expect(result.extension).to.eql('html');
    }, {
      x: 'y',
    });

    test(['x.y.hbs', '<x>{{x}}</x>'], result => {
      expect(result.source).to.contain('<x>y</x>');
      expect(result.extension).to.eql('y');
    }, {
      x: 'y',
    });
  });
});

describe('markup', () => {
  describe('AsciiDoc', () => {
    if (process.env.CI === 'true') {
      test(['x.adoc', '= Hello world'], result => {
        expect(result.source).to.match(/<h1[<>]*?>Hello world<\/h1>/);
        expect(result.extension).to.eql('html');
      });
    }
  });

  describe('Markdown', () => {
    test(['x.md', '# ok'], result => {
      expect(result.source).to.contain('</h1>');
      expect(result.extension).to.eql('html');
    });

    test(['x.coffee.md', '> ok\n\n    foo bar'], result => {
      expect(result.source).to.contain('foo(bar)');
      expect(result.extension).to.eql('js');
    });

    test(['x.y.md', '# ok'], result => {
      expect(result.source).to.contain('</h1>');
      expect(result.extension).to.eql('y');
    });
  });

  describe('Pug/Jade', () => {
    test(['x.pug', 'x y'], result => {
      expect(result.source).to.contain('<x>y</x>');
      expect(result.extension).to.eql('html');
    });

    test(['x.y.pug', 'x y'], result => {
      expect(result.source).to.contain('<x>y</x>');
      expect(result.extension).to.eql('y');
    });
  });
});

describe('scripts', () => {
  describe('JSON', () => {
    const json_block = JSON.stringify({
      foo: 'bar',
    });

    test(['x.json', json_block], result => {
      expect(result.source).to.contain('var foo = "bar"');
      expect(result.source).to.contain('var x_default');
    });
  });

  describe('YAML', () => {
    test(['x.yaml', 'foo: bar'], result => {
      expect(result.source).to.eql('{"foo":"bar"}');
      expect(result.extension).to.eql('json');
    });
  });

  describe('Svelte', () => {
    test(['x.svelte', '<script>export let foo = null;</script>{{foo}}'], result => {
      expect(result.source).to.contain('SvelteComponent');
      expect(result.source).to.contain('foo: 0');
      expect(result.extension).to.eql('js');
    });
  });

  describe('TypeScript', () => {
    test(['x.ts', 'let foo = (x: string) => {}; console.log(foo)'], result => {
      expect(result.source).to.contain('var foo');
      expect(result.source).to.contain('(x)');
    });
  });

  describe('CoffeeScript', () => {
    test(['x.coffee', 'foo bar'], result => {
      expect(result.source).to.contain('foo(bar)');
      expect(result.extension).to.eql('js');
    });

    test(['x.js.coffee', 'foo bar'], result => {
      expect(result.source).to.contain('foo(bar)');
      expect(result.extension).to.eql('js');
    });

    test(['x.litcoffee', '> ok\n\n    foo bar'], result => {
      expect(result.source).to.contain('foo(bar)');
      expect(result.extension).to.eql('js');
    });

    test(['x.litcoffee.hbs', '    foo {{bar}}'], result => {
      expect(result.source.trim()).to.eql('foo(buzz);');
      expect(result.extension).to.eql('js');
    }, { bar: 'buzz' });

    test(['x.js.litcoffee', '    foo bar'], result => {
      expect(result.source).to.contain('foo(bar);');
      expect(result.extension).to.eql('js');
    });
  });
});

describe('styles', () => {
  describe('SASS', () => {
    test(['x.sass', '$x: red;\n*\n  color: $x'], result => {
      expect(result.source).to.contain('color: red');
    });
  });

  describe('LESS', () => {
    test([
      'x.less',
      '@x:y;&*{x:@x}',
      {
        less: {
          plugins: ['less-plugin-autoprefix'],
        },
      },
    ], result => {
      expect(result.source).to.contain('* {\n  x: y;\n}');
      expect(result.extension).to.eql('css');
    });

    test(['x.css.less', '&*{x:y}'], result => {
      expect(result.source).to.contain('x: y;');
      expect(result.extension).to.eql('css');
    });
  });

  describe('Styl', () => {
    test(['x.styl', '*{x:y}'], result => {
      expect(result.source).to.contain('x: y;');
      expect(result.extension).to.eql('css');
    });
  });

  describe('PostCSS', () => {
    test(['x.css', '.x{color:red}'], result => {
      expect(result.source).to.eql('.x{color:red}');
      expect(result.extension).to.eql('css');
    });

    test(['x.y.css', '.x{color:red}'], result => {
      expect(result.source).to.eql('.x{color:red}');
      expect(result.extension).to.eql('y');
    });

    test([
      'x.post.css',
      ':fullscreen a{display:flex}',
      {
        postcss: {
          plugins: ['autoprefixer'],
        },
      },
    ], result => {
      expect(result.source).to.contain('-webkit');
      expect(result.extension).to.eql('css');
    });
  });
});
