# RadioFoundry editor provenance

The browser-first codeplug workflow, separate editing model/transport, Problems
view and bounded undo/redo approach follow RadioFoundry at pinned commit
`75c46ea46d5ebf6406f5b4ce0bbe2443b7649f91`.

Directly adapted source:

- `vendor/undo.js`: RadioFoundry
  [`site/static/js/editor/undo.js`](https://github.com/RadioFoundry/RadioFoundry/blob/75c46ea46d5ebf6406f5b4ce0bbe2443b7649f91/site/static/js/editor/undo.js),
  adjusted for this editor's plain channels/VFO/global model. Original MIT notice
  retained; upstream license accompanies it in `vendor/LICENSE.RadioFoundry`.

Architectural references:

- [`site/static/js/editor/app.js`](https://github.com/RadioFoundry/RadioFoundry/blob/75c46ea46d5ebf6406f5b4ce0bbe2443b7649f91/site/static/js/editor/app.js)
- [`site/static/js/codeplug/model.js`](https://github.com/RadioFoundry/RadioFoundry/blob/75c46ea46d5ebf6406f5b4ce0bbe2443b7649f91/site/static/js/codeplug/model.js)
- [`docs/user/04-programming.md`](https://github.com/RadioFoundry/RadioFoundry/blob/75c46ea46d5ebf6406f5b4ce0bbe2443b7649f91/docs/user/04-programming.md)

The P25-aware record codec, versioned JSON envelope and logical ASCII CPS client
target this project's existing firmware API. They do not reuse RadioFoundry's
OpenGD77-compatible binary image layout or send its address-based CPS protocol.
No RadioFoundry service, branding identity or website deployment is implied.

The pinned upstream checkout remains untouched. The editor runs entirely from
this folder and requires no upstream installation or remote assets at runtime.
