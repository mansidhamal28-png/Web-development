import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, Circle } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

const greenIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
})
const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
})
const goldIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [20, 33], iconAnchor: [10, 33], popupAnchor: [1, -28], shadowSize: [33, 33],
})
const orangeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [20, 33], iconAnchor: [10, 33], popupAnchor: [1, -28], shadowSize: [33, 33],
})
const violetIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [20, 33], iconAnchor: [10, 33], popupAnchor: [1, -28], shadowSize: [33, 33],
})

// ── ORS API Key (optional - add VITE_ORS_API_KEY to frontend/.env)
const ORS_KEY = import.meta.env.VITE_ORS_API_KEY || ''
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

// ══════════════════════════════════════════════════════════════════
//  GEOCODING  —  Photon by Komoot  (100% FREE · No API key needed)
//  Excellent Indian village/hamlet coverage via OpenStreetMap data
//  Docs: https://photon.komoot.io/
// ══════════════════════════════════════════════════════════════════

// Build a readable label from a Photon feature
function photonLabel(props) {
  const parts = [props.name, props.village || props.town || props.city, props.county, props.state]
  return parts.filter(Boolean).join(', ')
}

// Resolve Photon feature type → simple string
function photonType(props) {
  const t = (props.osm_value || '').toLowerCase()
  if (t === 'village' || t === 'hamlet' || t === 'locality') return 'village'
  if (t === 'town') return 'town'
  return 'city'
}

// ── Geocode: text → { lat, lng, label }
// Primary: Photon API (free, no key) · Fallback: Nominatim
async function geocodePlace(text) {
  // Optional ORS override (if key provided in .env)
  if (ORS_KEY) {
    try {
      const res = await fetch(`https://api.openrouteservice.org/geocode/search?api_key=${ORS_KEY}&text=${encodeURIComponent(text)}&boundary.country=IN&size=3`)
      const data = await res.json()
      if (data.features?.length) {
        const [lng, lat] = data.features[0].geometry.coordinates
        return { lat, lng, label: data.features[0].properties.label }
      }
    } catch (_) {}
  }
  // ── Primary: Photon (free, great village coverage)
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=5&lang=en&bbox=68.0,6.5,97.4,37.6`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    // Filter to India results only
    const india = (data.features || []).filter(f => f.properties?.country === 'India')
    if (india.length) {
      const [lng, lat] = india[0].geometry.coordinates
      return { lat, lng, label: photonLabel(india[0].properties) }
    }
  } catch (_) {}
  // ── Fallback: Nominatim
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=3&countrycodes=in&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    if (data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name }
  } catch (_) {}
  throw new Error(`Could not find "${text}". Try adding district or state (e.g. "Shirsad, Sindhudurg, Maharashtra").`)
}

// ── Autocomplete suggestions
// Primary: Photon API (free, no key, villages + hamlets included)
async function fetchSuggestions(text) {
  if (!text || text.length < 2) return []
  try {
    // Bounding box covers the entire Indian subcontinent
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=8&lang=en&bbox=68.0,6.5,97.4,37.6`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    return (data.features || [])
      .filter(f => f.properties?.country === 'India' && f.properties?.name)
      .map(f => {
        const p = f.properties
        const [lng, lat] = f.geometry.coordinates
        const label = photonLabel(p)
        return {
          label,
          short: label,
          lat,
          lng,
          type: photonType(p),
        }
      })
  } catch { return [] }
}

// ── Haversine distance (km)
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Multiple routes → array of { distanceKm, durationFormatted, durationSec, label, color, polyline? }
async function getMultipleRoutes(origin, dest, vehicleType = 'car') {
  const straight = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng)
  const profiles = {
    car: {
      icon: '🚗', label: 'Car',
      variants: [
        { factor: 1.30, speed: 70, label: '⚡ Fastest', color: '#6366f1', desc: 'Highway route via expressway' },
        { factor: 1.45, speed: 55, label: '🛣️ Balanced', color: '#10b981', desc: 'Mix of highway and state roads' },
        { factor: 1.60, speed: 45, label: '🌿 Scenic', color: '#f59e0b', desc: 'Longer but scenic route' },
      ],
    },
    bike: {
      icon: '🏍️', label: 'Bike',
      variants: [
        { factor: 1.20, speed: 32, label: '⚡ Fastest', color: '#f97316', desc: 'Quickest bike-safe route with fewer detours' },
        { factor: 1.38, speed: 26, label: '🛵 Balanced', color: '#06b6d4', desc: 'Best balance of road quality and distance' },
        { factor: 1.55, speed: 20, label: '🌿 Scenic', color: '#84cc16', desc: 'Shorter coastal and scenic roads for riders' },
      ],
    },
    suv: {
      icon: '🚙', label: 'SUV',
      variants: [
        { factor: 1.35, speed: 65, label: '⚡ Fastest', color: '#8b5cf6', desc: 'Comfortable highway route for SUVs' },
        { factor: 1.50, speed: 52, label: '🛣️ Balanced', color: '#14b8a6', desc: 'Stable route with smoother roads' },
        { factor: 1.65, speed: 42, label: '🌿 Scenic', color: '#f59e0b', desc: 'Longer but smoother road experience' },
      ],
    },
    truck: {
      icon: '🚛', label: 'Truck',
      variants: [
        { factor: 1.55, speed: 42, label: '⚡ Fastest', color: '#ef4444', desc: 'Heavy-vehicle route with major roads' },
        { factor: 1.70, speed: 34, label: '🛣️ Balanced', color: '#f97316', desc: 'Safer route with moderate traffic' },
        { factor: 1.90, speed: 28, label: '🌿 Scenic', color: '#a78bfa', desc: 'Avoids congested city routes' },
      ],
    },
  }

  const profile = profiles[vehicleType] || profiles.car
  const routes = profile.variants.map((v, i) => {
    const km = parseFloat((straight * v.factor).toFixed(1))
    const sec = Math.round((km / v.speed) * 3600)
    const midLat = (origin.lat + dest.lat) / 2 + (i - 1) * (vehicleType === 'bike' ? 0.18 : 0.3)
    const midLng = (origin.lng + dest.lng) / 2 + (i - 1) * (vehicleType === 'bike' ? 0.12 : 0.15)
    return {
      distanceKm: km, durationSec: sec, durationFormatted: fmtDur(sec),
      label: `${profile.icon} ${v.label}`,
      color: v.color,
      desc: v.desc,
      polyline: [[origin.lat, origin.lng], [midLat, midLng], [dest.lat, dest.lng]],
    }
  })
  return routes
}

function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  if (h === 0) return `${m} min`; if (m === 0) return `${h} hr`; return `${h} hr ${m} min`
}

