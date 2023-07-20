const fs = require('fs');
const { expect } = require('chai');
const { cli, fixture } = require('./helpers');

/* global beforeEach, describe, it */

const cache = `${__dirname}/fixtures/cache.json`;

describe('CLI', () => {
  beforeEach(() => {
    if (fs.existsSync(cache)) fs.rmSync(cache);
  });

  it('should validate given sources', cli('', '', ({ stderr }) => {
    expect(stderr).to.contain('Invalid source directory');
  }));

  it('should build given sources', cli('a', '.', ({ stdout, stderr }) => {
    expect(stderr).to.eql('');
    expect(stdout).to.match(/from.*\.\/a/);
    expect(stdout).to.contain('write build/a/lib/data.json');
    expect(stdout).to.contain('write build/a/lib/module.js');
    expect(stdout).to.contain('write build/a/main.js');
    expect(stdout).to.contain('write build/a/test/example.js');
    expect(stdout).to.contain('done in');
    expect(stdout.split('\n').length).to.eql(9);
  }));

  describe('options', () => {
    describe('--minify', () => {
      it('should compress javascript', cli('a -ymain.js --minify --no-debug', '.', ({ stdout, stderr }) => {
        expect(stderr).to.eql('');
        expect(stdout.split('\n').length).to.eql(5);
        expect(fixture('build/a/main.js', true).split('\n').length).to.eql(2);
      }));
    });

    describe('--filter', () => {
      it('should process matching files', cli('a --filter "!**/{lib,test}/**"', '.', ({ stdout, stderr }) => {
        expect(stderr).to.eql('');
        expect(stdout.split('\n').length).to.eql(6);
      }));
    });

    describe('--exclude', () => {
      it('should not process matching files', cli('a --exclude lib', '.', ({ stdout, stderr }) => {
        expect(stderr).to.eql('');
        expect(stdout.split('\n').length).to.eql(7);
      }));
    });

    describe('--ignore', () => {
      it('should omit from processing', cli('a --ignore "**.yml"', '.', ({ stdout, stderr }) => {
        expect(stderr).to.eql('');
        expect(stdout.split('\n').length).to.eql(8);
      }));
    });

    describe('--ignore-from', () => {
      it('should load ignores from given files', cli('a --ignore-from exclude.txt', '.', ({ stdout, stderr }) => {
        expect(stderr).to.eql('');
        expect(stdout.split('\n').length).to.eql(8);
      }));
    });
  });
});
