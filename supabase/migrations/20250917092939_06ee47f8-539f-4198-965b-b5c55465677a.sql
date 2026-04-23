-- Create custom types
CREATE TYPE public.user_role AS ENUM ('owner', 'worker');

-- Create accounts table
CREATE TABLE public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create profiles table (extends Supabase auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,
    email TEXT NOT NULL,
    role public.user_role NOT NULL DEFAULT 'worker',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create products table
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    category TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    purchase_price DECIMAL(10,2),
    selling_price DECIMAL(10,2) NOT NULL,
    gst DECIMAL(5,2) DEFAULT 0,
    supplier TEXT,
    low_stock_threshold INTEGER DEFAULT 10,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create sales table
CREATE TABLE public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    gst_amount DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create settings table
CREATE TABLE public.settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL UNIQUE,
    currency TEXT DEFAULT 'INR',
    gst_enabled BOOLEAN DEFAULT true,
    default_gst_rate DECIMAL(5,2) DEFAULT 18.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Helper function to get user's account_id
CREATE OR REPLACE FUNCTION public.get_user_account_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT account_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Helper function to check if user is owner
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role = 'owner' FROM public.profiles WHERE id = auth.uid();
$$;

-- RLS Policies for accounts
CREATE POLICY "Users can view their own account"
ON public.accounts FOR SELECT
TO authenticated
USING (id = public.get_user_account_id());

CREATE POLICY "Owners can update their account"
ON public.accounts FOR UPDATE
TO authenticated
USING (id = public.get_user_account_id() AND public.is_owner());

-- RLS Policies for profiles
CREATE POLICY "Users can view profiles in their account"
ON public.profiles FOR SELECT
TO authenticated
USING (account_id = public.get_user_account_id());

CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Owners can manage profiles in their account"
ON public.profiles FOR ALL
TO authenticated
USING (account_id = public.get_user_account_id() AND public.is_owner());

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- RLS Policies for products
CREATE POLICY "Users can view products in their account"
ON public.products FOR SELECT
TO authenticated
USING (account_id = public.get_user_account_id());

CREATE POLICY "Owners can manage products"
ON public.products FOR ALL
TO authenticated
USING (account_id = public.get_user_account_id() AND public.is_owner());

-- RLS Policies for sales
CREATE POLICY "Users can view sales in their account"
ON public.sales FOR SELECT
TO authenticated
USING (account_id = public.get_user_account_id());

CREATE POLICY "Users can create sales in their account"
ON public.sales FOR INSERT
TO authenticated
WITH CHECK (account_id = public.get_user_account_id());

CREATE POLICY "Owners can manage all sales in their account"
ON public.sales FOR ALL
TO authenticated
USING (account_id = public.get_user_account_id() AND public.is_owner());

-- RLS Policies for settings
CREATE POLICY "Users can view settings in their account"
ON public.settings FOR SELECT
TO authenticated
USING (account_id = public.get_user_account_id());

CREATE POLICY "Owners can manage settings"
ON public.settings FOR ALL
TO authenticated
USING (account_id = public.get_user_account_id() AND public.is_owner());

-- Function to update product stock after sale
CREATE OR REPLACE FUNCTION public.update_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update product quantity
  UPDATE public.products 
  SET quantity = quantity - NEW.quantity,
      updated_at = NOW()
  WHERE id = NEW.product_id;
  
  -- Check if update was successful
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger to update stock on sale
CREATE TRIGGER update_product_stock_trigger
  AFTER INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.update_product_stock();

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_account_id UUID;
BEGIN
  -- Create new account for first user (owner)
  INSERT INTO public.accounts (name)
  VALUES (COALESCE(NEW.raw_user_meta_data ->> 'company_name', 'My Store'))
  RETURNING id INTO new_account_id;
  
  -- Create profile
  INSERT INTO public.profiles (id, account_id, email, role)
  VALUES (NEW.id, new_account_id, NEW.email, 'owner');
  
  -- Create default settings
  INSERT INTO public.settings (account_id)
  VALUES (new_account_id);
  
  RETURN NEW;
END;
$$;

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Triggers for updated_at
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();