// ── FAST: single Overpass query fetches ALL 3 categories at once
//    + races all mirrors in parallel → uses the fastest responder
async function fetchAllNearby(lat, lng) {
  const response = await fetch(`${API_BASE_URL}/api/nearby`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Nearby place search is temporarily unavailable.')
  const elements = [...(data.fuelElements || []), ...(data.otherElements || [])]

  // Classify each element by its amenity tag
  const PETROL_TAGS  = new Set(['fuel'])
  const HOSP_TAGS    = new Set(['hospital','clinic','doctors','pharmacy','nursing_home','health_post'])
  const REST_TAGS    = new Set(['restaurant','fast_food','cafe','food_court','dhaba','bar'])

  const result = { petrol: [], hospital: [], restaurant: [] }

  for (const el of elements) {
    const amenity = el.tags?.amenity || ''
    const elLat = el.lat ?? el.center?.lat
    const elLng = el.lon ?? el.center?.lon
    if (!Number.isFinite(elLat) || !Number.isFinite(elLng)) continue
    const dist = `${haversineKm(lat, lng, elLat, elLng).toFixed(1)} km away`
    const base = {
      id: el.id,
      lat: elLat, lng: elLng,
      name: el.tags?.name || '',
      brand: el.tags?.brand || el.tags?.operator || '',
      address: [el.tags?.['addr:street'], el.tags?.['addr:city'] || el.tags?.['addr:suburb'] || el.tags?.['addr:village']].filter(Boolean).join(', '),
      phone: el.tags?.phone || el.tags?.['contact:phone'] || '',
      opening: el.tags?.opening_hours || '',
      dist,
    }
    if (PETROL_TAGS.has(amenity)) {
      result.petrol.push({ ...base, name: base.name || 'Petrol Pump' })
    } else if (HOSP_TAGS.has(amenity)) {
      result.hospital.push({ ...base, name: base.name || 'Hospital/Clinic' })
    } else if (REST_TAGS.has(amenity)) {
      result.restaurant.push({ ...base, name: base.name || 'Restaurant' })
    }
  }

  // Sort each category by distance (nearest first)
  for (const cat of ['petrol','hospital','restaurant']) {
    result[cat].sort((a, b) => parseFloat(a.dist) - parseFloat(b.dist))
  }

  return result
}

// ── fetchAllNearby already returns all 3 — kept for compatibility
async function fetchNearbyPlaces(lat, lng, type) {
  const all = await fetchAllNearby(lat, lng)
  return all[type] || []
}



const FUEL_PRICES    = { petrol: 103, diesel: 90, cng: 76 }
const VEHICLE_MILEAGE = { car: 16, bike: 45, suv: 12, truck: 8 }

// ── Leaflet map auto-fit helper
function MapFit({ bounds }) {
  const map = useMap()
  useEffect(() => { if (bounds) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 }) }, [bounds, map])
  return null
}

