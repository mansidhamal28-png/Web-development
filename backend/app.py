"""
==============================================================================
Apna Route - Backend Application (Flask + Supabase PostgreSQL)
==============================================================================
Description:
    Flask REST API migrated from local PostgreSQL to Supabase Cloud.
    - Preserves existing endpoints (/ and /api/test) for React frontend.
    - Uses Supabase Python SDK for Auth and PostgREST.
    - Implements GET /api/health/database for live connection verification.
    - Enforces Row Level Security (RLS) via user JWT access tokens.
==============================================================================
"""

import os
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

# Import official Supabase client
from supabase import create_client, Client

# ------------------------------------------------------------------------------
# 1. Environment Loading & Application Setup
# ------------------------------------------------------------------------------
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env", override=True)

app = Flask(__name__)
# Enable Cross-Origin Resource Sharing for React frontend (Vite/CRA)
CORS(app, resources={r"/*": {"origins": "*"}})
logging.basicConfig(level=logging.INFO)

# ------------------------------------------------------------------------------
# 2. Supabase Configuration (Strictly Publishable/Anon Key Only)
# ------------------------------------------------------------------------------
def get_env_supabase_url() -> str:
    return os.getenv("SUPABASE_URL", "").strip().rstrip("/")


def get_env_supabase_key() -> str:
    return (os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("SUPABASE_ANON_KEY", "")).strip()


def is_valid_supabase_config() -> bool:
    url = get_env_supabase_url()
    key = get_env_supabase_key()
    if not url or not key:
        return False
    placeholders = ["your-project", "placeholder", "your_supabase", "your-anon", "example"]
    if any(p in url.lower() for p in placeholders):
        return False
    if any(p in key.lower() for p in placeholders):
        return False
    return True


def get_supabase_client() -> Client | None:
    """Initialize public Supabase client using publishable/anon key."""
    if not is_valid_supabase_config():
        return None
    try:
        return create_client(get_env_supabase_url(), get_env_supabase_key())
    except Exception as e:
        app.logger.error(f"Failed to initialize Supabase client: {e}")
        return None


def get_authenticated_client(token: str) -> Client | None:
    """
    Returns a client attached to the requesting user's JWT access token.
    This ensures all PostgREST operations evaluate auth.uid() matching the user,
    preventing IDOR attacks and strictly enforcing Row Level Security (RLS).
    """
    if not token or not is_valid_supabase_config():
        return None
    try:
        client = create_client(get_env_supabase_url(), get_env_supabase_key())
        client.postgrest.auth(token)
        return client
    except Exception as e:
        app.logger.error(f"Failed to attach auth token: {e}")
        return None


# Global public client instance
supabase: Client | None = get_supabase_client()


# ------------------------------------------------------------------------------
# 3. Preserved Existing Routes (Maintains React Frontend Compatibility)
# ------------------------------------------------------------------------------

@app.route("/")
def home():
    """Preserved root route."""
    return "Flask backend is running!"


@app.route("/api/test")
def test_api():
    """Preserved React test endpoint."""
    return jsonify({
        "success": True,
        "message": "React connected to Flask successfully!"
    })


