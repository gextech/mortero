const { remove } = require('fs-extra');
const { expect } = require('chai');
const { cli } = require('./helpers');

/* global beforeEach, describe, it */

describe('CLI', () => {
  beforeEach(() => {
    remove(`${__dirname}/fixtures/cache.json`);
  });

  it('should validate given sources', cli('', '', ({ stderr }) => {
    expect(stderr).to.contain('Invalid source directory');
  }));

  it('should build given sources', cli('a', '.', ({ stdout, stderr }) => {
    expect(stderr).to.eql('');
    expect(stdout).to.match(/from.*\.\/a/);
    expect(stdout).to.contain('write build/lib/data.json');
    expect(stdout).to.contain('write build/lib/module.js');
    expect(stdout).to.contain('write build/main.js');
    expect(stdout).to.contain('write build/test/example.js');
    expect(stdout).to.contain('done in');
    expect(stdout.split('\n').length).to.eql(8);
  }));

  describe('options', () => {
    describe('--filter', () => {
      it('should process matching files', cli('a --filter "!**/{lib,test}/**"', '.', ({ stdout, stderr }) => {
        expect(stderr).to.eql('');
        expect(stdout.split('\n').length).to.eql(5);
      }));
    });

    describe('--exclude', () => {
      it('should not process matching files', cli('a --exclude lib', '.', ({ stdout, stderr }) => {
        expect(stderr).to.eql('');
        expect(stdout.split('\n').length).to.eql(6);
      }));
    });

    describe('--ignore', () => {
      it('should omit from processing', cli('a --ignore "**.yml"', '.', ({ stdout, stderr }) => {
        expect(stderr).to.eql('');
        expect(stdout.split('\n').length).to.eql(7);
      }));
    });

    describe('--ignore-from', () => {
      it('should load ignores from given files', cli('a --ignore-from exclude.txt', '.', ({ stdout, stderr }) => {
        expect(stderr).to.eql('');
        expect(stdout.split('\n').length).to.eql(7);
      }));
    });
  });
});
