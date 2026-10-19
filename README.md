# EDVANTA — Course Progression Tracker for MSOT
> **"Every Hour Counts, Every Goal Matters."**

EDVANTA is a production-grade, mobile-first Course Progression Tracker engineered for MSOT across its two academic tracks (**Mirai Track** and **University Track**) and four regional campuses (**HI-Tech**, **Ratnam**, **RGIB**, and **JUJ**).

The platform bridges the gap between planned curriculum delivery and actual classroom instruction. Faculty can log a completed teaching session on their phone in **under 60 seconds**, while academic directors and campus managers receive real-time visibility into syllabus velocity, academic delays, and examination readiness—with automatic early warnings before critical assessment milestones.

---

## 🌟 Key Highlights & Engineering Features

- **Mobile-First Fast Session Logging (<60s Flow)**: Pre-fills subject, scheduled timetable slot, next syllabus topic in sequence, and includes an interactive usability stopwatch to prove fast completion.
- **Accurate Mathematical Engine (Requirement 10)**: Strict implementation of hours in scope, covered hours, remaining hours, available hours, buffer ratios, and pace-vs-plan metrics.
- **Worst-Case Rolled-Up Track Status**: A track's overall health reflects its *worst-performing subject*, eliminating deceptive averaging that masks danger.
- **Dynamic Calendar & Schedule Recalculation (Requirement 5 & 9)**: Working Saturday rules (`SECOND_AND_FOURTH`, `ALL`, `NONE`), campus holidays, and schedule adjustments automatically shift affected future planned topic dates.
- **Exam Readiness Milestones (Requirement 12)**: Tracks hour-weighted syllabus progress exclusively within exam scopes for Sessional, Mid-Term, Pre-University Test (PUT), and End-Term exams.
- **Missed-Session Alerts & Escalations (Requirement 14)**: Unlogged sessions trigger a reminder to the assigned faculty at the end of the scheduled day, escalating to the Campus Manager if unlogged after 48 hours. Includes a testable Time Simulation Engine.
- **Strict Role-Based Access Control (RBAC)**: Backend-enforced permissions for Admin, Campus Manager, Faculty, and Students (read-only batch view).
- **Transactional CSV Import & Export (Requirement 15)**: Atomic database transactions for importing calendars, timetables, and lesson plans with row-by-row validation and rollback protection.

---

## 🏗️ Architecture & Technology Stack

```
edvanta/
├── data/                  # Persistent SQLite database storage (WAL mode)
│   └── edvanta.db
├── public/                # Mobile-first frontend SPA
│   ├── css/
│   │   └── styles.css     # Dark glassmorphic design system
│   ├── js/
│   │   ├── api.js         # REST API client with JWT authentication
│   │   └── app.js         # State controller, Chart.js integrations & modals
│   └── index.html         # Responsive semantic UI
├── src/
│   ├── database/
│   │   ├── db.js          # Synchronous SQLite abstraction & transaction manager
│   │   ├── schema.sql     # Database schema, foreign keys & indexes
│   │   └── seed.js        # Realistic sample dataset across 4 campuses
│   ├── middleware/
│   │   ├── auth.js        # JWT token verification
│   │   ├── permissions.js # RBAC, campus isolation & student mutation blocker
│   │   └── validation.js  # Server-side input schema validation
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── campuses.routes.js
│   │   ├── semesters.routes.js
│   │   ├── timetable.routes.js
│   │   ├── syllabus.routes.js
│   │   ├── sessions.routes.js
│   │   ├── dashboard.routes.js
│   │   ├── exams.routes.js
│   │   ├── alerts.routes.js
│   │   └── imports.routes.js
│   ├── services/
│   │   ├── calendar.service.js    # Working days, Saturdays, duration precision
│   │   ├── progression.service.js # Formula engine, dates generator, exam readiness
│   │   └── alerts.service.js      # Missed log scanner & 48h escalation
│   └── server.js          # Express app entrypoint
├── tests/
│   ├── calculations.test.js # Requirement 10 formula & precision tests
│   ├── calendar.test.js     # Saturday rules & holiday window tests
│   ├── alerts_and_rbac.test.js # Alert escalations & RBAC mutation tests
│   └── api.test.js          # End-to-end REST API integration tests
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

### Technology Stack:
- **Backend**: Node.js (v24), Express.js (v5), REST APIs
- **Database**: SQLite via Node's native `node:sqlite` (`DatabaseSync` engine) with Write-Ahead Logging (WAL) and atomic transactions
- **Security**: JWT authentication (`jsonwebtoken`), Bcrypt password hashing (`bcryptjs`)
- **Frontend**: HTML5, Vanilla CSS3 (Custom Dark Glassmorphic Design System), Vanilla ES6 JavaScript, Chart.js
- **Testing**: Node's native test runner (`node --test`)

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Node.js (v20+ or v24+)
- npm or pnpm

### 2. Install Dependencies
```bash
npm install
```

### 3. Seed Database with MSOT Academic Records
```bash
npm run seed
```
This populates the database with 4 campuses, 2 tracks, faculty and student accounts, full timetables with exact decimal durations, lesson plans, and historical session logs.

### 4. Run the Automated Test Suite
```bash
npm test
```
Executes all 20 unit and integration tests verifying calculation formulas, Saturday rules, alert escalations, and API security.

### 5. Launch the Application
```bash
npm start
```
Open your browser at `http://localhost:3000`.

---

