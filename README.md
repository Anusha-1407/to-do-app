# To-Do Pro

A full-stack to-do app: accounts, SQLite database, due dates, priorities,
drag-and-drop reordering, and ready to deploy.

## Features
- Sign up and log in (passwords hashed with bcrypt, session in an httpOnly cookie)
- Each user only sees their own tasks
- Add, edit (double-click), complete, delete, clear completed
- Priority (low / medium / high) and due dates, with overdue highlighting
- Drag-and-drop reordering (desktop; works on the All tab)
- Dark mode support

## Run locally
Requires Node.js 18 or newer.

    npm install
    npm start

Open http://localhost:3000

## Environment variables
| Name         | Purpose                                              |
|--------------|------------------------------------------------------|
| NODE_ENV     | Set to `production` when deployed                    |
| JWT_SECRET   | Long random string used to sign login cookies        |
| DB_PATH      | Path of the SQLite file (use a persistent disk)      |
| PORT         | Set automatically by most hosts                      |

Generate a secret with:

    node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

## API
All task routes require login.

    POST   /api/register        { username, password }
    POST   /api/login           { username, password }
    POST   /api/logout
    GET    /api/me
    GET    /api/tasks
    POST   /api/tasks           { text, priority, dueDate }
    PATCH  /api/tasks/:id       { text?, done?, priority?, dueDate? }
    PUT    /api/tasks/order     { ids: [ ... ] }
    DELETE /api/tasks/:id
    DELETE /api/tasks           (clears completed tasks)

## Deploy
See the steps given with the project: push to GitHub, create a Web Service on
Render or Railway, set the environment variables above, and attach a persistent
disk or volume for DB_PATH.