@app.route("/api/nearby", methods=["POST"])
def nearby_places():
    """Fetch nearby fuel stations and other places from OpenStreetMap Overpass."""
    data = request.get_json(silent=True) or {}
    try:
        lat = float(data.get("lat"))
        lng = float(data.get("lng"))
    except (TypeError, ValueError):
        return jsonify({"error": "Valid latitude and longitude are required."}), 400

    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return jsonify({"error": "Latitude or longitude is out of range."}), 400

    fuel_radius, far_radius, near_radius = 5000, 15000, 10000
    queries = {
        "fuel": f'''[out:json][timeout:15];
            node["amenity"="fuel"](around:{fuel_radius},{lat},{lng});
            way["amenity"="fuel"](around:{fuel_radius},{lat},{lng});
            out center;''',
        "other": f'''[out:json][timeout:20];(
            node["amenity"~"hospital|clinic|doctors|pharmacy|nursing_home|health_post"](around:{far_radius},{lat},{lng});
            way["amenity"~"hospital|clinic|nursing_home"](around:{far_radius},{lat},{lng});
            node["amenity"~"restaurant|fast_food|cafe|food_court|dhaba|bar"](around:{near_radius},{lat},{lng});
        );out center 60;''',
    }
    mirrors = (
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.openstreetmap.fr/api/interpreter",
    )
    headers = {
        "User-Agent": "ApnaRoute/1.0 (route-planner-app)",
        "Accept": "application/json",
    }

    def fetch_overpass(query):
        executor = ThreadPoolExecutor(max_workers=len(mirrors))
        futures = {
            executor.submit(
                requests.post,
                endpoint,
                data={"data": query},
                headers=headers,
                timeout=(3, 6),
            ): endpoint
            for endpoint in mirrors
        }
        try:
            for future in as_completed(futures):
                endpoint = futures[future]
                try:
                    response = future.result()
                    response.raise_for_status()
                    elements = response.json().get("elements", [])
                    for pending in futures:
                        pending.cancel()
                    return elements
                except (requests.RequestException, ValueError) as error:
                    app.logger.warning("Overpass request failed at %s: %s", endpoint, error)
            return None
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def fetch_photon_fuel():
        try:
            response = requests.get(
                "https://photon.komoot.io/api/",
                params={"q": "petrol station", "lat": lat, "lon": lng, "limit": 30, "lang": "en"},
                headers={"User-Agent": "ApnaRoute/1.0 (route-planner-app)", "Accept": "application/json"},
                timeout=(3, 8),
            )
            response.raise_for_status()
            features = response.json().get("features", [])
            elements = []
            for feature in features:
                properties = feature.get("properties", {})
                coordinates = feature.get("geometry", {}).get("coordinates", [])
                if properties.get("osm_value") != "fuel" or properties.get("country") != "India" or len(coordinates) < 2:
                    continue
                elements.append({
                    "id": properties.get("osm_id"),
                    "type": properties.get("osm_type") or "node",
                    "lat": coordinates[1],
                    "lon": coordinates[0],
                    "tags": {
                        "amenity": "fuel",
                        "name": properties.get("name"),
                        "brand": properties.get("brand"),
                        "operator": properties.get("operator"),
                        "addr:street": properties.get("street"),
                        "addr:city": properties.get("city") or properties.get("district"),
                    },
                })
            return elements
        except (requests.RequestException, ValueError) as error:
            app.logger.warning("Photon fuel search failed: %s", error)
            return None

    with ThreadPoolExecutor(max_workers=3) as executor:
        photon_future = executor.submit(fetch_photon_fuel)
        fuel_future = executor.submit(fetch_overpass, queries["fuel"])
        other_future = executor.submit(fetch_overpass, queries["other"])
        photon_elements = photon_future.result()
        overpass_fuel_elements = fuel_future.result()
        other_elements = other_future.result()

    fuel_elements = []
    seen_fuel_ids = set()
    for source in (photon_elements, overpass_fuel_elements):
        for element in source or []:
            element_id = element.get("id")
            element_key = (element.get("type", "node"), element_id)
            if element_id is None or element_key not in seen_fuel_ids:
                fuel_elements.append(element)
                if element_id is not None:
                    seen_fuel_ids.add(element_key)

    fuel_available = photon_elements is not None or overpass_fuel_elements is not None

    if not fuel_available and other_elements is None:
        return jsonify({"error": "Nearby place search is temporarily unavailable."}), 502

    return jsonify({
        "fuelElements": fuel_elements or [],
        "otherElements": other_elements or [],
        "fuelAvailable": fuel_available,
    })


@app.route("/api/db-test")
def db_test():
    """Legacy DB test route updated to test Supabase connection."""
    client = get_supabase_client()
    if not client:
        return jsonify({
            "success": False,
            "message": "Supabase credentials missing or placeholders in backend/.env. Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY."
        }), 500

    try:
        res = client.table("profiles").select("id").limit(1).execute()
        return jsonify({
            "success": True,
            "database": "Supabase PostgreSQL",
            "message": "Flask connected to Supabase PostgreSQL successfully!"
        })
    except Exception as error:
        app.logger.exception("Supabase database connection failed")
        return jsonify({
            "success": False,
            "message": f"Database query failed: {str(error)}"
        }), 500


# ------------------------------------------------------------------------------
# 4. Requirement 5: Dedicated Supabase Database Health Check
# ------------------------------------------------------------------------------

@app.route("/api/health/database", methods=["GET"])
def health_database():
    """
    Comprehensive health check testing a live request to Supabase.
    Returns HTTP 200 on success, or HTTP 503 if credentials/tables are unconfigured.
    """
    global supabase
    if not supabase:
        supabase = get_supabase_client()

    if not supabase:
        return jsonify({
            "connected": False,
            "database": "Supabase PostgreSQL",
            "status": "unconfigured",
            "message": "SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set in backend/.env.",
            "hint": "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in backend/.env to connect to your Supabase project."
        }), 503

    try:
        # Perform a real database request to verify tables & permissions
        res = supabase.table("profiles").select("id").limit(1).execute()
        return jsonify({
            "connected": True,
            "database": "Supabase PostgreSQL",
            "status": "healthy",
            "message": "Successfully connected to Supabase PostgreSQL with active RLS!",
            "provider": "Supabase Cloud PostgREST"
        }), 200
    except Exception as e:
        error_msg = str(e)
        app.logger.warning(f"Database health check failed: {error_msg}")
        return jsonify({
            "connected": False,
            "database": "Supabase PostgreSQL",
            "status": "error",
            "message": f"Connection attempt failed: {error_msg}",
            "hint": "Ensure you executed backend/database/schema.sql in your Supabase SQL Editor."
        }), 503


# ------------------------------------------------------------------------------
# 5. Supabase Auth Endpoints (No Plaintext Password Storage, No Service Keys)
# ------------------------------------------------------------------------------

