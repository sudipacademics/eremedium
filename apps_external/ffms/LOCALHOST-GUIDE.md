# Run RFMS on your computer

## First time only

1. Install [Node.js LTS](https://nodejs.org/) (version 20 or later).
2. Double-click `setup-local.cmd` and wait until it says RFMS is ready.
3. Double-click `run-admin.cmd` and keep the black window open. When it says `Ready`, open `http://localhost:3002`.

`start-local.cmd` is optional; it starts all three applications together. If Windows closes it or you only want the dashboard, use `run-admin.cmd` instead.

Your browser opens the Admin Dashboard automatically. You can also manually use:

| App | Address |
|---|---|
| Marketing website | http://localhost:3000 |
| Applicant portal | http://localhost:3001 |
| Admin dashboard | http://localhost:3002 |

## Testing the admin dashboard

Try the applicant search, left-side navigation, Quick actions, review buttons and date/filter controls. They update the local UI state and show confirmation messages.

## Stop it

Close the three terminal windows opened by `start-local.cmd`, or double-click `stop-local.cmd` for a reminder.

## Admin Content CMS and public videos

To publish YouTube success stories or featured franchisees, Docker is not required for this manual local check:

1. Double-click `run-admin.cmd`. It builds and starts the local API plus Marketing, Applicant and Admin websites in one window.
2. Open `http://localhost:3002`.
3. Sign in as the local Super Admin:
   - Email: `admin@remediumlab.local`
   - Password: `Admin@12345`
   - Local OTP: `123456`
4. Open **Content CMS** in the left menu. Paste a YouTube iframe embed code and enter a franchisee image URL. Published entries appear on `http://localhost:3000`.

The API runs at `http://localhost:8080`. This bundled local API is for manual checking and persists its local content in `work/rfms-local-api-data.json`. The Laravel/MySQL API remains available through Docker for deployment and uploaded-image support. The local account and OTP are for development only; replace them before deployment.
