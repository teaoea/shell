# SearchFilter structure fixtures

`engines.json` contains minimal, synthetic result cards. Titles, queries, target domains and redirect tokens are examples, not user traffic or copies of full search pages. They test result boundaries, URL extraction, engine selection and JavaScript-independent initial removal. The original Google fixtures continue to test their specific mobile and opaque-redirect structures.

The adapters were checked on 2026-10-08 against public HTML from DuckDuckGo HTML, Brave, Sogou desktop/mobile, 360 desktop/mobile and Shenma. Observed full pages remain outside the repository. Native counts from the `mozilla` observation, using `domain-suffix: mozilla.org`, were:

| Page | Recognized | Removed | Unresolved |
| --- | ---: | ---: | ---: |
| DuckDuckGo HTML | 10 | 4 | 0 |
| Brave | 17 | 4 | 0 |
| Sogou desktop | 10 | 5 | 4 |
| Sogou mobile | 9 | 3 | 1 |
| 360 desktop | 4 | 0 | 0 |
| 360 mobile | 9 | 0 | 0 |
| Shenma | 8 | 1 | 1 |

Zero removals do not establish the absence of matching results or device compatibility. Malformed, mixed or unknown containers remain intact.

For endpoints or layouts blocked by access restrictions, these primary implementation references informed selector facts; their code was not copied:

- [uBlacklist official adapter data](https://github.com/ublacklist/builtin/tree/dist/serpinfo): DuckDuckGo standard, Ecosia, Startpage, Yahoo Japan and Yandex.
- [SearXNG Yahoo adapter](https://github.com/searxng/searxng/blob/master/searx/engines/yahoo.py): `algo-sr` and `RU` redirect structure.
- [Startpage search URL documentation](https://support.startpage.com/hc/en-us/articles/4520913488148-Search-strings): GET `query` entry.
- [DuckDuckGo query syntax](https://duckduckgo.com/duckduckgo-help-pages/results/syntax): optional site exclusion.

Yahoo retrieval was rejected, Yandex and Startpage returned verification pages, and Ecosia returned HTTP 403. Qwant returned no web result markup and is not declared supported. No CAPTCHA was solved or restriction bypassed.

The Loon wrappers, request/response patterns, settings migration, native removal and privacy allowlists are tested by `node --test plugins/SearchFilter/tests/*.test.mjs`. A loopback browser replay of all 16 structure variants additionally checked dynamic removal, adjacent normal visibility and restoration after a destination changed. This is not physical Loon/iPhone validation.
