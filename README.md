# Garage Crates

This is Garage Crates, a record collection app that makes it easy to keep track of the albums you own, want to buy, want to sell, and need to wash. You can get started quickly by importing from Discogs, uploading a CSV, or adding your records one by one — even this is easy because all you need is most of the artist and most of the title and the app will look up the rest through the Discogs API.

I found myself flipping through bins in record stores trying to remember whether I already had the title I was looking at and this was the solution. It's also handy for when you're listening, don't have the sleeve nearby and want to know the name of a track or who's playing on it.  It runs on the free tier of Netlify and Supabase, so you can take it anywhere. 

What else can it do?

- **Import your records** from your Discogs collection or from any spreadsheet saved as CSV. You can add all sorts of fields to the CSV, including catalogue number, but all you need at a minimum is artist and title and the rest will come in via Discogs. If what it pulls isn't right, you can choose from other pressings or versions.
- **Covers, tracks and personnel** come from Discogs and the app always selects the vinyl edition. For a release that isn't on Discogs but is on Bandcamp, you can paste that link and the app will pull in the release infor. If a cover is wrong or not great, **Find a better image** offers alternatives, or you can upload your own photo.
- **Crates**: allow you to make your own groupings beyond genre, like "Late Night" or "Matador Releases."
- **Pick for me** pulls a title at random and you can narrow its choice by crate or genre.
- **Want list**: Tap **Add**, enter an artist and album and you're done. Want list records show in search with a dashed outline, so you can tell at a glance you don't own them yet. Each one shows the lowest price for its pressing on the Discogs marketplace, with links to that pressing's US sellers or all sellers. (The Discogs marketplace API isn't super great, so use this price as a ballpark).
- **For sale**: Mark records you want to remember to sell and filter to just those.
- **Wash queue**: Mark a record **To wash** when it sounds dirty; on wash day, filter to **To wash**, select the ones you've washed and tap **Mark washed**. Each record remembers when it was last washed.

 Here's how it organizes:

- **Filed like a record shop**: Everything is listed alphabetically like you'd find the records in a shop, but sometimes this gets tricky so if the app gets it wrong, you can force a record into the right position by editing its details and adding how you'd like it sorted in the **File under** field.
- **Filed by first release**: A 2024 reissue of a 1975 album shows up as 1975, with the pressing's own year beside its catalogue number.
- **Search everything**: artist, album, song, genre, crate, or player. Searching a musician lists every record they're on, whether it's their album or they're a sideman, with their instrument.

 And that's not all:
 
- **Share it with a passphrase**: Friends can browse everything; only you can change stuff.
- **Download or back up everything**: a CSV of every album with tracks, personnel and notes, or a complete JSON backup you can restore from later.
- **Works with a weak signal**: the app opens with the copy saved on your phone, and want-list adds sync later when you're back online.

Set up your own copy in about 20 minutes, on free accounts:
**Supabase** holds the data, **Netlify** hosts the site, **Discogs** supplies album details.

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
- **From a spreadsheet**: export it as CSV (comma, tab or semicolon separated all work). The app matches the columns from your headings (artist, album, year, original year, label, catalogue number, genre, notes, players, owned or wanted), shows a preview, and leaves out duplicates.

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

## Updating your copy

New features sometimes need a small database update. They live in [`supabase/updates/`](supabase/updates/), numbered in the order they were added; a fresh `setup.sql` already includes all of them.

When you pull in a newer version of this project, run any update files you haven't run yet in the Supabase SQL Editor, in number order. Every file is safe to run again, so if you're not sure, run them all. The site keeps working before you do; the features that need an update simply stay hidden, and the Collection page tells you which file turns them on.

| File | Adds |
|---|---|
| `002_covers.sql` | storage for your own cover photos |
| `004_crates.sql` | crates |
| `005_prices.sql` | want-list prices |
| `006_file_under.sql` | **File under** |
| `007_owner_and_guests.sql` | owner-only changes and the guest passphrase (makes the first account on the project the owner) |
| `008_original_year.sql` | the year each album first came out; records pick it up the next time their details are fetched or refreshed |
| `009_wash_queue.sql` | the wash queue |

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
  image.mjs              downloads a cover from a pasted link or a slow source, to save your own copy
  config.mjs             hands the site its Supabase settings
  keepalive.mjs          daily ping so Supabase doesn't pause
netlify/lib/             the logic behind those, plus the owner check
supabase/setup.sql       everything a new site's database needs
supabase/updates/        updates for copies set up before a feature existed
tests/                   node --test tests/*.test.mjs; browser walkthroughs: node tests/browser*.mjs <folder>
```

## Licence

MIT. Use it, change it, share it. See [LICENSE](LICENSE).
