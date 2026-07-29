# Settings & staff accounts

Everything on the **Settings** page in one place.

## Enrollment cycle

Shows the current school year and **phase**, with two switches:

- **Lottery open** — whether parents can register and add students. Turn it **off**
  to close the application window.
- **Post-lottery** — whether the draw has already run. This is set **automatically**
  when you run the official lottery; you'd only toggle it by hand in unusual
  situations (for example, to re-enable a re-run — see the Lottery page).

Changes take effect immediately across the site — no restart needed.

## Grade capacity (Max Slots)

The number of seats available per grade (K–9). These feed the Dashboard's *Max
Slots* and the lottery's default caps. Adjust them here before running the lottery,
then **Save caps**. The total updates as you type.

## Notifications

This replaces the old automatic email crons. Emails are **queued** and then
delivered gradually in the background so the school's mailbox stays under its daily
sending limit.

- **Materialize offers & email** — turns newly selected students into live offers and
  emails those families that a position is available.
- **Send reminders** — queues a reminder to every family with an open item (offer to
  accept, or paperwork due). Families who already have a reminder waiting are skipped
  so nobody gets duplicates. (A daily reminder also goes out automatically.)
- **Outbox / Email log** — shows how many messages are queued vs. sent, how many
  have gone out in the last 24 hours against the daily cap, and a log of recent
  messages (with any errors), filterable by status. **Flush a batch now** sends the
  next batch immediately.

If you ever see the cap reached, that's the safety limit doing its job — remaining
messages simply go out over the following hours/day.

## Admin accounts

Manage who can sign into the admin portal:

- **Add admin** — enter a username and a password (8+ characters) and select
  **Add admin**.
- **Deactivate / Reactivate** — revoke or restore someone's access without deleting
  the record.

For safety you can't deactivate **your own** account or the **last remaining active
admin**. Passwords are stored securely and are never shown.

## Start a new lottery year

Also on this page — see **[The lottery & the school year](lottery-and-year.md)** for
the full walkthrough. It's the big, irreversible "begin a fresh cycle" action;
back up first.
