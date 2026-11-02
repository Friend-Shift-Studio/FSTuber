# Third-Party Notices

## Inter Variable

FSTuber bundles the Inter Variable WOFF2 font at `assets/fonts/InterVariable.woff2` so the interface follows `design.md` without requiring a remote font request. The matching license text is included as `assets/fonts/OFL.txt`.

The font files and stylesheet are distributed by the [official Inter project](https://github.com/rsms/inter/) at [rsms.me/inter](https://rsms.me/inter/). The WOFF2 file used by this project is `https://rsms.me/inter/font-files/InterVariable.woff2?v=4.1`. The font is licensed under the [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt). That license permits embedding and redistribution with software when its copyright notice and license are included; the font must not be sold by itself, and the reserved font name may not be used for modified versions.

Google Fonts also identifies Inter as a variable family; see the [Inter specimen](https://fonts.google.com/specimen/Inter).


## GIF.js 0.2.0

FSTuber bundles `gif.js` and its web worker locally in `assets/vendor/` so optional short GIF exports do not require a CDN. The library is Copyright (c) 2013–2018 Johan Nordberg and is distributed under the MIT License; the complete notice is included in `assets/vendor/gif-LICENSE.txt`.

The upstream project and browser-worker usage documentation are at [jnordberg/gif.js](https://github.com/jnordberg/gif.js/). The bundled package version is documented at [unpkg.com/gif.js@0.2.0/package.json](https://unpkg.com/gif.js@0.2.0/package.json).


## FFmpeg.wasm optional MP4 conversion

FFmpeg.wasm is not bundled. Only after the user selects MP4, the app requests `@ffmpeg/ffmpeg` version `0.12.10` from `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js` and `@ffmpeg/core` version `0.12.6` from `https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js` and the matching `.wasm` file. These components remain subject to their respective upstream license notices and the user's network/browser limits.

The pinned [@ffmpeg/ffmpeg 0.12.10 package metadata](https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/package.json) and [@ffmpeg/core 0.12.6 package metadata](https://unpkg.com/@ffmpeg/core@0.12.6/package.json) identify the package license as MIT. The upstream [ffmpeg.wasm licensing FAQ](https://ffmpegwasm.netlify.app/docs/faq/) distinguishes the MIT-licensed JavaScript wrapper from the WebAssembly core, which contains transpiled FFmpeg code and external libraries that follow their own upstream licenses. FFmpeg's [official legal page](https://ffmpeg.org/legal.html) explains that FFmpeg is generally LGPL 2.1 or later, while optional GPL components can make a build GPL; the exact applicable notices depend on the core build and included libraries.

FSTuber loads these version-pinned components on demand from their CDNs and does not bundle or modify the core binary. Consult the pinned package metadata and upstream license notices for the exact distribution being fetched.
