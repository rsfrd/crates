# Garage Crates

Your vinyl collection and want list, searchable from your phone in a record store.

- Search by artist, album, song, genre, or player. Searching a musician lists every record they're on, whether it's their album or they're a sideman, with their instrument.
- Want list: tap **Add want**, type the artist and album, done. Want-list records show up in regular search with a dashed outline and a hollow record icon, so you can tell at a glance you don't own them yet.
- Mark records **For sale** and filter to just those.
- **Pick for me**: the shuffle button beside **Add** picks a random record from your collection, optionally from one crate and/or genre, and avoids repeating recent picks.
- **Crates**: your own groupings, like "Japanese" or "Late night", separate from genres. Tap the select button at the top, tick records (or **Select all** after a search), and choose **Add to crate**. Filter by crate from the menu beside the genres; rename or delete crates in the Collection screen.
- Add records to your collection or want list with just an artist and title; the cover, year, label, tracks and personnel are looked up for you.
- Covers, track listings and personnel come from Discogs. For a release that isn't on Discogs, paste its Bandcamp link (in **Fix match**, or under **More details** when adding). The app reads just that one page for the title, artist, year, label, cover and tracks, picks out players from the credits where it can, and keeps the full credits text in the record's notes. If a cover is wrong (or a photo of the CD), open the record and tap **Find a better image** to choose from Apple Music, the Cover Art Archive and other vinyl pressings on Discogs, or use your own photo or an image link.
- Works with a weak signal: the app opens with the last copy saved on your phone, and want-list adds made offline sync when you're back online.

Hosting is free: **Supabase** holds the data, **Netlify** hosts the site, **Discogs** supplies album details. Setup takes about 20 minutes, then fetching details for all ~700 records takes about 40 minutes in the background.

---

## 1. Get a Discogs token

1. Sign in at discogs.com (a free account is fine).
2. Go to **Settings → Developers** and click **Generate new token**.
3. Copy the token somewhere for step 4.

## 2. Set up Supabase

1. Create a free account at supabase.com and click **New project**. Pick any name and a strong database password (you won't need it again).
2. When the project is ready, open **SQL Editor → New query**. Paste the contents of `supabase/schema.sql` and click **Run**.
3. New query again. Paste `supabase/seed.sql` (your 713 records) and **Run**.
4. New query again. Paste `supabase/002_covers.sql` (lets you upload your own covers) and **Run**. Do the same with `supabase/004_crates.sql` (crates).
5. Create your login: **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
6. Lock it down: **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up", and save. Now only your account can ever see or change the data.
7. Open **Project Settings → API** (sometimes labeled **Data API** / **API Keys**) and copy:
   - the **Project URL** (looks like `https://abcd1234.supabase.co`)
   - the **anon / publishable** key (the long public one, *not* the service-role secret)

## 3. Put the code on GitHub

1. Create a free account at github.com if you don't have one, then **New repository**. Make it **Private**.
2. On the empty repo page, click **uploading an existing file**, drag in everything inside this folder (`public`, `netlify`, `supabase`, `netlify.toml`, and the rest), and click **Commit changes**.

## 4. Deploy on Netlify

1. Create a free account at netlify.com and choose **Add new site → Import an existing project → GitHub**, then pick your repo.
2. Leave the build settings as they are (the `netlify.toml` file handles it; there's no build command).
3. Before deploying, open **Environment variables** (or go to **Site configuration → Environment variables** afterwards) and add:

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL from step 2 |
   | `SUPABASE_ANON_KEY` | your anon / publishable key |
   | `DISCOGS_TOKEN` | your token from step 1 |

4. Deploy. If you added the variables after the first deploy, go to **Deploys → Trigger deploy** so they take effect.
5. Optional: under **Domain management**, rename the site to something like `my-crate.netlify.app`.

## 5. Fetch covers, tracks and personnel

1. Open your site and sign in.
2. Tap the record icon in the top right (**Collection**) and press **Fetch details**.
3. Discogs allows about 60 lookups a minute, so this takes roughly 40 minutes. Leave that screen open (on a laptop is easiest). You can stop and pick up later; it only fetches what's left.
4. When it's done, check **Needs a look**. Those are records where the best match might be the wrong album or pressing, or where nothing matched. Open one, tap **Fix match**, and either pick from the search results or paste the record's Discogs page link.

Records you add later get their details fetched automatically the moment you add them.

## 6. Put it on your phone

Open the site in Safari (iPhone) or Chrome (Android) and choose **Add to Home Screen**. (If you added it before the rename, delete the old icon and add it again to get the new name.) It opens full-screen like an app and stays signed in.

---

## Good to know

- **Personnel quality** follows Discogs. Classic jazz releases usually have full credits with instruments; some rock and newer releases only list the band name. The names from your original spreadsheet are kept as a fallback, so those players are searchable even before details are fetched.
- **Credits are per pressing.** If a match picked a reissue with thin credits, use **Fix match** to choose the original release.
- **Supabase pauses idle free projects** after about a week. The site includes a small daily ping (`netlify/functions/keepalive.mjs`) to prevent that. If it ever does pause, the app still opens with the copy saved on your phone; restore the project from the Supabase dashboard.
- **Backups:** Collection → **Download a copy (CSV)**.
- **Your own covers** are stored in a Supabase Storage folder called `covers`. A cover you choose yourself is kept even when you refresh a record's details or fix its match.
- **Preview without setup:** opening the site before the environment variables are set (or adding `?demo` to the address) runs a demo with your collection that saves only in that browser.

## What's in here

```
public/                 the website (plain HTML, CSS, JS; no build step)
  js/app.js             screens and interactions
  js/search.js          search across albums, songs and people
  js/store.js           Supabase connection, offline copy, offline want-list queue
  demo.json             your collection, for demo mode
netlify/functions/      small server functions
  discogs.mjs           Discogs lookups and cover image search (keeps your token off the public page)
  image.mjs             downloads an image from a pasted link so the app can keep its own copy
  bandcamp.mjs          reads one Bandcamp album page you paste a link to
  config.mjs            hands the site its Supabase settings
  keepalive.mjs         daily ping so Supabase doesn't pause
netlify/lib/            Discogs matching and credit parsing, cover image search, sign-in check
supabase/schema.sql     database table and access rules
supabase/seed.sql       your 713 records
supabase/002_covers.sql cover uploads (storage folder + "keep my cover" flag)
supabase/003_fix_split_titles.sql one-time repair for 12 titles cut at a comma
supabase/004_crates.sql crates
data/collection.json    your spreadsheet, cleaned up
scripts/                how the spreadsheet was cleaned and turned into seed.sql
tests/                  `node --test tests/discogs.test.mjs tests/images.test.mjs tests/bandcamp.test.mjs` (browser walkthroughs: `tests/browser*.mjs`)
```

The original spreadsheet had about 145 rows that split in the wrong places (titles with commas such as *Parsley, Sage, Rosemary and Thyme*, and a missing column on ~115 rows). Those were repaired in `scripts/clean.py`; a few genre cells that held an artist name instead were cleared.