/* ══════════════════════════════════════════════════════════════════
   AUTOCOMPLETE INPUT
══════════════════════════════════════════════════════════════════ */
function PlaceInput({ id, label, emoji, placeholder, value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([])
  const [showDrop, setShowDrop] = useState(false)
  const [timer, setTimer] = useState(null)
  const ref = useRef()

  function handleChange(e) {
    onChange(e.target.value)
    clearTimeout(timer)
    if (e.target.value.length < 2) { setSuggestions([]); return }
    const t = setTimeout(async () => {
      const s = await fetchSuggestions(e.target.value)
      setSuggestions(s); setShowDrop(true)
    }, 500)
    setTimer(t)
  }

  function handlePick(s) {
    onChange(s.short)
    onSelect({ lat: s.lat, lng: s.lng, label: s.label })
    setSuggestions([]); setShowDrop(false)
  }

  useEffect(() => {
    function outsideClick(e) { if (ref.current && !ref.current.contains(e.target)) setShowDrop(false) }
    document.addEventListener('mousedown', outsideClick)
    return () => document.removeEventListener('mousedown', outsideClick)
  }, [])

  return (
    <div className="ar-field-group" ref={ref} style={{ position: 'relative' }}>
      <label className="ar-field-label" htmlFor={id}>{emoji} {label}</label>
      <input
        id={id} className="ar-field-input rp-place-input" type="text"
        placeholder={placeholder} value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setShowDrop(true)}
        required autoComplete="off"
      />
      {showDrop && suggestions.length > 0 && (
        <ul className="rp-suggestions" id={`${id}-suggestions`}>
          {suggestions.map((s, i) => (
            <li key={i} className="rp-suggestion-item" onMouseDown={() => handlePick(s)}>
              <span className="rp-sug-icon">
                {s.type === 'village' || s.type === 'hamlet' ? '🏘️' : s.type === 'town' ? '🏙️' : '📍'}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="rp-sug-text">{s.short}</span>
                {(s.type === 'village' || s.type === 'hamlet') && (
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '1px' }}>Village</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   AUTH MODAL
══════════════════════════════════════════════════════════════════ */
function AuthModal({ mode, onClose, onSwitch, onSuccess }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [successMsg, setSuccessMsg] = useState('')
  const isLogin = mode === 'login'
  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setSuccessMsg(''); setLoading(true)
    if (isLogin) {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) { setError(err.message); setLoading(false); return }
      onSuccess(data.user)
    } else {
      const { data, error: err } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
      if (err) { setError(err.message); setLoading(false); return }
      if (data.user && !data.session) { setSuccessMsg('✅ Check your email to confirm!'); setLoading(false); return }
      onSuccess(data.user)
    }
    setLoading(false)
  }
  return (
    <div className="ar-modal-overlay" id="ar-auth-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ar-modal" id="ar-auth-modal" role="dialog" aria-modal="true">
        <button className="ar-modal-close" id="ar-modal-close-btn" onClick={onClose}>✕</button>
        <div className="ar-modal-header">
          <div className="ar-modal-logo"><span>🗺️</span><span>Apna<span className="ar-logo-accent">Route</span></span></div>
          <h2 className="ar-modal-title">{isLogin ? 'Welcome back' : 'Create account'}</h2>
          <p className="ar-modal-sub">{isLogin ? 'Sign in to access your saved routes.' : 'Join free and start planning smarter.'}</p>
        </div>
        <form className="ar-auth-form" onSubmit={handleSubmit} id="ar-auth-form">
          {!isLogin && <div className="ar-field-group"><label className="ar-field-label" htmlFor="ar-full-name">Full Name</label><input id="ar-full-name" className="ar-field-input" type="text" placeholder="Rahul Sharma" value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div>}
          <div className="ar-field-group"><label className="ar-field-label" htmlFor="ar-email">Email</label><input id="ar-email" className="ar-field-input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
          <div className="ar-field-group"><label className="ar-field-label" htmlFor="ar-password">Password</label><input id="ar-password" className="ar-field-input" type="password" placeholder={isLogin ? '••••••••' : 'Min. 6 characters'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={isLogin ? 'current-password' : 'new-password'} /></div>
          {error && <p className="ar-auth-error" role="alert">{error}</p>}
          {successMsg && <p className="ar-auth-success">{successMsg}</p>}
          <button className="ar-btn-primary ar-auth-submit" id="ar-auth-submit-btn" type="submit" disabled={loading}>
            {loading ? <span className="ar-spinner" /> : (isLogin ? 'Sign In →' : 'Create Account →')}
          </button>
        </form>
        <p className="ar-modal-switch">{isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button className="ar-switch-link" id="ar-switch-auth-btn" onClick={onSwitch}>{isLogin ? 'Sign up free' : 'Sign in'}</button>
        </p>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   USER MENU
══════════════════════════════════════════════════════════════════ */
function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false)
  const initials = (user.user_metadata?.full_name || user.email || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  return (
    <div className="ar-user-menu" id="ar-user-menu">
      <button className="ar-avatar-btn" id="ar-avatar-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="ar-avatar">{initials}</span><span className="ar-avatar-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="ar-user-dropdown" id="ar-user-dropdown">
        <p className="ar-dropdown-email">{user.email}</p>
        <hr className="ar-dropdown-divider" />
        <button className="ar-dropdown-item ar-dropdown-signout" id="ar-signout-btn" onClick={onSignOut}>🚪 Sign Out</button>
      </div>}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ROUTE PLANNER PAGE  (all 5 features)
══════════════════════════════════════════════════════════════════ */
function RoutePlannerPage({ user, onOpenAuth }) {
  // ── Inputs
  const [originText, setOriginText]   = useState('')
  const [destText, setDestText]       = useState('')
  const [originGeo, setOriginGeo]     = useState(null)   // { lat, lng, label }
  const [destGeo, setDestGeo]         = useState(null)
  const [vehicleType, setVehicleType] = useState('car')
  const [fuelType, setFuelType]       = useState('petrol')
  const [mileage, setMileage]         = useState(16)
  const [fuelPrice, setFuelPrice]     = useState(103)

  // ── Routes
  const [routes, setRoutes]           = useState([])     // multiple route suggestions
  const [selRouteIdx, setSelRouteIdx] = useState(0)      // selected route index
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  // ── Nearby places (all categories loaded at once)
  const [nearbyTab, setNearbyTab]       = useState('petrol')
  const [allNearby, setAllNearby]       = useState({ petrol: [], hospital: [], restaurant: [] })
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyError, setNearbyError]   = useState('')
  const nearbyPlaces = allNearby[nearbyTab] || []

  // ── Selected nearby place (for showing path on map)
  const [selectedPlace, setSelectedPlace] = useState(null)  // { lat, lng, name, type }

  // ── Live location
  const [liveLocLoading, setLiveLocLoading] = useState(false)
  const [liveLocError, setLiveLocError]     = useState('')

  // ── Save
  const [saving, setSaving]           = useState(false)
  const [saveMsg, setSaveMsg]         = useState('')
  const [savedRoutes, setSavedRoutes] = useState([])
  const [routesLoading, setRoutesLoading] = useState(false)

  const selRoute = routes[selRouteIdx] || null

  useEffect(() => { setMileage(VEHICLE_MILEAGE[vehicleType] || 16) }, [vehicleType])
  useEffect(() => { setFuelPrice(FUEL_PRICES[fuelType] || 103) }, [fuelType])

  useEffect(() => {
    if (!originGeo || !destGeo || routes.length === 0) return

    let cancelled = false
    async function refreshRoutes() {
      const nextRoutes = await getMultipleRoutes(originGeo, destGeo, vehicleType)
      if (!cancelled) {
        setRoutes(nextRoutes)
        setSelRouteIdx((prev) => Math.min(prev, nextRoutes.length - 1))
      }
    }

    refreshRoutes().catch(() => {})
    return () => { cancelled = true }
  }, [vehicleType, originGeo, destGeo])

  const fuelLitres = selRoute ? parseFloat((selRoute.distanceKm / mileage).toFixed(2)) : 0
  const fuelCost   = selRoute ? parseFloat((fuelLitres * fuelPrice).toFixed(0)) : 0

  // ── Map bounds
  const mapBounds = selRoute && originGeo && destGeo
    ? [[originGeo.lat, originGeo.lng], [destGeo.lat, destGeo.lng]]
    : null

  // ── Calculate routes
  async function handleCalculate(e) {
    e.preventDefault()
    setError(''); setRoutes([]); setSaveMsg(''); setAllNearby({ petrol: [], hospital: [], restaurant: [] }); setLoading(true)
    try {
      let oGeo = originGeo, dGeo = destGeo
      if (!oGeo) oGeo = await geocodePlace(originText.trim())
      if (!dGeo) dGeo = await geocodePlace(destText.trim())
      setOriginGeo(oGeo); setDestGeo(dGeo)
      const r = await getMultipleRoutes(oGeo, dGeo, vehicleType)
      setRoutes(r); setSelRouteIdx(0)
      // ── Auto-load all nearby categories in parallel
      setNearbyLoading(true); setNearbyError(''); setAllNearby({ petrol: [], hospital: [], restaurant: [] })
      try {
        const nearby = await fetchAllNearby(oGeo.lat, oGeo.lng)
        setAllNearby(nearby)
        const totalFound = nearby.petrol.length + nearby.hospital.length + nearby.restaurant.length
        if (totalFound === 0) setNearbyError('No nearby places found in this area.')
      } catch (nearbyErr) {
        setNearbyError(nearbyErr.message || 'Nearby place search is temporarily unavailable.')
      }
      setNearbyLoading(false)
    } catch (err) {
      setError(err.message || 'Failed to calculate route. Try again.')
      setNearbyLoading(false)
    } finally { setLoading(false) }
  }

  // ── Switch nearby tab (instant, data already loaded)
  function loadNearby(type) {
    setNearbyTab(type)
    setSelectedPlace(null)   // clear path when switching tab
    setNearbyError(allNearby[type]?.length === 0 ? `No ${type} places found nearby.` : '')
  }

  // ── Handle nearby place click → show path on map
  function handlePlaceClick(p, type) {
    if (selectedPlace?.id === p.id) {
      setSelectedPlace(null)   // toggle off if same place clicked again
    } else {
      setSelectedPlace({ ...p, type })
      // Scroll map into view
      document.getElementById('rp-leaflet-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  // ── Live location detection
  async function handleLiveLocation() {
    if (!navigator.geolocation) {
      setLiveLocError('Geolocation is not supported by your browser.')
      return
    }
    setLiveLocLoading(true); setLiveLocError('')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        try {
          // Reverse geocode via Photon
          const res = await fetch(
            `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`,
            { headers: { 'Accept-Language': 'en' } }
          )
          const data = await res.json()
          const props = data.features?.[0]?.properties || {}
          const label = [props.name, props.street, props.city || props.town || props.village, props.state]
            .filter(Boolean).join(', ')
          const displayText = [props.name || props.street || '', props.city || props.town || props.village || ''].filter(Boolean).join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
          setOriginText(displayText)
          setOriginGeo({ lat, lng, label: label || displayText })
        } catch (_) {
          // Fallback: just use coordinates
          const displayText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
          setOriginText(displayText)
          setOriginGeo({ lat, lng, label: displayText })
        }
        setLiveLocLoading(false)
      },
      (err) => {
        const msgs = {
          1: 'Location access denied. Please allow location in browser settings.',
          2: 'Location unavailable. Check your GPS/network.',
          3: 'Location request timed out. Try again.',
        }
        setLiveLocError(msgs[err.code] || 'Could not get location.')
        setLiveLocLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  // ── Saved routes
  const loadSavedRoutes = useCallback(async () => {
    if (!user) return
    setRoutesLoading(true)
    const { data, error: err } = await supabase.from('saved_routes').select('*').order('created_at', { ascending: false }).limit(10)
    if (!err) setSavedRoutes(data || [])
    setRoutesLoading(false)
  }, [user])
  useEffect(() => { loadSavedRoutes() }, [loadSavedRoutes])

  async function handleSaveRoute() {
    if (!user) { onOpenAuth('login'); return }
    if (!selRoute || !originGeo || !destGeo) return
    setSaving(true); setSaveMsg('')
    const record = {
      user_id: user.id,
      route_title: `${originGeo.label.split(',')[0].trim()} → ${destGeo.label.split(',')[0].trim()}`,
      origin_name: originGeo.label, destination_name: destGeo.label,
      origin_lat: originGeo.lat, origin_lng: originGeo.lng,
      destination_lat: destGeo.lat, destination_lng: destGeo.lng,
      distance_km: selRoute.distanceKm, duration_seconds: selRoute.durationSec,
      duration_formatted: selRoute.durationFormatted,
      vehicle_type: vehicleType, fuel_type: fuelType,
      estimated_fuel_litres: fuelLitres, estimated_fuel_cost: fuelCost,
    }
    const { error: err } = await supabase.from('saved_routes').insert(record)
    if (err) setSaveMsg('❌ ' + err.message)
    else { setSaveMsg('✅ Route saved!'); loadSavedRoutes() }
    setSaving(false); setTimeout(() => setSaveMsg(''), 4000)
  }

  async function handleDeleteRoute(id) {
    await supabase.from('saved_routes').delete().eq('id', id)
    setSavedRoutes(prev => prev.filter(r => r.id !== id))
  }

  const placeIconFor = (type) => type === 'petrol' ? goldIcon : type === 'hospital' ? violetIcon : orangeIcon

  return (
    <div className="rp-page" id="rp-page">
      {/* ── Header ── */}
      <div className="rp-page-header">
        <div className="rp-page-header-inner">
          <div className="ar-badge"><span className="ar-badge-dot" />Route Planner</div>
          <h1 className="rp-page-title">Plan Your <span className="ar-gradient-text">Perfect Route</span></h1>
          <p className="rp-page-subtitle">Interactive maps, multiple routes, fuel cost & nearby places — all in one.</p>
        </div>
      </div>

      <div className="rp-layout">
        {/* ════ LEFT PANEL ════ */}
        <div className="rp-left">

          {/* ── 1. Source & Destination ── */}
          <div className="rp-card" id="rp-route-card">
            <div className="rp-card-header">
              <span className="rp-card-icon">📍</span>
              <h2 className="rp-card-title">Your Journey</h2>
            </div>
            <form onSubmit={handleCalculate} className="rp-form" id="rp-route-form">
              <PlaceInput
                id="rp-origin" label="Origin" emoji="🟢"
                placeholder="e.g. Mumbai, Maharashtra"
                value={originText} onChange={(value) => { setOriginText(value); setOriginGeo(null) }}
                onSelect={(geo) => setOriginGeo(geo)}
              />
              {/* ── Live Location Button ── */}
              <button
                type="button"
                id="rp-live-loc-btn"
                className="rp-live-loc-btn"
                onClick={handleLiveLocation}
                disabled={liveLocLoading}
                title="Use my current GPS location as origin"
              >
                {liveLocLoading
                  ? <><span className="ar-spinner" style={{width:'14px',height:'14px',borderWidth:'2px'}} /> Detecting…</>
                  : <>📡 Use My Live Location</>}
              </button>
              {liveLocError && <p className="ar-auth-error" role="alert" style={{fontSize:'0.78rem',marginTop:'-6px'}}>{liveLocError}</p>}
              <div className="rp-route-divider">
                <div className="rp-route-line" />
                <button type="button" className="rp-swap-btn" title="Swap" id="rp-swap-btn"
                  onClick={() => {
                    setOriginText(destText); setDestText(originText)
                    setOriginGeo(destGeo); setDestGeo(originGeo)
                  }}>⇅</button>
                <div className="rp-route-line" />
              </div>
              <PlaceInput
                id="rp-dest" label="Destination" emoji="🔴"
                placeholder="e.g. Pune, Maharashtra"
                value={destText} onChange={(value) => { setDestText(value); setDestGeo(null) }}
                onSelect={(geo) => setDestGeo(geo)}
              />
              {error && <p className="ar-auth-error" role="alert">{error}</p>}
              <button className="ar-btn-primary rp-calc-btn" id="rp-calculate-btn" type="submit" disabled={loading}>
                {loading ? <><span className="ar-spinner" /> Calculating…</> : '🗺️ Calculate Routes'}
              </button>
            </form>

            {/* Quick examples */}
            <div className="rp-examples-row">
              {[['Mumbai','Pune'],['Delhi','Agra'],['Bangalore','Mysore'],['Chennai','Pondicherry']].map(([o,d]) => (
                <span key={o} className="rp-example-chip"
                  onClick={() => { setOriginText(o); setDestText(d); setOriginGeo(null); setDestGeo(null) }}>
                  {o} → {d}
                </span>
              ))}
            </div>
          </div>

          {/* ── 4. Fuel Cost Calculator ── */}
          <div className="rp-card" id="rp-fuel-card">
            <div className="rp-card-header">
              <span className="rp-card-icon">⛽</span>
              <h2 className="rp-card-title">Fuel Cost Calculator</h2>
            </div>
            <div className="rp-fuel-grid">
              <div className="ar-field-group">
                <label className="ar-field-label" htmlFor="rp-vehicle">Vehicle Type</label>
                <select id="rp-vehicle" className="ar-field-input rp-select" value={vehicleType} onChange={e => setVehicleType(e.target.value)}>
                  <option value="car">🚗 Car</option>
                  <option value="bike">🏍️ Bike / Scooter</option>
                  <option value="suv">🚙 SUV</option>
                  <option value="truck">🚛 Heavy Truck</option>
                </select>
              </div>
              <div className="ar-field-group">
                <label className="ar-field-label" htmlFor="rp-fuel-type">Fuel Type</label>
                <select id="rp-fuel-type" className="ar-field-input rp-select" value={fuelType} onChange={e => setFuelType(e.target.value)}>
                  <option value="petrol">⛽ Petrol</option>
                  <option value="diesel">🛢️ Diesel</option>
                  <option value="cng">💨 CNG</option>
                </select>
              </div>
              <div className="ar-field-group">
                <label className="ar-field-label" htmlFor="rp-mileage">Mileage <span className="rp-unit">(km/L)</span></label>
                <input id="rp-mileage" className="ar-field-input" type="number" min="1" max="200" step="0.5"
                  value={mileage} onChange={e => setMileage(parseFloat(e.target.value) || 1)} />
              </div>
              <div className="ar-field-group">
                <label className="ar-field-label" htmlFor="rp-fuel-price">Fuel Price <span className="rp-unit">(₹/L)</span></label>
                <input id="rp-fuel-price" className="ar-field-input" type="number" min="1" max="999" step="0.5"
                  value={fuelPrice} onChange={e => setFuelPrice(parseFloat(e.target.value) || 1)} />
              </div>
            </div>
            {selRoute && (
              <div className="rp-fuel-preview">
                <div className="rp-fuel-formula">
                  <span className="rp-formula-text">Fuel = {selRoute.distanceKm} km ÷ {mileage} km/L = <strong>{fuelLitres} L</strong></span>
                  <span className="rp-formula-text">Cost = {fuelLitres} L × ₹{fuelPrice} = <strong>₹{fuelCost.toLocaleString('en-IN')}</strong></span>
                </div>
                <div className="rp-fuel-row rp-fuel-row-total">
                  <span>Total Fuel Cost</span>
                  <strong className="rp-fuel-cost">₹{fuelCost.toLocaleString('en-IN')}</strong>
                </div>
              </div>
            )}
          </div>

          {/* ── Saved Routes ── */}
          {user && (
            <div className="rp-card rp-saved-card" id="rp-saved-routes-card">
              <div className="rp-card-header">
                <span className="rp-card-icon">📁</span>
                <h2 className="rp-card-title">Saved Routes</h2>
                <button className="rp-refresh-btn" onClick={loadSavedRoutes} id="rp-refresh-btn">⟳</button>
              </div>
              {routesLoading ? (
                <div className="rp-routes-loading"><span className="ar-spinner" style={{ borderTopColor: '#6366f1' }} /></div>
              ) : savedRoutes.length === 0 ? (
                <p className="rp-no-routes">No saved routes yet.</p>
              ) : (
                <ul className="rp-routes-list" id="rp-routes-list">
                  {savedRoutes.map(r => (
                    <li className="rp-route-item" key={r.id} id={`rp-route-${r.id}`}>
                      <div className="rp-route-info">
                        <span className="rp-route-title">{r.route_title}</span>
                        <div className="rp-route-meta">
                          <span>📏 {r.distance_km} km</span>
                          <span>⏱️ {r.duration_formatted}</span>
                          <span>💰 ₹{parseFloat(r.estimated_fuel_cost || 0).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                      <div className="rp-route-actions">
                        <button className="rp-reuse-btn" title="Re-use" id={`rp-reuse-${r.id}`}
                          onClick={() => { setOriginText(r.origin_name.split(',')[0]); setDestText(r.destination_name.split(',')[0]); setOriginGeo(null); setDestGeo(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>↗</button>
                        <button className="rp-delete-btn" title="Delete" id={`rp-delete-${r.id}`}
                          onClick={() => handleDeleteRoute(r.id)}>🗑️</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ════ RIGHT PANEL ════ */}
        <div className="rp-right">

          {/* ── 1 & 2. Interactive Map + Routes ── */}
          <div className="rp-card rp-map-card" id="rp-map-card">
            <div className="rp-card-header">
              <span className="rp-card-icon">🗺️</span>
              <h2 className="rp-card-title">Interactive Map</h2>
              {selRoute && <span className="rp-map-badge">{selRoute.label}</span>}
            </div>

            <div className="rp-leaflet-wrap" id="rp-leaflet-map">
              <MapContainer
                center={[20.5937, 78.9629]}
                zoom={5}
                style={{ height: '360px', width: '100%', borderRadius: '12px' }}
                scrollWheelZoom={true}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {originGeo && <Marker position={[originGeo.lat, originGeo.lng]} icon={greenIcon}><Popup><strong>🟢 Origin</strong><br />{originGeo.label.split(',').slice(0,3).join(',')}</Popup></Marker>}
                {destGeo && <Marker position={[destGeo.lat, destGeo.lng]} icon={redIcon}><Popup><strong>🔴 Destination</strong><br />{destGeo.label.split(',').slice(0,3).join(',')}</Popup></Marker>}
                {/* Draw all route polylines */}
                {routes.map((r, i) => (
                  <Polyline key={i} positions={r.polyline}
                    pathOptions={{ color: r.color, weight: i === selRouteIdx ? 5 : 2, opacity: i === selRouteIdx ? 0.9 : 0.35, dashArray: i === selRouteIdx ? null : '8,6' }}
                  />
                ))}
                {/* Nearby place markers — click to show path */}
                {nearbyPlaces.map(p => (
                  <Marker
                    key={p.id}
                    position={[p.lat, p.lng]}
                    icon={selectedPlace?.id === p.id ? greenIcon : placeIconFor(nearbyTab)}
                    eventHandlers={{ click: () => handlePlaceClick(p, nearbyTab) }}
                  >
                    <Popup>
                      <strong>{p.name}</strong>
                      {p.brand && <><br/><span style={{color:'#94a3b8'}}>{p.brand}</span></>}
                      {p.dist && <><br/><span style={{color:'#6366f1',fontWeight:600}}>📏 {p.dist}</span></>}
                      {p.address && <><br/>{p.address}</>}
                      <br/>
                      <button
                        onClick={() => handlePlaceClick(p, nearbyTab)}
                        style={{marginTop:'6px',padding:'3px 10px',background:'#6366f1',color:'#fff',border:'none',borderRadius:'6px',cursor:'pointer',fontSize:'0.75rem'}}
                      >
                        {selectedPlace?.id === p.id ? '✕ Clear Path' : '🗺️ Show Path'}
                      </button>
                    </Popup>
                  </Marker>
                ))}
                {/* Path from origin → selected nearby place */}
                {selectedPlace && originGeo && (
                  <Polyline
                    positions={[[originGeo.lat, originGeo.lng], [selectedPlace.lat, selectedPlace.lng]]}
                    pathOptions={{ color: '#06b6d4', weight: 4, opacity: 0.9, dashArray: '10,6' }}
                  />
                )}
                {mapBounds && <MapFit bounds={mapBounds} />}
              </MapContainer>
            </div>

            {!selRoute && (
              <p className="rp-map-hint">🗺️ Enter origin &amp; destination above to see the route on the map.</p>
            )}
            {/* ── Selected place path info banner ── */}
            {selectedPlace && originGeo && (
              <div className="rp-place-path-banner" id="rp-place-path-banner">
                <div className="rp-ppb-left">
                  <span className="rp-ppb-icon">
                    {selectedPlace.type === 'petrol' ? '⛽' : selectedPlace.type === 'hospital' ? '🏥' : '🍽️'}
                  </span>
                  <div>
                    <span className="rp-ppb-name">{selectedPlace.name}</span>
                    <span className="rp-ppb-meta">📏 {selectedPlace.dist} &nbsp;·&nbsp; <span style={{color:'#06b6d4'}}>━ ━</span> Path shown on map</span>
                  </div>
                </div>
                <button className="rp-ppb-close" onClick={() => setSelectedPlace(null)} title="Clear path">✕</button>
              </div>
            )}
          </div>

          {/* ── 2. Multiple Route Suggestions ── */}
          {routes.length > 0 && (
            <div className="rp-card" id="rp-routes-card">
              <div className="rp-card-header">
                <span className="rp-card-icon">🛣️</span>
                <h2 className="rp-card-title">Route Options</h2>
                <span className="rp-badge-count">{routes.length} routes</span>
              </div>
              <div className="rp-route-options" id="rp-route-options">
                {routes.map((r, i) => (
                  <div
                    key={i}
                    className={`rp-route-option ${i === selRouteIdx ? 'rp-route-option-active' : ''}`}
                    id={`rp-route-option-${i}`}
                    onClick={() => setSelRouteIdx(i)}
                    style={{ '--route-color': r.color }}
                  >
                    <div className="rp-option-top">
                      <span className="rp-option-label">{r.label}</span>
                      {i === 0 && <span className="rp-option-tag">Recommended</span>}
                    </div>
                    <div className="rp-option-stats">
                      <span>📏 {r.distanceKm} km</span>
                      <span>⏱️ {r.durationFormatted}</span>
                      <span>💰 ₹{parseFloat((r.distanceKm / mileage * fuelPrice).toFixed(0)).toLocaleString('en-IN')}</span>
                    </div>
                    <p className="rp-option-desc">{r.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 3. Distance & Time Stats ── */}
          {selRoute && (
            <div className="rp-card" id="rp-results-card">
              <div className="rp-card-header">
                <span className="rp-card-icon">📊</span>
                <h2 className="rp-card-title">Trip Summary</h2>
              </div>
              <div className="rp-route-path">
                <div className="rp-route-node"><span className="rp-node-dot rp-node-green" /><span className="rp-node-label">{originGeo?.label.split(',').slice(0,2).join(',')}</span></div>
                <div className="rp-path-line" />
                <div className="rp-route-node"><span className="rp-node-dot rp-node-red" /><span className="rp-node-label">{destGeo?.label.split(',').slice(0,2).join(',')}</span></div>
              </div>
              <div className="rp-stats-row">
                <div className="rp-stat-box"><span className="rp-stat-icon">📏</span><span className="rp-stat-value">{selRoute.distanceKm} km</span><span className="rp-stat-label">Distance</span></div>
                <div className="rp-stat-box"><span className="rp-stat-icon">⏱️</span><span className="rp-stat-value">{selRoute.durationFormatted}</span><span className="rp-stat-label">Travel Time</span></div>
                <div className="rp-stat-box rp-stat-box-accent"><span className="rp-stat-icon">💰</span><span className="rp-stat-value">₹{fuelCost.toLocaleString('en-IN')}</span><span className="rp-stat-label">Fuel Cost</span></div>
              </div>
              <button className="ar-btn-primary rp-save-btn" id="rp-save-btn" onClick={handleSaveRoute} disabled={saving}>
                {saving ? <><span className="ar-spinner" /> Saving…</> : user ? '💾 Save This Route' : '🔒 Login to Save'}
              </button>
              {saveMsg && <p className={`rp-save-msg ${saveMsg.startsWith('✅') ? 'rp-save-ok' : 'rp-save-err'}`}>{saveMsg}</p>}
            </div>
          )}

          {/* ── 5. Nearby Places ── */}
          {selRoute && (
            <div className="rp-card" id="rp-nearby-card">
              <div className="rp-card-header">
                <span className="rp-card-icon">📌</span>
                <h2 className="rp-card-title">Nearby Places</h2>
                <span className="rp-badge-count">near origin</span>
              </div>
              {/* Tabs */}
              <div className="rp-nearby-tabs" id="rp-nearby-tabs">
                {[
                  { key: 'petrol',     emoji: '⛽', label: 'Petrol Pumps' },
                  { key: 'hospital',   emoji: '🏥', label: 'Hospitals' },
                  { key: 'restaurant', emoji: '🍽️', label: 'Restaurants' },
                ].map(t => (
                  <button
                    key={t.key}
                    className={`rp-nearby-tab ${nearbyTab === t.key ? 'rp-nearby-tab-active' : ''}`}
                    id={`rp-tab-${t.key}`}
                    onClick={() => loadNearby(t.key)}
                  >
                    {t.emoji} {t.label}
                    {!nearbyLoading && allNearby[t.key]?.length > 0 && (
                      <span className="rp-tab-count">{allNearby[t.key].length}</span>
                    )}
                  </button>
                ))}
              </div>
              {/* Results */}
              {nearbyLoading && (
                <div className="rp-nearby-loading-all">
                  <span className="ar-spinner" style={{ borderTopColor: '#6366f1' }} />
                  <span className="rp-nearby-loading-txt">Fetching nearby petrol pumps, hospitals &amp; restaurants…</span>
                </div>
              )}
              {nearbyError && !nearbyLoading && <p className="rp-no-routes">{nearbyError}</p>}
              {!nearbyLoading && nearbyPlaces.length > 0 && (
                <ul className="rp-nearby-list" id="rp-nearby-list">
                  {nearbyPlaces.slice(0, 10).map((p, i) => (
                    <li
                      className={`rp-nearby-item ${selectedPlace?.id === p.id ? 'rp-nearby-item-active' : ''}`}
                      key={p.id || i}
                      id={`rp-nearby-${i}`}
                      onClick={() => handlePlaceClick(p, nearbyTab)}
                      title="Click to show path on map"
                      style={{ cursor: 'pointer' }}
                    >
                      <span className="rp-nearby-icon">
                        {nearbyTab === 'petrol' ? '⛽' : nearbyTab === 'hospital' ? '🏥' : '🍽️'}
                      </span>
                      <div className="rp-nearby-info">
                        <span className="rp-nearby-name">{p.name}</span>
                        {p.dist && <span className="rp-nearby-brand" style={{color:'#6366f1'}}>📏 {p.dist}</span>}
                        {p.brand && <span className="rp-nearby-brand">{p.brand}</span>}
                        {p.address && <span className="rp-nearby-addr">📍 {p.address}</span>}
                        {p.phone && <span className="rp-nearby-addr">📞 {p.phone}</span>}
                        {p.opening && <span className="rp-nearby-addr">🕐 {p.opening}</span>}
                      </div>
                      <span className="rp-nearby-path-btn" title="Show path">
                        {selectedPlace?.id === p.id ? '✕' : '🗺️'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!nearbyLoading && nearbyPlaces.length === 0 && !nearbyError && (
                <p className="rp-no-routes">No {nearbyTab} places found near your origin. Try a different city.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   LANDING PAGE
══════════════════════════════════════════════════════════════════ */
function LandingPage({ user, onOpenAuth, onGoToPlanner }) {
  return (
    <>
      <section className="ar-hero" id="ar-hero">
        <div className="ar-hero-bg">
          <img src="/hero_bg.jpg" alt="Route map background" className="ar-hero-img" />
          <div className="ar-hero-overlay" />
        </div>
        <div className="ar-hero-content">
          <div className="ar-badge" id="ar-hero-badge"><span className="ar-badge-dot" />India's Smart Route Planner</div>
          <h1 className="ar-hero-title" id="ar-hero-title">Plan Smarter.<br /><span className="ar-gradient-text">Travel Better.</span></h1>
          <p className="ar-hero-subtitle">Interactive maps, multiple route options, fuel cost calculator and nearby places — all in one app.</p>
          <div className="ar-hero-actions">
            <button className="ar-btn-primary ar-btn-lg" id="ar-hero-cta" onClick={onGoToPlanner}>
              🚗 {user ? 'Open Route Planner' : 'Start Planning Free'}
            </button>
            {!user && <button className="ar-btn-outline ar-btn-lg" id="ar-hero-login" onClick={() => onOpenAuth('login')}>Login →</button>}
          </div>
          <div className="ar-hero-chips">
            <span className="ar-chip">🗺️ Interactive Map</span>
            <span className="ar-chip">🛣️ Multiple Routes</span>
            <span className="ar-chip">⛽ Fuel Calculator</span>
            <span className="ar-chip">📌 Nearby Places</span>
          </div>
        </div>
        <div className="ar-hero-scroll-hint" id="ar-scroll-hint"><span>Scroll to explore</span><div className="ar-scroll-arrow" /></div>
      </section>

      <section className="ar-stats-strip" id="stats">
        <div className="ar-stats-inner">
          {[{ value:'10K+',label:'Routes Planned'},{value:'₹2Cr+',label:'Fuel Cost Saved'},{value:'500+',label:'Cities Covered'},{value:'4.9★',label:'User Rating'}].map(s => (
            <div className="ar-stat" key={s.label}><span className="ar-stat-value">{s.value}</span><span className="ar-stat-label">{s.label}</span></div>
          ))}
        </div>
      </section>

      <section className="ar-features" id="features">
        <div className="ar-section-header">
          <span className="ar-section-tag">Features</span>
          <h2 className="ar-section-title">Everything you need for the road</h2>
          <p className="ar-section-sub">From planning to savings — Apna Route has it all covered.</p>
        </div>
        <div className="ar-features-grid" id="ar-features-grid">
          {[
            {icon:'🗺️',title:'Interactive Map',desc:'Real interactive map powered by OpenStreetMap. See your route drawn live with origin & destination markers.',color:'#6366f1'},
            {icon:'🛣️',title:'Multiple Routes',desc:'Get 3 alternative route suggestions — Fastest, Balanced, and Scenic — and choose the best one for you.',color:'#10b981'},
            {icon:'⛽',title:'Fuel Cost Calculator',desc:"Enter your vehicle's mileage and fuel price to instantly calculate fuel required and total trip cost.",color:'#f59e0b'},
            {icon:'📌',title:'Nearby Places',desc:'Find petrol pumps, hospitals, and restaurants near your starting point using live OpenStreetMap data.',color:'#ec4899'},
            {icon:'💾',title:'Save Your Routes',desc:'Save favourite routes to your account and re-use them anytime with a single tap.',color:'#8b5cf6'},
            {icon:'🔒',title:'Secure & Private',desc:'Protected by Supabase Auth and Row Level Security — your routes are visible only to you.',color:'#06b6d4'},
          ].map(f => (
            <div className="ar-feature-card" key={f.title} id={`ar-feature-${f.title.replace(/\s+/g,'-').toLowerCase()}`}>
              <div className="ar-feature-icon-wrap" style={{background:`${f.color}1a`,border:`1px solid ${f.color}33`}}><span className="ar-feature-icon">{f.icon}</span></div>
              <h3 className="ar-feature-title">{f.title}</h3>
              <p className="ar-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="ar-how" id="how-it-works">
        <div className="ar-section-header">
          <span className="ar-section-tag">How It Works</span>
          <h2 className="ar-section-title">Ready in 3 simple steps</h2>
        </div>
        <div className="ar-steps" id="ar-steps">
          {[
            {step:'01',icon:'👤',title:'Create Your Account',desc:'Sign up for free in under 30 seconds.'},
            {step:'02',icon:'🗺️',title:'Plan Your Route',desc:'Enter origin & destination. Pick from 3 route options and get fuel cost instantly.'},
            {step:'03',icon:'💰',title:'Save & Explore',desc:'Save routes to your dashboard and discover nearby petrol pumps, hospitals & restaurants.'},
          ].map((s,i) => (
            <div className="ar-step" key={s.step} id={`ar-step-${i+1}`}>
              <div className="ar-step-number">{s.step}</div>
              <div className="ar-step-icon">{s.icon}</div>
              <h3 className="ar-step-title">{s.title}</h3>
              <p className="ar-step-desc">{s.desc}</p>
              {i < 2 && <div className="ar-step-connector" />}
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          ABOUT US SECTION
      ══════════════════════════════════════════════════════════════════ */}
      <section className="ar-about" id="about">
        <div className="ar-section-header">
          <span className="ar-section-tag">About Us</span>
          <h2 className="ar-section-title">Built for <span className="ar-gradient-text">Every Indian Traveller</span></h2>
          <p className="ar-section-sub">ApnaRoute is a free, open-source route planning platform designed specifically for India — covering cities, towns, villages and hamlets across all states.</p>
        </div>

        {/* Mission */}
        <div className="ar-about-mission" id="ar-about-mission">
          <div className="ar-mission-icon">🇮🇳</div>
          <div className="ar-mission-text">
            <h3 className="ar-mission-title">Our Mission</h3>
            <p className="ar-mission-desc">To make intelligent travel planning accessible to every Indian — from metro cities to remote villages — completely free, with no ads and no data selling. We believe great tools shouldn't cost money.</p>
          </div>
        </div>

        <div className="ar-about-highlights" id="ar-about-highlights">
          <div className="ar-about-highlight-header">
            <h3 className="ar-about-subtitle">Why travellers choose ApnaRoute</h3>
            <p className="ar-about-subtitle-sub">Practical tools built for the real journeys people take every day across India.</p>
          </div>
          <div className="ar-about-highlight-grid">
            {[
              { icon: '🚗', title: 'Smarter trip planning', desc: 'Compare route options before you travel and reduce wrong turns, delays, and fuel waste.', color: '#6366f1' },
              { icon: '💸', title: 'Fuel cost clarity', desc: 'Know your true trip cost in seconds with mileage and fuel pricing built into every route.', color: '#f59e0b' },
              { icon: '🏡', title: 'Built for India', desc: 'Works for metro cities, towns, villages, and remote stretches where route planning is often most difficult.', color: '#10b981' },
              { icon: '🛟', title: 'Travel confidence', desc: 'Find nearby fuel stations, hospitals, and food stops so every trip feels safer and easier.', color: '#ec4899' },
            ].map(item => (
              <div className="ar-about-highlight-card" key={item.title} style={{ '--highlight-color': item.color }}>
                <div className="ar-about-highlight-icon" style={{ background: `${item.color}20`, border: `1px solid ${item.color}40` }}>{item.icon}</div>
                <h4>{item.title}</h4>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* All Features Grid */}
        <div className="ar-about-features-header">
          <h3 className="ar-about-subtitle">✅ Everything That's Working Right Now</h3>
          <p className="ar-about-subtitle-sub">All features below are live and functional in the app</p>
        </div>
        <div className="ar-about-features-grid" id="ar-about-features-grid">
          {[
            {
              icon: '🗺️', color: '#6366f1',
              title: 'Interactive Map',
              desc: 'Real Leaflet + OpenStreetMap powered map. Zoom, pan, and see your full route drawn live with colour-coded polylines for each route option.',
              badge: 'Live'
            },
            {
              icon: '📡', color: '#06b6d4',
              title: 'Live GPS Location',
              desc: "Click '📡 Use My Live Location' to auto-detect your current position using your device's GPS and fill Origin instantly.",
              badge: 'New'
            },
            {
              icon: '🛣️', color: '#10b981',
              title: '3 Route Options',
              desc: 'Get Fastest ⚡, Balanced 🛣️ and Scenic 🌿 route suggestions. Each shows distance, time and estimated fuel cost.',
              badge: 'Live'
            },
            {
              icon: '🏘️', color: '#f59e0b',
              title: 'Village & Town Search',
              desc: 'Search any Indian village, hamlet, taluka or town — not just big cities. Powered by Photon geocoding with Nominatim fallback.',
              badge: 'New'
            },
            {
              icon: '⛽', color: '#f59e0b',
              title: 'Fuel Cost Calculator',
              desc: 'Select vehicle type (Car/Bike/SUV/Truck) and fuel type (Petrol/Diesel/CNG). Instantly calculates litres needed and total ₹ cost.',
              badge: 'Live'
            },
            {
              icon: '📌', color: '#ec4899',
              title: 'Nearby Places',
              desc: 'Find petrol pumps ⛽, hospitals 🏥 and restaurants 🍽️ near your origin — fetched live from OpenStreetMap via Overpass API. Sorted by distance.',
              badge: 'Live'
            },
            {
              icon: '🗺️', color: '#8b5cf6',
              title: 'Path to Nearby Places',
              desc: 'Click any petrol pump, hospital or restaurant marker or list item — a cyan dashed path is drawn from your origin to that place on the map.',
              badge: 'New'
            },
            {
              icon: '💾', color: '#8b5cf6',
              title: 'Save & Re-use Routes',
              desc: 'Login and save your favourite routes to your personal dashboard. Re-use any saved route with one click anytime.',
              badge: 'Live'
            },
            {
              icon: '🔒', color: '#06b6d4',
              title: 'Secure Authentication',
              desc: 'Sign up / login with email. Powered by Supabase Auth + Row Level Security — your data is 100% private, visible only to you.',
              badge: 'Live'
            },
          ].map(f => (
            <div className="ar-about-feat-card" key={f.title} style={{ '--feat-color': f.color }}>
              <div className="ar-about-feat-top">
                <div className="ar-about-feat-icon-wrap" style={{ background: `${f.color}20`, border: `1px solid ${f.color}40` }}>
                  <span style={{ fontSize: '1.4rem' }}>{f.icon}</span>
                </div>
                <span className={`ar-about-badge ${f.badge === 'New' ? 'ar-about-badge-new' : 'ar-about-badge-live'}`}>
                  {f.badge === 'New' ? '✨ New' : '🟢 Live'}
                </span>
              </div>
              <h4 className="ar-about-feat-title">{f.title}</h4>
              <p className="ar-about-feat-desc">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Tech Stack */}
        <div className="ar-tech-stack" id="ar-tech-stack">
          <h3 className="ar-tech-title">🔧 Built With (100% Free Stack)</h3>
          <div className="ar-tech-grid">
            {[
              { name: 'React + Vite', role: 'Frontend framework', color: '#61dafb' },
              { name: 'Leaflet.js', role: 'Interactive maps', color: '#199900' },
              { name: 'OpenStreetMap', role: 'Map tiles', color: '#7ebc6f' },
              { name: 'Photon API', role: 'Village geocoding', color: '#f59e0b' },
              { name: 'Overpass API', role: 'Nearby places data', color: '#ec4899' },
              { name: 'Supabase', role: 'Auth + Database', color: '#3ecf8e' },
              { name: 'Browser GPS', role: 'Live location', color: '#06b6d4' },
              { name: 'Python Flask', role: 'Backend API', color: '#6366f1' },
            ].map(t => (
              <div className="ar-tech-item" key={t.name} style={{ '--tech-color': t.color }}>
                <span className="ar-tech-dot" style={{ background: t.color }} />
                <div>
                  <span className="ar-tech-name">{t.name}</span>
                  <span className="ar-tech-role">{t.role}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ar-cta-banner" id="ar-cta-banner">
        <div className="ar-cta-content">
          <h2 className="ar-cta-title">Ready to hit the road smarter?</h2>
          <p className="ar-cta-sub">Join thousands of Indian travellers who plan and save with Apna Route.</p>
          <button className="ar-btn-primary ar-btn-lg ar-btn-white" id="ar-cta-signup" onClick={onGoToPlanner}>
            {user ? '🗺️ Go to Route Planner' : "🎯 Start Planning — It's Free"}
          </button>
        </div>
        <div className="ar-cta-decoration">🚗</div>
      </section>

      <footer className="ar-footer" id="ar-footer">
        <div className="ar-footer-inner">
          <div className="ar-footer-brand"><span className="ar-logo-icon">🗺️</span><span className="ar-logo-text">Apna<span className="ar-logo-accent">Route</span></span></div>
          <p className="ar-footer-copy">© {new Date().getFullYear()} ApnaRoute. Built with ❤️ for Indian travellers.</p>
          <div className="ar-footer-links">
            <a href="#about" className="ar-footer-link">About Us</a>
            <a href="#" className="ar-footer-link">Privacy</a>
            <a href="#" className="ar-footer-link">Terms</a>
            <a href="#" className="ar-footer-link">Contact</a>
          </div>
        </div>
      </footer>
    </>
  )
}

/* ══════════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════════ */
function App() {
  const [authModal, setAuthModal] = useState(null)
  const [user, setUser]   = useState(null)
  const [page, setPage]   = useState('landing')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') setAuthModal(null) }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  async function handleSignOut() { await supabase.auth.signOut(); setUser(null); setPage('landing') }

  return (
    <div className="ar-root">
      <nav className="ar-nav" id="ar-navbar">
        <div className="ar-nav-inner">
          <div className="ar-logo" id="ar-logo" style={{ cursor:'pointer' }} onClick={() => setPage('landing')}>
            <span className="ar-logo-icon">🗺️</span>
            <span className="ar-logo-text">Apna<span className="ar-logo-accent">Route</span></span>
          </div>
          <div className="ar-nav-links" id="ar-nav-links">
            {page === 'landing' ? (
              <><a href="#features" className="ar-nav-link">Features</a><a href="#how-it-works" className="ar-nav-link">How It Works</a><a href="#about" className="ar-nav-link">About</a><a href="#stats" className="ar-nav-link">Stats</a></>
            ) : (
              <button className="ar-nav-link" style={{background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}} onClick={() => setPage('landing')}>← Back to Home</button>
            )}
          </div>
          <div className="ar-nav-actions">
            <button className={`ar-nav-planner-btn${page==='planner'?' ar-nav-planner-active':''}`} id="ar-nav-planner" onClick={() => setPage('planner')}>🗺️ Route Planner</button>
            {user ? <UserMenu user={user} onSignOut={handleSignOut} /> : (
              <><button className="ar-btn-ghost" id="ar-login-btn" onClick={() => setAuthModal('login')}>Login</button>
              <button className="ar-btn-primary" id="ar-register-btn" onClick={() => setAuthModal('signup')}>Get Started</button></>
            )}
          </div>
        </div>
      </nav>

      <main className={page === 'planner' ? 'ar-page-planner' : ''}>
        {page === 'landing'
          ? <LandingPage user={user} onOpenAuth={m => setAuthModal(m)} onGoToPlanner={() => setPage('planner')} />
          : <RoutePlannerPage user={user} onOpenAuth={m => setAuthModal(m)} />
        }
      </main>

      {authModal && (
        <AuthModal mode={authModal} onClose={() => setAuthModal(null)}
          onSwitch={() => setAuthModal(authModal==='login'?'signup':'login')}
          onSuccess={u => { setUser(u); setAuthModal(null) }} />
      )}
    </div>
  )
}

export default App