## 👥 Demo User Credentials (1-Click Switcher Available in UI)

The web interface features an instant role switcher in the top bar. You can also log in via `POST /api/auth/login` or test accounts:

| Role | Name | Email | Password | Campus / Scope |
|---|---|---|---|---|
| **Admin** | Prof. Rajesh Sharma (Dean) | `admin@edvanta.msot.edu` | `edvanta123` | Global (All Campuses & Tracks) |
| **Campus Manager** | Vikram Malhotra | `manager.hitech@edvanta.msot.edu` | `edvanta123` | HI-Tech Campus |
| **Faculty (CS)** | Dr. Aris Thorne | `faculty.cs@edvanta.msot.edu` | `edvanta123` | HI-Tech Campus (CS301) |
| **Faculty (Math)** | Dr. K. Ramanujan | `faculty.math@edvanta.msot.edu` | `edvanta123` | HI-Tech Campus (MA202) |
| **Student** | Aarav Mehta | `student.aarav@edvanta.msot.edu` | `edvanta123` | Batch-2026-Mirai-A (Read-only) |

---

## 📐 Mandatory Calculation Specifications (Requirement 10)

All formulas are strictly verified by automated test suites in `tests/calculations.test.js`:

### 1. Hours in Scope
$$\text{hoursInScope} = \sum \text{planned\_hours of applicable topics (excluding SKIPPED)}$$

### 2. Covered Hours
$$\text{coveredHours} = \sum \text{planned\_hours}_{\text{completed}} + \sum \left( \text{planned\_hours}_{\text{in-progress}} \times \frac{\text{completion\_pct}}{100} \right)$$
*Skipped topics and cancelled sessions contribute 0 hours. Merged sessions do not double-count.*

### 3. Remaining Hours
$$\text{remainingHours} = \max(0, \text{hoursInScope} - \text{coveredHours})$$

### 4. Available Teaching Hours
Calculated by summing scheduled timetable hours strictly on academic working days between today (inclusive) and the subject's target finish date, excluding holidays, non-working days, and non-working Saturdays.

### 5. Buffer Ratio & Status Classification
$$\text{bufferRatio} = \frac{\text{availableHours}}{\text{remainingHours}}$$
- **COMPLETE**: `remainingHours == 0`
- **ON TRACK**: `bufferRatio >= 1.15`
- **TIGHT**: `1.00 <= bufferRatio < 1.15`
- **DANGER**: `bufferRatio < 1.00` (Academic delay warning)

### 6. Pace vs Plan
$$\text{paceVsPlan} = \text{coveredHours} - \text{hoursThatShouldHaveBeenCoveredByToday}$$
A negative value flags that the subject is running behind schedule.

### 7. Rolled-Up Track Status (Zero Masking Rule)
The overall track status reflects the **worst-performing applicable subject**:
$$\text{Track Status} = \begin{cases} \text{DANGER} & \text{if any subject is DANGER} \\ \text{TIGHT} & \text{if any subject is TIGHT} \\ \text{ON TRACK} & \text{if all subjects are ON TRACK} \\ \text{COMPLETE} & \text{if all subjects are COMPLETE} \end{cases}$$
*A subject in danger can never be hidden by high averages in other subjects.*

---

## 📅 Working Saturday Rules (Requirement 5)

Configurable on a per-semester and per-campus basis:
- `ALL`: Every Saturday is an active working academic day.
- `NONE`: No Saturdays are working days.
- `SECOND_AND_FOURTH`:
  - 1st Saturday (Days 1–7): Non-working
  - 2nd Saturday (Days 8–14): **Working Academic Day**
  - 3rd Saturday (Days 15–21): Non-working
  - 4th Saturday (Days 22–28): **Working Academic Day**
  - 5th Saturday (Days 29–31): Non-working

---

## ⏱️ Fast Session Logging (< 60s Flow)

Located under the **⚡ Fast Session Logger** tab:
1. Faculty selects their scheduled class from today's list.
2. Subject, scheduled time, duration (e.g. 50 mins = 0.83 hrs), and next syllabus topic are pre-filled automatically.
3. Tap 1-click status chips: `COMPLETED`, `IN_PROGRESS`, `SKIPPED`, `MERGED`, `CANCELLED`.
4. If incomplete, quick percentage pills (25%, 50%, 75%) and carry-forward topic prompt appear.
5. Tap **"Save & Log Session"**. A live stopwatch records the duration, verifying completion in under 60 seconds.

---

## 🚨 Alerts & Time Machine Simulation (Requirement 14)

1. **Faculty Reminder**: Scheduled timetable slots unlogged by end of day trigger an in-app reminder for the faculty.
2. **Campus Manager Escalation**: Unlogged sessions exceeding 48 hours escalate automatically to the Campus Manager with `DANGER` severity.
3. **Simulation Controller**: Click **"+2 Days"** in the top bar or use `POST /api/alerts/simulate` to simulate date advance without altering the system clock.

---

## 📁 CSV Import & Export Specifications (Requirement 15)

- Sample templates can be downloaded directly from the **CSV Import & Export** tab or via:
  - `GET /api/exports/export/template/calendar`
  - `GET /api/exports/export/template/timetable`
  - `GET /api/exports/export/template/syllabus`
- Full Progress Report download:
  - `GET /api/exports/export/progress-report`
- Uploads are validated row-by-row and wrapped in SQLite database transactions (`BEGIN IMMEDIATE TRANSACTION ... COMMIT / ROLLBACK`).
