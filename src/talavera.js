module.exports = [{
  name: 'talavera',
  run: ({
    cwd, dest, flags, setup, filter,
  }) => {
    const Talavera = require('talavera');
    const talavera = Talavera({
      cwd,
      dest,
      src: flags.root,
      rename: flags.rename,
      folders: ['sprites', 'images'],
    });

    setup(talavera.hooks);

    filter(/\/sprites\/(.+?)\.(png|svg)$/, talavera.sprites);
    filter(/\/images\/(.+?)\.(gif|png|svg|jpg|jpeg)$/, talavera.images);
  },
}];
