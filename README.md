# Daraja — School Management System

A Zeraki-style school management system with student records, attendance, grading/report cards, fees, timetabling, and parent–teacher messaging. Three roles: **Admin**, **Teacher**, **Parent**.

## Stack

- **Backend:** Node.js, Express, Prisma ORM, SQLite (swap to Postgres/MySQL by changing `DATABASE_URL` and the `provider` in `prisma/schema.prisma`)
- **Auth:** JWT, role-based access control
- **Frontend:** React (Vite), React Router, Tailwind CSS, Axios

## Project structure

```
school-mgmt/
  backend/    Express API + Prisma schema + seed data
  frontend/   React admin/teacher/parent portal
```

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # edit JWT_SECRET if you like
npx prisma migrate dev --name init   # creates dev.db and tables
npm run seed               # loads demo data
npm run dev                 # starts API on http://localhost:4000
```

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev                 # starts app on http://localhost:5173
```

Vite proxies `/api` requests to `http://localhost:4000`, so just open http://localhost:5173.

## Demo logins

All demo accounts use the password `password123`.

| Role    | Email                 |
|---------|------------------------|
| Admin   | admin@school.test      |
| Teacher | teacher1@school.test   |
| Teacher | teacher2@school.test   |
| Parent  | parent1@school.test    |
| Parent  | parent2@school.test    |

## What's included

- **Students & admissions** — admit students, assign to classes and parents; admins can create new classes directly from the Students page
- **Attendance** — teachers/admins mark a daily class register (present/late/absent/excused); parents see history
- **Grading & exams** — create exams per class/term/year, bulk score entry per exam/subject/class, auto-generated report cards with averages and letter grades, and a **Download PDF** button that generates a styled report card on the fly
- **Fees & payments** — fee structures per class/term, invoice generation, payment recording, balance tracking
- **Timetable** — weekly class schedule, editable by admins
- **Messaging** — parent–teacher inbox/sent/compose
- **Password management** — accounts created by an admin must change their password on first login; anyone can change their password anytime from the sidebar
- **Profile editing** — anyone can update their own name and phone from "Edit profile" in the sidebar
- **Student & class management** — admins can add or delete students, and add or delete classes (deleting a class keeps its students, just unassigns them). Students can also have a guardian's name/phone/email recorded directly on their record, without needing to create a parent login account
- **User management** (Admin only) — create teacher/parent/admin accounts with a temporary password (forced to change on first login), and delete accounts when needed
- **School settings** (Admin only) — set your actual school's name, shown on the login screen and throughout the app in place of "Daraja" (which stays as a small "Powered by Daraja" product tag)

## Notes & next steps

- The database is SQLite for easy local setup. For production, switch to PostgreSQL (change `provider = "postgresql"` in `schema.prisma` and set `DATABASE_URL`).
- Passwords are hashed with bcrypt; JWTs expire after 12 hours.
- The messaging recipient picker uses the admin-only user directory endpoint — for non-admins to message freely, add a `/api/auth/contacts` endpoint scoped to people they already share a class/child with.
- Not yet built: password reset, file uploads (e.g. report card PDFs), SMS/email notifications, multi-school tenancy — all straightforward additions on this schema.
