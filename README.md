# Garage Crates

Your vinyl collection and want list, searchable from your phone in a record store. Set up your own copy in about 20 minutes, on free accounts.

- **Search everything**: artist, album, song, genre, crate, or player. Searching a musician lists every record they're on, whether it's their album or they're a sideman, with their instrument. Classical records show each piece above its movements, with its composer.
- **Want list**: tap **Add**, type an artist and album, done. Wanted records show in search with a dashed outline, so you can tell at a glance you don't own them yet. Each one shows the lowest price for its pressing on the Discogs marketplace, with links to that pressing's US sellers or all sellers, and to every other vinyl pressing of the album.
- **Import your records** from your Discogs collection (exact pressings, nothing to match) or from any spreadsheet saved as CSV.
- **Covers, tracks and personnel** come from Discogs, always the vinyl pressing. For a release that isn't on Discogs, paste its Bandcamp link. If a cover is wrong, **Find a better image** offers alternatives, or use your own photo.
- **Crates**: your own groupings, like "Japanese" or "Late night". **Pick for me** chooses something to play, from everything or one crate or genre.
- **Filed like a record shop**: people by surname (Frank Zappa under Z), bands by name ignoring "The". **File under** fixes the odd exception.
- **For sale**: mark records and filter to just those.
- **Share it with a passphrase**: friends can browse everything; only you can change anything.
- **Works with a weak signal**: the app opens with the copy saved on your phone, and want-list adds made offline sync later.

Hosting is free: **Supabase** holds the data, **Netlify** hosts the site, **Discogs** supplies album details.

Want to look first? Open your site with `?demo` on the end of the address (or run it before setting anything up) to try it with a small sample collection that's saved only in your browser.

---

## Set up your own

You'll need free accounts at [GitHub](https://github.com), [Netlify](https://netlify.com), [Supabase](https://supabase.com) and [Discogs](https://discogs.com).

### 1. Get a Discogs token

On discogs.com, go to **Settings → Developers** and click **Generate new token**. Keep it for step 3.

### 2. Set up Supabase

