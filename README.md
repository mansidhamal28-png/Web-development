# Apna Route – Smart Route Finder and Travel Cost Calculator

Apna Route is a full-stack smart travel planning web application featuring route navigation, travel distance/duration estimation, fuel cost calculation, and personalized route saving.

The backend has been migrated from a local PostgreSQL database (myproject_db via psycopg2) to **Supabase Cloud PostgreSQL** using the official supabase Python SDK with Row Level Security (RLS) and Supabase Auth.

---

## 🏗️ Project Architecture

`
MyProject/
├── backend/
│   ├── app.py                     # Flask REST API with Supabase integration & RLS
│   ├── requirements.txt           # Python dependencies
│   ├── .env                       # Environment variables (Supabase URL & Key)
│   ├── .env.example               # Template for environment variables
│   ├── database/
│   │   └── schema.sql             # Complete Supabase PostgreSQL schema with RLS & triggers
│   └── venv/                      # Python virtual environment
├── frontend/
│   ├── src/                       # React frontend source files (App.jsx, etc.)
│   └── package.json               # Node.js dependencies & scripts
├── .gitignore                     # Git ignore rules for venv, .env, and node_modules
└── README.md                      # Project setup & usage guide
`

---

## 🚀 Supabase Setup Guide

### Step 1: Run schema.sql in Supabase SQL Editor
1. Log in to [Supabase](https://supabase.com) and open your project dashboard.
2. In the left navigation menu, click **SQL Editor** (icon with >_).
3. Click **New Query**.
4. Open ackend/database/schema.sql from this project, copy its entire contents, and paste them into the SQL Editor.
5. Click **Run** (or press Ctrl + Enter).
6. Verify that the following tables appear under **Table Editor**:
   - profiles (linked to uth.users)
   - user_preferences (linked to uth.users)
   - saved_routes (linked to uth.users, protected by RLS)
   - 	ravel_calculations (linked to uth.users, protected by RLS)

### Step 2: Configure Environment Variables
1. In your Supabase Project Dashboard, click **Project Settings** (gear icon) > **API**.
2. Find:
   - **Project URL** (e.g., https://abcdefghijklm.supabase.co)
   - **Project API Keys** > non / public (starts with eyJ...)
3. Open ackend/.env in your editor and update the Supabase section:
   `env
   # Supabase Cloud PostgreSQL Configuration
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_PUBLISHABLE_KEY=your_actual_supabase_anon_publishable_key
   `
   > ⚠️ **Security Notice**: Only use the non / public key. Never expose your service_role secret key in client-facing code or ordinary endpoints.

---

## 🖥️ Running the Application Locally

### 1. Backend (Flask)
From the project root:
`ash
# Navigate to backend directory
cd backend

# Activate virtual environment (Windows)
.\venv\Scripts\activate

# Install dependencies (already installed in venv)
pip install -r requirements.txt

# Run the Flask development server
python app.py
`
The Flask backend will start on http://127.0.0.1:5000.

### 2. Frontend (React)
Open a separate terminal window:
`ash
# Navigate to frontend directory
cd frontend

# Install npm dependencies (if not already installed)
npm install

# Start development server
npm run dev
`
The React frontend will start on http://localhost:5173 (or port assigned by Vite).

---

## 📡 API Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| GET | / | Backend heartbeat check | No |
| GET | /api/test | React frontend integration test | No |
| GET | /api/health/database | Live connection test to Supabase PostgreSQL | No (Tests table & RLS status) |
| POST | /api/auth/register | Register new user via Supabase Auth | No |
| POST | /api/auth/login | Login user and obtain JWT access token | No |
| GET | /api/routes | Fetch authenticated user's saved routes | Yes (Bearer <token>) |
| POST | /api/routes | Save a new route for authenticated user | Yes (Bearer <token>) |
| DELETE | /api/routes/<id> | Delete a saved route (RLS protected) | Yes (Bearer <token>) |
| GET | /api/calculations | Fetch user's travel fuel calculations | Yes (Bearer <token>) |
| POST | /api/calculations | Save new travel fuel calculation | Yes (Bearer <token>) |

---

## 🔒 Security & Row Level Security (RLS)
- **Zero Plaintext Passwords**: Authentication is managed securely through Supabase Auth (uth.users).
- **PostgREST + RLS**: Endpoints use the requesting user's JWT access token (client.postgrest.auth(token)).
- **Tenant Isolation**: PostgreSQL policies (uth.uid() = user_id) ensure users cannot view, modify, or delete routes or calculations belonging to other users.

## 📍 Nearby Petrol Pumps and Location
- During local development, Vite proxies `/api` requests to the Flask server at `http://127.0.0.1:5000`.
- When the frontend and backend are deployed on different hosts, set `VITE_API_BASE_URL` in `frontend/.env` to the backend origin (for example, `https://api.example.com`).
- Nearby fuel searches include both point-mapped and area-mapped OpenStreetMap stations. Changing either route location clears its previous coordinates so the next search uses the newly entered location.
