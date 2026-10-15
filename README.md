# Northstar Company Portal

A role-based company portal for announcements, a company directory, team spaces, and projects. The original business operations app is still available at port 3001.

## Run the portal

Requires Node.js 22.16 or newer. It uses Node's built-in SQLite module, so there is no database server or npm dependency to install.

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000).

New local databases start empty by default. For local sample data, set `DEMO_MODE=true` and provide `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_MEMBER_EMAIL`, and `DEMO_MEMBER_PASSWORD` before `npm start`. Use throwaway local credentials; demo data is disabled on Vercel.

## Portal features

- Password authentication with salted scrypt hashes and an HTTP-only session cookie.
- Company-scoped data and server-enforced administrator permissions.
- Company announcements, including admin-only create and remove actions.
- Admin company directory with user creation and team assignment.
- Admin team directory with member lists and team creation.
- Team-scoped project viewing, creation, filtering, owner assignment, and status updates for team members and admins.
- Delivery health reporting for each project: on track, at risk, or blocked; an accountable owner; visible blocker and next action; last-updated date; and overdue detection.
- A project attention queue and summary counters help teams find blocked, at-risk, overdue, or stale work before delivery dates slip. Projects without an update for seven days are flagged for a check-in.
- The home dashboard highlights work needing a check-in and links directly to the attention queue.
- Action Center tasks link to projects and teams, with clear owners, due dates, and low/normal/high/urgent priority. Members see tasks in their teams; admins see the company. Filter by open, mine, due soon, overdue, or done, and update owner, status, priority, and due date in place.
- Private real-time chat with company administrators and project leads. Messages are stored in SQLite and delivered to connected users over authenticated Server-Sent Events; once a teammate starts a thread, both participants can continue replying. Conversation history loads 50 messages at a time and supports scrolling to older messages.
- Persistent portal data in `company-portal.sqlite`, with separate tables for companies, users, teams, announcements, projects, tasks, and chat messages. On first startup, existing records in `company-portal.json` are copied into SQLite and that JSON file is left in place as a backup. The existing operations data in `data.json` remains separate.

## Operations app

The earlier invoice, expense, inventory, and task dashboard remains available. Start it in a second terminal:

```powershell
npm run operations
```

Open [http://localhost:3001](http://localhost:3001).

## API routes

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`, `POST /api/auth/select-company`
- `GET /api/portal/dashboard`
- `GET|POST /api/portal/announcements`, `DELETE /api/portal/announcements/:id`
- `GET|POST /api/portal/users` (administrator only)
- `GET|POST /api/portal/teams` (administrator only)
- `GET|POST /api/portal/projects`, `PATCH /api/portal/projects/:id` (status, health, blocker, and next action)
- `GET|POST /api/portal/tasks`, `PATCH|DELETE /api/portal/tasks/:id` (company/team scoped task assignment and execution)
- `GET /api/portal/chat/contacts`, `GET|POST /api/portal/chat/messages` (older pages use the `before` message ID cursor), `GET /api/portal/chat/stream` (authenticated live messaging; member contacts are limited to admins and project leads for visible team projects)

Set `PORTAL_DB_FILE` to use a different SQLite database path. `PORTAL_DATA_FILE` can point to a legacy JSON file for first-run migration. SQLite writes are transactional; back up the `.sqlite` file together with its WAL files only after stopping the server.

## Deployment status

This source currently uses local SQLite/JSON files, in-memory login sessions, and server-sent events. The operations API also has no authentication. These features need a persistent PostgreSQL adapter, serverless-compatible session/chat handling, and operations API authentication before the apps can be deployed safely to Vercel. Do not deploy this version to Vercel yet.

The reference brief names AngularJS, Java/Spring Boot, and PostgreSQL. This runnable implementation uses the built-in Node.js SQLite database because PostgreSQL is not installed in this environment.
