let Talavera;
try {
  Talavera = require('talavera');
} catch (e) {
  // ignore
}

module.exports = !Talavera ? [] : [{
  name: 'talavera',
  run: ({
    cwd, dest, flags, setup, filter,
  }) => {
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