1. Click **New project**. Pick any name and a strong database password (you won't need it again).
2. When it's ready, open **SQL Editor → New query**, paste the whole of [`supabase/setup.sql`](supabase/setup.sql), and click **Run**.
3. **Create your own login first**: **Authentication → Users → Add user → Create new user**, with your email and a password, and tick **Auto Confirm User**. The first account on the project is the owner, the only one who can change anything.
4. **Lock it down**: **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up", and save.
5. Open **Project Settings → API** (sometimes **Data API** / **API Keys**) and copy the **Project URL** and the **anon / publishable** key (the long public one, *not* the service role secret).

### 3. Deploy on Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/rsfrd/crates)

The button copies this project into your GitHub and creates your Netlify site. It asks for three settings:

| Setting | Value |
|---|---|
| `SUPABASE_URL` | your Project URL from step 2 |
| `SUPABASE_ANON_KEY` | your anon / publishable key from step 2 |
| `DISCOGS_TOKEN` | your token from step 1 |

When it finishes, open the site and sign in. Optional: under **Domain management**, rename it to something like `my-records.netlify.app`.

### 4. Bring in your records

Your new site invites you to import:

- **From Discogs**: type your Discogs username. Your collection (or want list) comes in as the exact pressings you've catalogued. Leave **Vinyl only** ticked to skip CDs and tapes.
- **From a spreadsheet**: export it as CSV (comma, tab or semicolon separated all work). The app matches the columns from your headings (artist, album, year, label, catalogue number, genre, notes, players), shows a preview, and leaves out duplicates.

Then open **Collection** (the record icon, top right) and, under **Album details**, tap **Fetch** for covers, track lists and personnel. Discogs allows about 60 lookups a minute, so 700 records take about 45 minutes. Keep the screen open; you can stop and carry on later. Records imported from a spreadsheet are matched by name. Anything uncertain lands under **Needs a look**, where **Fix match** lets you pick the right pressing or paste its Discogs link. For a record that isn't on Discogs or Bandcamp at all, fill in what you know with **Edit details**, then tap **It's fine as it is** so it stops asking.

### 5. Put it on your phone

Open the site in Safari (iPhone) or Chrome (Android) and choose **Add to Home Screen**. It opens full screen like an app and stays signed in.

---

## Sharing with a passphrase

Friends can browse your whole collection, notes included, with a passphrase. Every control stays visible but greyed out, and the database refuses guest changes. Guests also can't use your Discogs lookups.

1. In Supabase, **Authentication → Users → Add user → Create new user**: any email you like (say `guests@yourname.com`; it never receives mail), with the **passphrase as its password**, and tick **Auto Confirm User**. A few random words make a good passphrase.
2. In **SQL Editor**, run (with that email):
   ```sql
   update site_settings set value = 'guests@yourname.com' where key = 'guest_email';
   ```
3. Reload the site. The sign-in screen now asks for the passphrase first, with **Owner sign in** below it for you.

To change the passphrase and lock everyone out, delete the guest user in Supabase and create it again with a new password (same email). Deleting it also signs out anyone already in.

To rename the site, run `update site_settings set value = 'Your Name Here' where key = 'site_name';`.

---

## Updating a site set up before setup.sql existed

If your site was set up with the older numbered files, run [`supabase/updates/007_owner_and_guests.sql`](supabase/updates/007_owner_and_guests.sql) once in the SQL Editor. It makes your account (the first one on the project) the owner, keeps everything else readable to signed-in accounts, and adds the settings for a guest passphrase. The site keeps working either way; until it's run there's simply no guest access.

The other files in `supabase/updates/` are earlier updates that `setup.sql` already includes.

---

## Good to know

- **Netlify's free plan** gives 300 credits a month, and every deploy to your live site costs 15. Updates whose description includes `[skip netlify]` don't deploy.
- **Supabase pauses idle free projects** after about a week. A small daily ping (`netlify/functions/keepalive.mjs`) prevents that. If it ever does pause, the app still opens with the copy saved on your phone; restore the project from the Supabase dashboard.
- **Personnel follows Discogs.** Classic jazz releases usually have full credits with instruments; some rock and newer releases only list the band. Credits are per pressing, so if a match picked a reissue with thin credits, **Fix match** to the original.
- **Prices** are Discogs' lowest listed price for the matched pressing, before shipping. A want matched to a CD or other non-vinyl pressing gets no price; it shows under **Needs a look** so you can Fix match to the LP. Discogs' API doesn't share individual listings, so seller ratings and shipping are on Discogs when you follow the links.
- **Your own covers** are kept in a Supabase Storage folder called `covers`, and a cover you choose is never replaced by a refresh.
- **Backups**: on the Collection page, **Download a copy** gives a CSV of every album with its tracks, personnel and notes, to read in any spreadsheet (it also imports back in as a spreadsheet). **Download a backup** saves everything exactly as stored (JSON), and **Restore from a backup** brings back any albums from it that aren't in your collection, with nothing to fetch again. Your own cover photos stay in Supabase Storage; the backup keeps their links.
- **Keys**: nothing secret lives in this repository. Your Supabase and Discogs settings are Netlify environment variables. The Supabase anon key is designed to be public; your data is protected by sign-in and the database rules in `setup.sql`.

## What's in here

```
public/                  the website (plain HTML, CSS, JS; no build step)
  js/app.js              screens and interactions
  js/search.js           search across albums, songs and people; filing order
  js/importer.js         reading spreadsheets for import
  js/exporter.js         the CSV download and the JSON backup
  js/store.js            Supabase connection, offline copy, offline want-list queue
  demo.json              a small sample collection for demo mode
netlify/functions/       small server functions (the site owner only)
  discogs.mjs            Discogs matching, collection import, prices and cover search
  bandcamp.mjs           reads one Bandcamp album page you paste a link to
  image.mjs              downloads an image from a pasted link
  config.mjs             hands the site its Supabase settings
  keepalive.mjs          daily ping so Supabase doesn't pause
netlify/lib/             the logic behind those, plus the owner check
supabase/setup.sql       everything a new site's database needs
supabase/updates/        updates for sites set up before setup.sql
tests/                   node --test tests/*.test.mjs; browser walkthroughs: node tests/browser*.mjs <folder>
```

## Licence

MIT. Use it, change it, share it. See [LICENSE](LICENSE).
