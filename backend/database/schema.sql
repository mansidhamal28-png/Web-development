-- ==============================================================================
-- Apna Route - Supabase PostgreSQL Complete Database Schema
-- Includes: Profiles, User Preferences, Saved Routes, Travel Calculations,
--           Foreign Keys to auth.users, Automatic Trigger, Indexes,
--           and Strict Row Level Security (RLS) Policies.
-- ==============================================================================

-- 1. Table: Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(150),
    email VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. Table: User Preferences
CREATE TABLE IF NOT EXISTS public.user_preferences (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    preferred_vehicle_type VARCHAR(50) DEFAULT 'car',
    default_fuel_type VARCHAR(50) DEFAULT 'petrol',
    default_mileage NUMERIC(6, 2) DEFAULT 15.00,
    unit_system VARCHAR(20) DEFAULT 'metric',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. Table: Saved Routes
CREATE TABLE IF NOT EXISTS public.saved_routes (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    route_title VARCHAR(200) NOT NULL,
    origin_name VARCHAR(255) NOT NULL,
    destination_name VARCHAR(255) NOT NULL,
    origin_lat NUMERIC(10, 7) NOT NULL,
    origin_lng NUMERIC(10, 7) NOT NULL,
    destination_lat NUMERIC(10, 7) NOT NULL,
    destination_lng NUMERIC(10, 7) NOT NULL,
    distance_km NUMERIC(8, 2) NOT NULL,
    duration_seconds NUMERIC(10, 2) NOT NULL,
    duration_formatted VARCHAR(100) NOT NULL,
    vehicle_type VARCHAR(50) DEFAULT 'car',
    fuel_type VARCHAR(50) DEFAULT 'petrol',
    estimated_fuel_litres NUMERIC(8, 2) DEFAULT 0.00,
    estimated_fuel_cost NUMERIC(10, 2) DEFAULT 0.00,
    route_geometry JSONB,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. Table: Travel Calculations
CREATE TABLE IF NOT EXISTS public.travel_calculations (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    trip_title VARCHAR(200) NOT NULL,
    distance_km NUMERIC(8, 2) NOT NULL,
    mileage_km_per_litre NUMERIC(6, 2) NOT NULL,
    fuel_price_per_litre NUMERIC(8, 2) NOT NULL,
    fuel_required_litres NUMERIC(8, 2) NOT NULL,
    total_fuel_cost NUMERIC(10, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_saved_routes_user_id ON public.saved_routes(user_id);
CREATE INDEX IF NOT EXISTS idx_travel_calculations_user_id ON public.travel_calculations(user_id);

-- 6. Trigger: Automatically create Profile & Preferences on Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.email
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Row Level Security (RLS) Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_calculations ENABLE ROW LEVEL SECURITY;

-- 7.1 Profiles Policies
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 7.2 Preferences Policies
CREATE POLICY "Users can view own preferences" ON public.user_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own preferences" ON public.user_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7.3 Saved Routes Policies
CREATE POLICY "Users can view own saved routes" ON public.saved_routes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own saved routes" ON public.saved_routes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own saved routes" ON public.saved_routes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own saved routes" ON public.saved_routes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 7.4 Travel Calculations Policies
CREATE POLICY "Users can view own calculations" ON public.travel_calculations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own calculations" ON public.travel_calculations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own calculations" ON public.travel_calculations FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 8. Table Permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.user_preferences TO authenticated;
GRANT ALL ON TABLE public.saved_routes TO authenticated;
GRANT ALL ON TABLE public.travel_calculations TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
