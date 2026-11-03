# PENG.LOL Modding Website

A full-stack starter for the PENG.LOL modding community. It includes a responsive dark UI, a unified mod library (no categories), username/password accounts, file uploads/downloads, favorites, tutorials, announcements API, and admin controls.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Extract the ZIP.
2. Open a terminal in the extracted `peng-lol` folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env`.
5. Set a strong `OWNER_PASSWORD` and a long random `SESSION_SECRET` in `.env`.
6. Start:
   ```bash
   npm start
   ```
7. Visit `http://localhost:3000`.

## Owner account
The owner username is reserved as `chilly`. The owner account is created or refreshed from `OWNER_PASSWORD` when the server starts. No email address is required. The owner has protected owner permissions and cannot be banned or deleted through the regular admin API.

Do not deploy with the example secrets. Use HTTPS in production and set `NODE_ENV=production`.

## Storage
- SQLite database: `data/penglol.sqlite`
- Session database: `data/sessions.sqlite`
- Uploaded files: `uploads/`

Back up both `data/` and `uploads/`.

## Notes
- The mod library is one unified list; there is no category system.
- Uploads are limited to 100 MB and an extension allowlist. This is not malware scanning; review files before publishing and consider adding server-side scanning before accepting public uploads.
- This ZIP is the website source code, not a hosted public website. Deploy it to a Node.js host to make it available on the internet.
- The tools section currently provides guide/resource cards; it does not pretend to perform APK rebuilding inside the browser.
- Before production use, configure persistent session storage, HTTPS, backups, upload scanning, and a production-grade deployment setup.
