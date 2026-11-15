# Putting Pip's Notebook online

This edition is a **static site**: a folder of files (HTML, JavaScript, pictures, music, sample lessons) with no
server program behind it. The player's browser runs the whole game and calls the AI provider directly with the
player's own key. Any host that can serve files can host it, and you never put an API key anywhere.

## How the pieces fit

- **The site** is the `site/` folder that `npm run build` writes. It works at a domain's root
  (`https://example.com/`) or under a path (`https://you.github.io/teach-or-perish/`), because every link inside is
  relative.
- **A host** is the computer that hands those files to browsers: a web hosting plan, Cloudflare Pages or Netlify.
  The repository does not publish the site anywhere by itself.
- **A domain** (for example one bought at GoDaddy) is only a name. Its **DNS records**, edited where you bought it,
  point the name at the host. Changes take from a few minutes to a few hours to reach everyone.
- **HTTPS** is required in practice: browsers only allow the microphone (dictation) on secure pages. Cloudflare Pages and Netlify
  give free certificates; a hosting plan may need SSL switched on.

## Option 1: a web hosting plan (GoDaddy, cPanel and similar)

Plans that "can't run Node" are fine: nothing runs on the host.

1. On your computer, with Node.js 22 or later: `npm ci`, then `npm run build`.
2. Open the plan's **File Manager** (or connect with FTP) and upload **the contents** of `site/` (not the folder
   itself) into `public_html/`. Include the hidden `.nojekyll` file or not; it does not matter there.
3. Switch on SSL for the domain in the plan's settings, so the site opens with `https://`.

Repeat steps 1 and 2 after every change. If music does not play in Safari, check that the host sends `.m4a` files
as `audio/mp4`; most do.

## Option 2: Cloudflare Pages or Netlify (free, works with a private repository)

Connect the GitHub repository in their dashboard and use these build settings:

| Setting | Value |
|---|---|
| Production branch | `public` |
| Build command | `npm run build` |
| Output directory | `site` |
| Node.js version | 22 or later (an environment variable `NODE_VERSION` = `22` on both) |

They rebuild on every push. To use your domain, add it under the site's **Custom domains** and create the DNS
records they show you in GoDaddy (usually a `CNAME` for `www` and an `A` or "flattened" record for the root). With
Cloudflare you can instead move the domain's DNS to Cloudflare by changing the nameservers in GoDaddy.

## Checking a deployment

- Open the site, press **Play** and start a sample lesson: that works with no key.
- Reload the page in the middle of an expedition: **My archive** still has it.
- In **Settings**, choose a provider, paste a key and press **Test connection**.
- The browser's developer tools (**Network** tab) show requests only to your site and, with a key, to
  `api.openai.com` or `generativelanguage.googleapis.com`.

## What not to do

- Never put an API key in the repository, in `site/` or in the host's settings. Players paste their own in
  **Settings**, and it stays in their browser.
- Don't serve the site over plain `http://` on a public domain: dictation will not work, and the key would travel to
  the page unencrypted (it still goes to the provider over https).
