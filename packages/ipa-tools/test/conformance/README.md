# IPA conformance test support

These browser-compatible modules are test helpers, not package exports or
methods on `window.inference`. Their fixtures are synthetic and do not certify
a live provider, browser transport, or model's accuracy.

- [`speech.mjs`](./speech.mjs) checks transcription and encoded MP3 streams;
  [`fixtures/`](./fixtures/README.md) describes the media fixtures.
- [`decisions.mjs`](./decisions.mjs) checks a successful decision stream against
  a known-valid request, including ids, primitive types, refusals, probability
  distributions, choice maxima, score values/legends, and camelCase token usage.
  [`decisions-request.json`](./decisions-request.json) and
  [`decisions-done.json`](./decisions-done.json) provide a three-primitive example.

To check an implementation from a secure browser page, serve this directory
from the page's origin and import the helper as a native ES module:

```js
const { assertDecisionStream } = await import("/conformance/decisions.mjs");
const request = await fetch("/conformance/decisions-request.json").then((r) => r.json());
if (!window.inference?.getFeatures?.().methods?.decide) {
  throw new Error("Typed decisions are not advertised by this injector.");
}
const done = await assertDecisionStream(request, window.inference.request(request));
console.log(done.model, done.answers, done.usage);
```

Passing this helper verifies a successful response's shape and consistency.
An implementation test suite must also exercise request validation and limits,
snapshot isolation during approval, separate origin/method grants, denial,
unavailable routes, malformed provider responses (`provider_error`, no `done`),
and cancellation during approval and provider work. No provider I/O may happen
before permission resolves; abort and iterator closure must cancel unfinished
work. The helper propagates stream errors rather than accepting them as success.
