<img src="https://github.com/pateketrueke/mortero/raw/master/mortero.png" alt="Mortero" width="210">

[![Build status](https://github.com/pateketrueke/mortero/actions/workflows/testing.yml/badge.svg)](https://github.com/pateketrueke/mortero/actions/workflows/testing.yml)
[![NPM version](https://badge.fury.io/js/mortero.svg)](http://badge.fury.io/js/mortero)

> 🛠 Work in progress...

## CLI

Available options:

```
    -C, --cwd           Sets the current working directory for EXEC calls
    -D, --dest          Sets the target destination for written files,
                        default is ./build
    -o, --show          Sets the limit for displaying files on build,
                        default is 3
    -y, --only          Used to filter out non-matching sources,
                        e.g. `-ymain` or `--only app`, etc.

    -e, --ext           Enforce preprocessing through virtual extensions,
                        i.e. `-ecss.less` render .css files with LESS.js
    -c, --copy          Copy from given sources to the target destination,
                        use the format `SRC:DEST` e.g. `-cpublic:.`
    -w, --watch         Enable file-watching through chokidar,
                        also appends directories to watch
    -B, --bundle        Enforce bundling on matching sources,
                        e.g. `-B "**/{app,main}"`
    -r, --rename        Configure the renaming rules,
                        i.e. `-r "**/app/**:{filepath/1}"` will
                        strip the first directory segment from its filepath
    -T, --timeout       Sets the timeout for compiling between changes,
                        default is 100
    -L, --plugins       Enable additional support through plugins,
                        e.g. `-L./your-plugin`

    -F, --filter        Files matching these rules are indexed and processed,
                        default is **
    -i, --ignore        Files matching ignore rules are discarded from above,
                        default is !**
    -I, --ignore-from   Extract and set ignore rules from any given files,
                        e.g. `-I.gitignore`
    -G, --ignore-serve  Excludes additional sources from live-server reload,
                        e.g. `-Gmain-iife.js`
    -X, --exclude       Files matching exclude rules are not processed,
                        e.g. `-X "{lib,shared,components}"`

    -M, --modules       Enable web_modules and sets the destination folder,
                        also on this mode all bundling gets disabled
    -n, --online        Enable module resolution from skypack.dev CDN
    -H, --paths         Configure additional folders to lookup imports,
                        e.g. `-Hweb_components,vendor`

    -a, --alias         Configure esbuild aliases, e.g. `-afoo:./bar`
    -N, --external      Configure esbuild externals, e.g. `-Nlodash`
        --platform      Configure esbuild platform, default is node
        --format        Configure esbuild format, default is esm
        --target        Configure esbuild target,
                        set to node10.23 when format is not esm

    -b, --base          Sets the location for embedding resources,
                        default is http://localhost:PORT
    -p, --port          Sets the port used for the live-server,
                        default is PORT or 8080
    -P, --proxy         Enable one or more proxies on live-server,
                        i.e. `-P/api:3001/api/v1/` will proxy all calls
                        from /api to http://0.0.0.0:3001/api/v1 and
                        `-P/api:3001` to http://0.0.0.0:3001/api, etc.
    -s, --serve         Additional directories to serve, e.g. `-spublic`
    -k, --index         Outputs TOML configuration for Stork Search usage

    -f, --force         Skip cache rules to build everything from scratch
    -q, --quiet         Disable most logging messages
    -d, --debug         Enable source-maps
    -V, --verbose       Enable additional logs

    -S, --no-serve      Disable live-server on --watch
    -W, --no-write      Disable writing files to disk
    -E, --no-embed      Disable resource inlining on .html files
    -A, --no-install    Disable automatic installs during development
    -K, --no-process    Disable post-processing of all given sources
    -O, --no-progress   Disable extended logging from compilations
```
