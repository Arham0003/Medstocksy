export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          account_id: string
          batch_number: string | null
          category: string | null
          created_at: string | null
          expiry_date: string | null
          gst: number | null
          hsn_code: string | null
          id: string
          low_stock_threshold: number | null
          manufacturer: string | null
          name: string
          pcs_per_unit: number | null
          purchase_price: number | null
          quantity: number
          selling_price: number
          sku: string | null
          supplier: string | null
          supplier_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          batch_number?: string | null
          category?: string | null
          created_at?: string | null
          expiry_date?: string | null
          gst?: number | null
          hsn_code?: string | null
          id?: string
          low_stock_threshold?: number | null
          manufacturer?: string | null
          name: string
          pcs_per_unit?: number | null
          purchase_price?: number | null
          quantity?: number
          selling_price: number
          sku?: string | null
          supplier?: string | null
          supplier_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          batch_number?: string | null
          category?: string | null
          created_at?: string | null
          expiry_date?: string | null
          gst?: number | null
          hsn_code?: string | null
          id?: string
          low_stock_threshold?: number | null
          manufacturer?: string | null
          name?: string
          pcs_per_unit?: number | null
          purchase_price?: number | null
          quantity?: number
          selling_price?: number
          sku?: string | null
          supplier?: string | null
          supplier_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          id: string
          account_id: string
          supplier_code: string
          name: string
          contact_person: string | null
          phone: string | null
          email: string | null
          address: string | null
          gst_number: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          account_id: string
          supplier_code: string
          name: string
          contact_person?: string | null
          phone?: string | null
          email?: string | null
          address?: string | null
          gst_number?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          account_id?: string
          supplier_code?: string
          name?: string
          contact_person?: string | null
          phone?: string | null
          email?: string | null
          address?: string | null
          gst_number?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          id: string
          account_id: string
          supplier_id: string
          amount: number
          payment_type: string
          payment_date: string
          notes: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          account_id: string
          supplier_id: string
          amount: number
          payment_type?: string
          payment_date?: string
          notes?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          account_id?: string
          supplier_id?: string
          amount?: number
          payment_type?: string
          payment_date?: string
          notes?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_id: string
          created_at: string | null
          email: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          account_id: string
          created_at?: string | null
          email: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          account_id?: string
          created_at?: string | null
          email?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          account_id: string
          created_at: string | null
          gst_amount: number | null
          id: string
          product_id: string
          quantity: number
          total_price: number
          unit_price: number
          user_id: string
          // Added customer fields
          customer_name: string | null
          customer_phone: string | null
          customer_email: string | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          gst_amount?: number | null
          id?: string
          product_id: string
          quantity: number
          total_price: number
          unit_price: number
          user_id: string
          // Added customer fields
          customer_name?: string | null
          customer_phone?: string | null
          customer_email?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          gst_amount?: number | null
          id?: string
          product_id?: string
          quantity?: number
          total_price?: number
          unit_price?: number
          user_id?: string
          // Added customer fields
          customer_name?: string | null
          customer_phone?: string | null
          customer_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          account_id: string
          created_at: string | null
          currency: string | null
          default_gst_rate: number | null
          gst_enabled: boolean | null
          id: string
          updated_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          currency?: string | null
          default_gst_rate?: number | null
          gst_enabled?: boolean | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          currency?: string | null
          default_gst_rate?: number | null
          gst_enabled?: boolean | null
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_account_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      is_owner: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      user_role: "owner" | "worker"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      user_role: ["owner", "worker"],
    },
  },
} as const
