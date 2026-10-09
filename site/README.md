# perch.ws

The landing page: plain HTML, CSS and a little JavaScript, with no build step and no requests to
anything but its own files (no web fonts, analytics or trackers). English and Turkish; the
visitor's language is picked from the browser and can be switched.

```bash
python3 -m http.server 8000 --directory site   # then open http://localhost:8000
```

## Publishing (Cloudflare Pages)

Pages → Create → Connect to Git → this repository, then:

| Setting                | Value                  |
| ---------------------- | ---------------------- |
| Production branch      | `main`                 |
| Build command          | _(empty)_              |
| Build output directory | `site`                 |
| Build watch paths      | `site/*` (in Settings) |

Under Custom domains add `perch.ws` and `www.perch.ws`; Pages creates the DNS records.
`_headers` sets the security headers (a strict Content-Security-Policy among them).
