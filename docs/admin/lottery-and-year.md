# The lottery & the school year

## The enrollment dashboard

The **Dashboard** is the office's status board — students by grade and status, with
open seats per grade. Use it to see, at a glance, how full each grade is and how
many offers, waitlisted students, and pending-paperwork families you have. Click
any number to drill into the exact students.

## Running the lottery

The **Run Lottery** page draws the random selection that turns applicants into
offers and a waiting list.

### Preview vs. the official run — important

- **Preview a sample draw** shows *one possible outcome*. It is **illustrative
  only**. For fairness, the real lottery uses a **separate random draw that no one
  has seen** — so the actual results **will differ** from any preview. Run the
  preview as many times as you like to sanity-check the numbers (how many get
  offered vs. waitlisted per grade); it changes each time and never commits
  anything.
- **Run official lottery** performs the real, brand-new random draw, places every
  student, and **cannot be undone**. Double-check the per-grade capacity first.

Steps:
1. Confirm the **per-grade openings (caps)**. These default to your saved capacity
   (editable in **Settings → Grade capacity**).
2. Select **Preview a sample draw** to review the expected offered/waitlisted counts.
3. When you're ready, select **Run official lottery** and confirm.

After the official run, the system records the result (with the draw's unique seed)
and moves the cycle into its **post-lottery** phase. The **Past lottery runs**
section on the same page keeps a permanent record of each run — date, seed, and
offered/waitlist counts — for your files.

> Once the lottery has run, the **Run official lottery** button is disabled to
> prevent accidentally re-drawing and disrupting the offers already sent. If you
> genuinely must re-run, an admin can turn off the **Post-lottery** switch in
> Settings first.

## The returning-student roster

The **Roster** page is the list of students **currently attending** the school. It's
what the system matches against when a returning family re-enrolls, so the names,
dates of birth, and grades must be accurate.

You can filter by grade or name, and **add**, **edit**, or **remove** students. The
most common task is correcting a returning student's spelling or date of birth
**before re-enrollment opens**, so their family matches correctly.

## Starting a new lottery year

At **Settings → Start a new lottery year** you begin a fresh enrollment cycle. This
is a **major, irreversible** action:

- It **purges** the prior year's applicants, parents, notes, survey answers, and
  draw logs.
- It **imports** the new current-student roster from a CSV file you provide.
- It resets the enrollment phase (lottery open, pre-lottery).

**Before you do this:** make sure IT has taken a database backup, and have the new
roster CSV ready. The page shows a warning and validates your CSV first (reporting
any bad rows) before anything is purged. Survey questions, grade capacity, and
uploaded paperwork are **kept** across the year change — review and update those
separately.
