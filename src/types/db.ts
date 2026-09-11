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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_contents: {
        Row: {
          ai_disclaimer: string
          ai_generated: boolean
          ai_generated_at: string
          ai_model: string
          ai_prompt_ver: string
          body_md: string
          cost_usd: number | null
          created_at: string
          eli_address: string | null
          human_reviewed_at: string | null
          human_reviewed_by: string | null
          id: string
          input_tokens: number | null
          kind: Database["public"]["Enums"]["ai_content_kind"]
          output_tokens: number | null
          print_number: string | null
          promise_id: string | null
          published: boolean
          source_id: string
          voting_id: number | null
        }
        Insert: {
          ai_disclaimer?: string
          ai_generated?: boolean
          ai_generated_at?: string
          ai_model: string
          ai_prompt_ver: string
          body_md: string
          cost_usd?: number | null
          created_at?: string
          eli_address?: string | null
          human_reviewed_at?: string | null
          human_reviewed_by?: string | null
          id?: string
          input_tokens?: number | null
          kind: Database["public"]["Enums"]["ai_content_kind"]
          output_tokens?: number | null
          print_number?: string | null
          promise_id?: string | null
          published?: boolean
          source_id: string
          voting_id?: number | null
        }
        Update: {
          ai_disclaimer?: string
          ai_generated?: boolean
          ai_generated_at?: string
          ai_model?: string
          ai_prompt_ver?: string
          body_md?: string
          cost_usd?: number | null
          created_at?: string
          eli_address?: string | null
          human_reviewed_at?: string | null
          human_reviewed_by?: string | null
          id?: string
          input_tokens?: number | null
          kind?: Database["public"]["Enums"]["ai_content_kind"]
          output_tokens?: number | null
          print_number?: string | null
          promise_id?: string | null
          published?: boolean
          source_id?: string
          voting_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_contents_print_number_fkey"
            columns: ["print_number"]
            isOneToOne: false
            referencedRelation: "legislative_processes"
            referencedColumns: ["print_number"]
          },
          {
            foreignKeyName: "ai_contents_promise_id_fkey"
            columns: ["promise_id"]
            isOneToOne: false
            referencedRelation: "promises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_contents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_contents_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_contents_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings_niezgodne"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_declarations: {
        Row: {
          data: Json
          entered_by: string
          id: string
          mp_id: number
          pdf_source_id: string
          published: boolean
          verified_at: string | null
          verified_by: string | null
          year: number
        }
        Insert: {
          data?: Json
          entered_by: string
          id?: string
          mp_id: number
          pdf_source_id: string
          published?: boolean
          verified_at?: string | null
          verified_by?: string | null
          year: number
        }
        Update: {
          data?: Json
          entered_by?: string
          id?: string
          mp_id?: number
          pdf_source_id?: string
          published?: boolean
          verified_at?: string | null
          verified_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_declarations_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_obecnosc_kontekst"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_declarations_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_stats_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_declarations_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_declarations_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "obecnosc_vs_udzial"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_declarations_pdf_source_id_fkey"
            columns: ["pdf_source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          email: string | null
          fax: string | null
          from_dictionary: boolean
          id: string
          logo_url: string | null
          members_count: number | null
          name: string
          note: string | null
          phone: string | null
          seq: number
          source_id: string
          updated_at: string
        }
        Insert: {
          email?: string | null
          fax?: string | null
          from_dictionary?: boolean
          id: string
          logo_url?: string | null
          members_count?: number | null
          name: string
          note?: string | null
          phone?: string | null
          seq?: number
          source_id: string
          updated_at?: string
        }
        Update: {
          email?: string | null
          fax?: string | null
          from_dictionary?: boolean
          id?: string
          logo_url?: string | null
          members_count?: number | null
          name?: string
          note?: string | null
          phone?: string | null
          seq?: number
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clubs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      error_reports: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          is_subject: boolean
          message: string
          reporter_email: string | null
          status: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          is_subject?: boolean
          message: string
          reporter_email?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          is_subject?: boolean
          message?: string
          reporter_email?: string | null
          status?: string
        }
        Relationships: []
      }
      legislative_processes: {
        Row: {
          closure_date: string | null
          description: string | null
          document_type: string | null
          eli_address: string | null
          isap_url: string | null
          passed: boolean | null
          print_number: string
          process_start: string | null
          rcl_url: string | null
          source_id: string
          term: number
          title: string
          title_final: string | null
          updated_at: string
          urgency_status: string | null
        }
        Insert: {
          closure_date?: string | null
          description?: string | null
          document_type?: string | null
          eli_address?: string | null
          isap_url?: string | null
          passed?: boolean | null
          print_number: string
          process_start?: string | null
          rcl_url?: string | null
          source_id: string
          term: number
          title: string
          title_final?: string | null
          updated_at?: string
          urgency_status?: string | null
        }
        Update: {
          closure_date?: string | null
          description?: string | null
          document_type?: string | null
          eli_address?: string | null
          isap_url?: string | null
          passed?: boolean | null
          print_number?: string
          process_start?: string | null
          rcl_url?: string | null
          source_id?: string
          term?: number
          title?: string
          title_final?: string | null
          updated_at?: string
          urgency_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legislative_processes_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      list_votes: {
        Row: {
          mp_id: number
          option_key: string
          value: Database["public"]["Enums"]["vote_value"]
          voting_id: number
        }
        Insert: {
          mp_id: number
          option_key: string
          value: Database["public"]["Enums"]["vote_value"]
          voting_id: number
        }
        Update: {
          mp_id?: number
          option_key?: string
          value?: Database["public"]["Enums"]["vote_value"]
          voting_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_votes_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_obecnosc_kontekst"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_votes_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_stats_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_votes_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_votes_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "obecnosc_vs_udzial"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_votes_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_votes_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings_niezgodne"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_absence_monthly: {
        Row: {
          absent: number
          absent_pct: number | null
          month: string
          mp_id: number
          present: number
          votings: number
        }
        Insert: {
          absent: number
          absent_pct?: number | null
          month: string
          mp_id: number
          present: number
          votings: number
        }
        Update: {
          absent?: number
          absent_pct?: number | null
          month?: string
          mp_id?: number
          present?: number
          votings?: number
        }
        Relationships: [
          {
            foreignKeyName: "mp_absence_monthly_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_obecnosc_kontekst"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_absence_monthly_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_stats_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_absence_monthly_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_absence_monthly_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "obecnosc_vs_udzial"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_roles: {
        Row: {
          created_at: string
          date_from: string
          date_to: string | null
          id: string
          mp_id: number
          role_kind: string
          role_name: string
          source_id: string
        }
        Insert: {
          created_at?: string
          date_from: string
          date_to?: string | null
          id?: string
          mp_id: number
          role_kind: string
          role_name: string
          source_id: string
        }
        Update: {
          created_at?: string
          date_from?: string
          date_to?: string | null
          id?: string
          mp_id?: number
          role_kind?: string
          role_name?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mp_roles_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_obecnosc_kontekst"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_roles_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_stats_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_roles_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_roles_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "obecnosc_vs_udzial"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_roles_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_stats: {
        Row: {
          absent_count: number | null
          attendance_hi: number | null
          attendance_lo: number | null
          attendance_pct: number | null
          computed_at: string
          first_voted_at: string | null
          last_voted_at: string | null
          loyalty_hi: number | null
          loyalty_lo: number | null
          loyalty_pct: number | null
          loyalty_skipped: number | null
          loyalty_skipped_nostance: number | null
          loyalty_skipped_onlist: number | null
          loyalty_votings: number | null
          mp_id: number
          present_count: number | null
          voted_pct: number | null
          votes_cast: number
          votes_total: number
        }
        Insert: {
          absent_count?: number | null
          attendance_hi?: number | null
          attendance_lo?: number | null
          attendance_pct?: number | null
          computed_at?: string
          first_voted_at?: string | null
          last_voted_at?: string | null
          loyalty_hi?: number | null
          loyalty_lo?: number | null
          loyalty_pct?: number | null
          loyalty_skipped?: number | null
          loyalty_skipped_nostance?: number | null
          loyalty_skipped_onlist?: number | null
          loyalty_votings?: number | null
          mp_id: number
          present_count?: number | null
          voted_pct?: number | null
          votes_cast?: number
          votes_total?: number
        }
        Update: {
          absent_count?: number | null
          attendance_hi?: number | null
          attendance_lo?: number | null
          attendance_pct?: number | null
          computed_at?: string
          first_voted_at?: string | null
          last_voted_at?: string | null
          loyalty_hi?: number | null
          loyalty_lo?: number | null
          loyalty_pct?: number | null
          loyalty_skipped?: number | null
          loyalty_skipped_nostance?: number | null
          loyalty_skipped_onlist?: number | null
          loyalty_votings?: number | null
          mp_id?: number
          present_count?: number | null
          voted_pct?: number | null
          votes_cast?: number
          votes_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "mp_stats_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: true
            referencedRelation: "mp_obecnosc_kontekst"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_stats_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: true
            referencedRelation: "mp_stats_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_stats_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: true
            referencedRelation: "mps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mp_stats_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: true
            referencedRelation: "obecnosc_vs_udzial"
            referencedColumns: ["id"]
          },
        ]
      }
      mps: {
        Row: {
          active: boolean
          birth_date: string | null
          birth_location: string | null
          club_seq: number | null
          district_name: string | null
          district_num: number | null
          education_level: string | null
          first_name: string
          first_seen_at: string
          full_name: string | null
          id: number
          inactive_cause: string | null
          last_name: string
          mandate_expiry_date: string | null
          nsf_id: string | null
          number_of_votes: number | null
          oath_date: string | null
          photo_url: string | null
          profession: string | null
          second_name: string | null
          slug: string
          source_id: string
          term: number
          updated_at: string
          voivodeship: string | null
          waiver_desc: string | null
        }
        Insert: {
          active?: boolean
          birth_date?: string | null
          birth_location?: string | null
          club_seq?: number | null
          district_name?: string | null
          district_num?: number | null
          education_level?: string | null
          first_name: string
          first_seen_at?: string
          full_name?: string | null
          id: number
          inactive_cause?: string | null
          last_name: string
          mandate_expiry_date?: string | null
          nsf_id?: string | null
          number_of_votes?: number | null
          oath_date?: string | null
          photo_url?: string | null
          profession?: string | null
          second_name?: string | null
          slug: string
          source_id: string
          term?: number
          updated_at?: string
          voivodeship?: string | null
          waiver_desc?: string | null
        }
        Update: {
          active?: boolean
          birth_date?: string | null
          birth_location?: string | null
          club_seq?: number | null
          district_name?: string | null
          district_num?: number | null
          education_level?: string | null
          first_name?: string
          first_seen_at?: string
          full_name?: string | null
          id?: number
          inactive_cause?: string | null
          last_name?: string
          mandate_expiry_date?: string | null
          nsf_id?: string | null
          number_of_votes?: number | null
          oath_date?: string | null
          photo_url?: string | null
          profession?: string | null
          second_name?: string | null
          slug?: string
          source_id?: string
          term?: number
          updated_at?: string
          voivodeship?: string | null
          waiver_desc?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mps_club_seq_fkey"
            columns: ["club_seq"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["seq"]
          },
          {
            foreignKeyName: "mps_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      process_stages: {
        Row: {
          child_print: string | null
          ordinal: number
          print_number: string
          stage_date: string | null
          stage_name: string
          stage_type: string | null
          voting_id: number | null
        }
        Insert: {
          child_print?: string | null
          ordinal: number
          print_number: string
          stage_date?: string | null
          stage_name: string
          stage_type?: string | null
          voting_id?: number | null
        }
        Update: {
          child_print?: string | null
          ordinal?: number
          print_number?: string
          stage_date?: string | null
          stage_name?: string
          stage_type?: string | null
          voting_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "process_stages_print_number_fkey"
            columns: ["print_number"]
            isOneToOne: false
            referencedRelation: "legislative_processes"
            referencedColumns: ["print_number"]
          },
          {
            foreignKeyName: "process_stages_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_stages_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings_niezgodne"
            referencedColumns: ["id"]
          },
        ]
      }
      promise_votes: {
        Row: {
          created_at: string
          promise_id: string
          user_id: string
          verdict: Database["public"]["Enums"]["promise_status"]
        }
        Insert: {
          created_at?: string
          promise_id: string
          user_id: string
          verdict: Database["public"]["Enums"]["promise_status"]
        }
        Update: {
          created_at?: string
          promise_id?: string
          user_id?: string
          verdict?: Database["public"]["Enums"]["promise_status"]
        }
        Relationships: [
          {
            foreignKeyName: "promise_votes_promise_id_fkey"
            columns: ["promise_id"]
            isOneToOne: false
            referencedRelation: "promises"
            referencedColumns: ["id"]
          },
        ]
      }
      promises: {
        Row: {
          club_seq: number | null
          created_at: string
          created_by: string | null
          evidence_source_id: string
          id: string
          mp_id: number | null
          published: boolean
          quote: string
          said_at: string
          status: Database["public"]["Enums"]["promise_status"]
          title: string
          verifying_print: string | null
          verifying_voting_id: number | null
        }
        Insert: {
          club_seq?: number | null
          created_at?: string
          created_by?: string | null
          evidence_source_id: string
          id?: string
          mp_id?: number | null
          published?: boolean
          quote: string
          said_at: string
          status?: Database["public"]["Enums"]["promise_status"]
          title: string
          verifying_print?: string | null
          verifying_voting_id?: number | null
        }
        Update: {
          club_seq?: number | null
          created_at?: string
          created_by?: string | null
          evidence_source_id?: string
          id?: string
          mp_id?: number | null
          published?: boolean
          quote?: string
          said_at?: string
          status?: Database["public"]["Enums"]["promise_status"]
          title?: string
          verifying_print?: string | null
          verifying_voting_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promises_club_seq_fkey"
            columns: ["club_seq"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["seq"]
          },
          {
            foreignKeyName: "promises_evidence_source_id_fkey"
            columns: ["evidence_source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promises_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_obecnosc_kontekst"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promises_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_stats_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promises_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promises_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "obecnosc_vs_udzial"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promises_verifying_print_fkey"
            columns: ["verifying_print"]
            isOneToOne: false
            referencedRelation: "legislative_processes"
            referencedColumns: ["print_number"]
          },
          {
            foreignKeyName: "promises_verifying_voting_id_fkey"
            columns: ["verifying_voting_id"]
            isOneToOne: false
            referencedRelation: "votings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promises_verifying_voting_id_fkey"
            columns: ["verifying_voting_id"]
            isOneToOne: false
            referencedRelation: "votings_niezgodne"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          api_endpoint: string | null
          created_at: string
          http_status: number | null
          id: string
          kind: Database["public"]["Enums"]["source_kind"]
          payload_sha256: string | null
          retrieved_at: string
          snapshot_url: string | null
          url: string
        }
        Insert: {
          api_endpoint?: string | null
          created_at?: string
          http_status?: number | null
          id?: string
          kind: Database["public"]["Enums"]["source_kind"]
          payload_sha256?: string | null
          retrieved_at?: string
          snapshot_url?: string | null
          url: string
        }
        Update: {
          api_endpoint?: string | null
          created_at?: string
          http_status?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["source_kind"]
          payload_sha256?: string | null
          retrieved_at?: string
          snapshot_url?: string | null
          url?: string
        }
        Relationships: []
      }
      subsidies: {
        Row: {
          aid_form: string | null
          aid_purpose: string | null
          beneficiary_name: string
          beneficiary_nip: string | null
          beneficiary_size: string | null
          granted_on: string
          grantor_name: string
          id: number
          imported_at: string
          legal_basis: string | null
          measure_number: string | null
          nip_valid: boolean
          pkd: string | null
          row_sha256: string
          source_id: string
          teryt: string | null
          value_gross_eur: number | null
          value_gross_pln: number | null
          value_nominal_pln: number | null
        }
        Insert: {
          aid_form?: string | null
          aid_purpose?: string | null
          beneficiary_name: string
          beneficiary_nip?: string | null
          beneficiary_size?: string | null
          granted_on: string
          grantor_name: string
          id?: number
          imported_at?: string
          legal_basis?: string | null
          measure_number?: string | null
          nip_valid?: boolean
          pkd?: string | null
          row_sha256: string
          source_id: string
          teryt?: string | null
          value_gross_eur?: number | null
          value_gross_pln?: number | null
          value_nominal_pln?: number | null
        }
        Update: {
          aid_form?: string | null
          aid_purpose?: string | null
          beneficiary_name?: string
          beneficiary_nip?: string | null
          beneficiary_size?: string | null
          granted_on?: string
          grantor_name?: string
          id?: number
          imported_at?: string
          legal_basis?: string | null
          measure_number?: string | null
          nip_valid?: boolean
          pkd?: string | null
          row_sha256?: string
          source_id?: string
          teryt?: string | null
          value_gross_eur?: number | null
          value_gross_pln?: number | null
          value_nominal_pln?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "subsidies_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sudop_gminy: {
        Row: {
          nazwa: string
          nazwy_alternatywne: string[]
          source_id: string
          teryt: string
          updated_at: string
        }
        Insert: {
          nazwa: string
          nazwy_alternatywne?: string[]
          source_id: string
          teryt: string
          updated_at?: string
        }
        Update: {
          nazwa?: string
          nazwy_alternatywne?: string[]
          source_id?: string
          teryt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sudop_gminy_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_state: {
        Row: {
          cursor_at: string | null
          cursor_num: number | null
          job: string
          last_error: string | null
          last_run: string | null
        }
        Insert: {
          cursor_at?: string | null
          cursor_num?: number | null
          job: string
          last_error?: string | null
          last_run?: string | null
        }
        Update: {
          cursor_at?: string | null
          cursor_num?: number | null
          job?: string
          last_error?: string | null
          last_run?: string | null
        }
        Relationships: []
      }
      votes: {
        Row: {
          club_seq: number | null
          mp_id: number
          value: Database["public"]["Enums"]["vote_value"]
          voting_id: number
        }
        Insert: {
          club_seq?: number | null
          mp_id: number
          value: Database["public"]["Enums"]["vote_value"]
          voting_id: number
        }
        Update: {
          club_seq?: number | null
          mp_id?: number
          value?: Database["public"]["Enums"]["vote_value"]
          voting_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "votes_club_seq_fkey"
            columns: ["club_seq"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["seq"]
          },
          {
            foreignKeyName: "votes_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_obecnosc_kontekst"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mp_stats_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "mps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_mp_id_fkey"
            columns: ["mp_id"]
            isOneToOne: false
            referencedRelation: "obecnosc_vs_udzial"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings_niezgodne"
            referencedColumns: ["id"]
          },
        ]
      }
      votings: {
        Row: {
          abstain: number
          description: string | null
          eli_address: string | null
          id: number
          kind: string | null
          majority_type: string | null
          majority_votes: number | null
          no: number
          not_participating: number
          pdf_url: string | null
          print_numbers: string[] | null
          sitting: number
          sitting_day: number | null
          source_id: string
          term: number
          title: string
          topic: string | null
          total_voted: number
          voted_at: string
          voting_number: number
          yes: number
        }
        Insert: {
          abstain?: number
          description?: string | null
          eli_address?: string | null
          id?: number
          kind?: string | null
          majority_type?: string | null
          majority_votes?: number | null
          no?: number
          not_participating?: number
          pdf_url?: string | null
          print_numbers?: string[] | null
          sitting: number
          sitting_day?: number | null
          source_id: string
          term: number
          title: string
          topic?: string | null
          total_voted?: number
          voted_at: string
          voting_number: number
          yes?: number
        }
        Update: {
          abstain?: number
          description?: string | null
          eli_address?: string | null
          id?: number
          kind?: string | null
          majority_type?: string | null
          majority_votes?: number | null
          no?: number
          not_participating?: number
          pdf_url?: string | null
          print_numbers?: string[] | null
          sitting?: number
          sitting_day?: number | null
          source_id?: string
          term?: number
          title?: string
          topic?: string | null
          total_voted?: number
          voted_at?: string
          voting_number?: number
          yes?: number
        }
        Relationships: [
          {
            foreignKeyName: "votings_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      clubs_poza_slownikiem: {
        Row: {
          from_dictionary: boolean | null
          id: string | null
          name: string | null
          note: string | null
          poslow: number | null
        }
        Relationships: []
      }
      dotacje_publiczne: {
        Row: {
          aid_form: string | null
          aid_purpose: string | null
          beneficiary_name: string | null
          beneficiary_nip: string | null
          beneficiary_size: string | null
          gmina: string | null
          gmina_nazwy_alternatywne: string[] | null
          granted_on: string | null
          grantor_name: string | null
          id: number | null
          legal_basis: string | null
          measure_number: string | null
          pkd: string | null
          teryt: string | null
          value_gross_eur: number | null
          value_gross_pln: number | null
          value_nominal_pln: number | null
          zrodlo_pobrano: string | null
          zrodlo_url: string | null
        }
        Relationships: []
      }
      mp_obecnosc_kontekst: {
        Row: {
          absent_count: number | null
          active: boolean | null
          attendance_hi: number | null
          attendance_lo: number | null
          attendance_pct: number | null
          first_voted_at: string | null
          full_name: string | null
          funkcje_panstwowe: string | null
          id: number | null
          inactive_cause: string | null
          klub: string | null
          ksztalt_nieobecnosci: string | null
          last_voted_at: string | null
          loyalty_hi: number | null
          loyalty_lo: number | null
          loyalty_pct: number | null
          loyalty_votings: number | null
          miesiecy_lacznie: number | null
          miesiecy_prawie_bez_obecnosci: number | null
          niepewnosc_pkt: number | null
          powod_zakonczenia: string | null
          present_count: number | null
          slug: string | null
          voted_pct: number | null
          votes_total: number | null
          w_rankingu: boolean | null
          waiver_desc: string | null
          zakres_mandatu: string | null
        }
        Relationships: []
      }
      mp_stats_ranking: {
        Row: {
          absent_count: number | null
          active: boolean | null
          attendance_hi: number | null
          attendance_lo: number | null
          attendance_pct: number | null
          first_voted_at: string | null
          full_name: string | null
          id: number | null
          klub: string | null
          last_voted_at: string | null
          loyalty_hi: number | null
          loyalty_lo: number | null
          loyalty_pct: number | null
          loyalty_votings: number | null
          niepewnosc_pkt: number | null
          pokrycie_kadencji: number | null
          present_count: number | null
          slug: string | null
          voted_pct: number | null
          votes_total: number | null
          zakres_mandatu: string | null
        }
        Relationships: []
      }
      obecnosc_vs_udzial: {
        Row: {
          full_name: string | null
          id: number | null
          klub: string | null
          nieobecny: number | null
          obecnosc: number | null
          obecny_bez_glosu: number | null
          roznica: number | null
          udzial: number | null
          votes_total: number | null
        }
        Relationships: []
      }
      public_ai_contents: {
        Row: {
          ai_disclaimer: string | null
          ai_generated: boolean | null
          ai_generated_at: string | null
          ai_model: string | null
          body_md: string | null
          eli_address: string | null
          id: string | null
          kind: Database["public"]["Enums"]["ai_content_kind"] | null
          print_number: string | null
          promise_id: string | null
          source_retrieved_at: string | null
          source_url: string | null
          voting_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_contents_print_number_fkey"
            columns: ["print_number"]
            isOneToOne: false
            referencedRelation: "legislative_processes"
            referencedColumns: ["print_number"]
          },
          {
            foreignKeyName: "ai_contents_promise_id_fkey"
            columns: ["promise_id"]
            isOneToOne: false
            referencedRelation: "promises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_contents_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_contents_voting_id_fkey"
            columns: ["voting_id"]
            isOneToOne: false
            referencedRelation: "votings_niezgodne"
            referencedColumns: ["id"]
          },
        ]
      }
      votings_niezgodne: {
        Row: {
          abstain: number | null
          id: number | null
          kind: string | null
          no: number | null
          not_participating: number | null
          sitting: number | null
          title: string | null
          votes_absent: number | null
          votes_abstain: number | null
          votes_no: number | null
          votes_yes: number | null
          voting_number: number | null
          yes: number | null
        }
        Relationships: []
      }
      wartosci_glosow: {
        Row: {
          liczy_sie_do_frekwencji: boolean | null
          liczy_sie_do_lojalnosci: boolean | null
          value: Database["public"]["Enums"]["vote_value"] | null
          wystapien: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      refresh_absence_monthly: {
        Args: never
        Returns: {
          updated: number
        }[]
      }
      refresh_mp_stats: {
        Args: never
        Returns: {
          updated: number
        }[]
      }
      wilson_bounds: {
        Args: { proby: number; sukcesy: number; z?: number }
        Returns: {
          dolna: number
          gorna: number
        }[]
      }
    }
    Enums: {
      ai_content_kind:
        | "act_summary"
        | "voting_explainer"
        | "glossary"
        | "promise_context"
      promise_status: "pending" | "kept" | "broken" | "partial" | "disputed"
      source_kind:
        | "sejm_api"
        | "eli_api"
        | "sudop_api"
        | "dane_gov"
        | "gus_bdl"
        | "sejm_pdf"
        | "sejm_nsf"
        | "video"
        | "press"
        | "user_submission"
        | "sudop_csv"
      vote_value:
        | "YES"
        | "NO"
        | "ABSTAIN"
        | "ABSENT"
        | "VOTE_VALID"
        | "VOTE_INVALID"
        | "PRESENT"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      ai_content_kind: [
        "act_summary",
        "voting_explainer",
        "glossary",
        "promise_context",
      ],
      promise_status: ["pending", "kept", "broken", "partial", "disputed"],
      source_kind: [
        "sejm_api",
        "eli_api",
        "sudop_api",
        "dane_gov",
        "gus_bdl",
        "sejm_pdf",
        "sejm_nsf",
        "video",
        "press",
        "user_submission",
        "sudop_csv",
      ],
      vote_value: [
        "YES",
        "NO",
        "ABSTAIN",
        "ABSENT",
        "VOTE_VALID",
        "VOTE_INVALID",
        "PRESENT",
      ],
    },
  },
} as const