@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    """Registers a new user via Supabase Auth and triggers profile creation."""
    client = get_supabase_client()
    if not client:
        return jsonify({"success": False, "error": "Supabase is not configured."}), 503

    data = request.get_json(silent=True) or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    full_name = data.get("full_name", "").strip()

    if not email or not password or len(password) < 6:
        return jsonify({"success": False, "error": "Valid email and a password of at least 6 characters are required."}), 400

    try:
        response = client.auth.sign_up({
            "email": email,
            "password": password,
            "options": {"data": {"full_name": full_name}}
        })
        if not response.user:
            return jsonify({"success": False, "error": "Registration failed."}), 400

        return jsonify({
            "success": True,
            "message": "Registration successful! You can now log in.",
            "user": {"id": str(response.user.id), "email": response.user.email}
        }), 201
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """Authenticates user and returns JWT access token for client requests."""
    client = get_supabase_client()
    if not client:
        return jsonify({"success": False, "error": "Supabase is not configured."}), 503

    data = request.get_json(silent=True) or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"success": False, "error": "Email and password are required."}), 400

    try:
        res = client.auth.sign_in_with_password({"email": email, "password": password})
        if not res.session or not res.user:
            return jsonify({"success": False, "error": "Invalid email or password."}), 401

        return jsonify({
            "success": True,
            "access_token": res.session.access_token,
            "user": {
                "id": str(res.user.id),
                "email": res.user.email,
                "name": (res.user.user_metadata or {}).get("full_name", email.split("@")[0])
            }
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 401


# ------------------------------------------------------------------------------
# 6. Apna Route Core Data Endpoints (RLS Enforced with auth.uid())
# ------------------------------------------------------------------------------

def get_token_from_header() -> str:
    """Helper: Extracts Bearer JWT token from Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    return ""


@app.route("/api/routes", methods=["GET", "POST"])
def manage_saved_routes():
    """List or save routes with strict user isolation via RLS."""
    token = get_token_from_header()
    user_client = get_authenticated_client(token)
    if not user_client:
        return jsonify({"success": False, "error": "Unauthorized. Bearer token required."}), 401

    if request.method == "GET":
        try:
            res = user_client.table("saved_routes").select("*").order("created_at", desc=True).execute()
            return jsonify({"success": True, "routes": res.data or []})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 400

    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        try:
            user_res = user_client.auth.get_user(token)
            user_id = str(user_res.user.id)

            record = {
                "user_id": user_id,
                "route_title": body.get("title") or f"{body.get('origin_name')} to {body.get('destination_name')}",
                "origin_name": body.get("origin_name", ""),
                "destination_name": body.get("destination_name", ""),
                "origin_lat": float(body.get("origin_lat", 0.0)),
                "origin_lng": float(body.get("origin_lng", 0.0)),
                "destination_lat": float(body.get("destination_lat", 0.0)),
                "destination_lng": float(body.get("destination_lng", 0.0)),
                "distance_km": float(body.get("distance_km", 0.0)),
                "duration_seconds": float(body.get("duration_seconds", 0.0)),
                "duration_formatted": str(body.get("duration_formatted", "")),
                "estimated_fuel_cost": float(body.get("estimated_fuel_cost", 0.0)),
                "route_geometry": body.get("route_geometry", {})
            }
            res = user_client.table("saved_routes").insert(record).execute()
            return jsonify({"success": True, "route": res.data[0] if res.data else {}}), 201
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 400


@app.route("/api/routes/<int:route_id>", methods=["DELETE"])
def delete_saved_route(route_id: int):
    """Delete a saved route. RLS prevents deleting rows belonging to other users."""
    token = get_token_from_header()
    user_client = get_authenticated_client(token)
    if not user_client:
        return jsonify({"success": False, "error": "Unauthorized."}), 401

    try:
        res = user_client.table("saved_routes").delete().eq("id", route_id).execute()
        return jsonify({"success": True, "message": "Route deleted."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400


@app.route("/api/calculations", methods=["GET", "POST"])
def manage_calculations():
    """List or save travel fuel cost calculations with RLS."""
    token = get_token_from_header()
    user_client = get_authenticated_client(token)
    if not user_client:
        return jsonify({"success": False, "error": "Unauthorized. Bearer token required."}), 401

    if request.method == "GET":
        try:
            res = user_client.table("travel_calculations").select("*").order("created_at", desc=True).execute()
            return jsonify({"success": True, "calculations": res.data or []})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 400

    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        try:
            user_res = user_client.auth.get_user(token)
            user_id = str(user_res.user.id)

            record = {
                "user_id": user_id,
                "trip_title": body.get("trip_title", "Fuel Calculation"),
                "distance_km": float(body.get("distance_km", 0.0)),
                "mileage_km_per_litre": float(body.get("mileage_km_per_litre", 0.0)),
                "fuel_price_per_litre": float(body.get("fuel_price_per_litre", 0.0)),
                "fuel_required_litres": float(body.get("fuel_required_litres", 0.0)),
                "total_fuel_cost": float(body.get("total_fuel_cost", 0.0)),
                "notes": body.get("notes", "")
            }
            res = user_client.table("travel_calculations").insert(record).execute()
            return jsonify({"success": True, "calculation": res.data[0] if res.data else {}}), 201
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 400


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="127.0.0.1", port=port, debug=True)
