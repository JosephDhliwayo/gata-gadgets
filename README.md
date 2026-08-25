# GATA GADGETS — Receipts, Inventory & Reporting

A self-contained web application for **GATA GADGETS** to capture sales receipts, manage inventory, and generate business reports (Sales, Stock Valuation, Profit & Loss).

## Tech Stack

- Node.js + Express (server-rendered with EJS)
- SQLite (via `better-sqlite3`) — single-file local database, no external DB server required
- Session-based authentication (`express-session` + `bcryptjs`)
- No build step, no external CSS/JS CDNs — works fully offline

## Getting Started

```bash
npm install
npm start
```

Then open http://localhost:3000

On first run, the app automatically creates the SQLite database, schema, a default administrator account, and a few sample products.

**Default administrator login:**
- Email: `admin@gatagadgets.com`
- Password: `Admin@123`

Log in and use **Manage Users → Reset Password** to change it, and create staff (cashier) accounts from there too.

## Roles

- **Administrator** — everything a user can do, plus:
  - Manage inventory (add products, edit pricing, restock/adjust stock, remove products)
  - Record business expenses
  - View Sales, Stock Valuation, and Profit & Loss reports
  - Manage user accounts (create staff, reset passwords, enable/disable, void receipts)
  - Approve or reject sales return requests
- **User (cashier)** — capture sales receipts, view their own receipt history, and request a sales return on a receipt they personally captured.

## Core Features

- **Receipt capture** — POS-style form with multiple line items, live subtotal/tax/total calculation, automatic stock deduction on save, printable receipt view, and admin-only voiding (which restocks items).
- **Sales returns** — a cashier can request a return only on a receipt *they themselves* captured (enforced server-side, not just hidden in the UI); the request goes to an administrator to approve or reject. Approval restocks the returned items and is reflected in the Sales and Profit & Loss reports as a deduction from revenue and COGS; rejection leaves stock and figures untouched. Partial, per-line-item quantities are supported, and a receipt item can't be over-returned across multiple requests.
- **Inventory management** — SKU, category, cost price, selling price, quantity on hand, reorder level, low-stock indicators, and stock adjustments (restocks/corrections) with an audit trail.
- **Expenses** — operating expenses by category, used in the Profit & Loss statement.
- **Customer loyalty program** — a customer profile is created automatically the first time a phone number is entered on a receipt; purchases from that phone roll up into a points score blending: 1 point per net $1 spent, +5 points per "quality" purchase (receipt total ≥ $100), and +10 points per distinct calendar month with a purchase (regularity). Tiers: Bronze (0+), Silver (250+), Gold (600+), Platinum (1500+). Cashiers get a live tier/points hint while typing a phone number on a new receipt; admins get a full **Loyalty** dashboard and per-customer purchase history/points breakdown.
- **Chat** — each cashier has one conversation thread with the admin team (a shared support-inbox model, not user-to-user DMs); admins see every conversation with unread counts and can reply to any of them. Open threads poll for new messages every few seconds. Unread counts show as a badge on the "Chat" nav link.
- **Announcements** — admins post company-wide updates; every user sees the latest one on their dashboard and the full feed under "Announcements", with a per-user unread badge that clears once viewed.
- **Reports** (admin only, all filterable by date range and printable):
  - **Sales Report** — totals, breakdown by product and by cashier, full receipt listing.
  - **Stock Valuation Report** — current inventory value at cost and at retail, per product and total, with low-stock flags.
  - **Profit & Loss Statement** — Gross Sales Revenue − Sales Returns = Net Revenue; Net Revenue − COGS = Gross Profit; Gross Profit − Operating Expenses = Net Profit.

## Data Model

SQLite database file: `db/gata.db` (auto-created; excluded from version control via `.gitignore`).

Tables: `users`, `products`, `receipts`, `receipt_items`, `stock_adjustments`, `expenses`, `return_requests`, `return_request_items`, `customers`, `chat_messages`, `announcements`, `announcement_reads`.

Cost price is snapshotted onto each `receipt_item` at the time of sale, so historical Profit & Loss figures stay accurate even if a product's cost price changes later.

## Notes

- Change `SESSION_SECRET` (env var) before deploying beyond local/internal use.
- To reset all data, stop the server and delete `db/gata.db*`; it will be recreated with fresh seed data on next start.
