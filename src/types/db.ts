/**
 * ============================================================================
 *  PLIK TYMCZASOWY - ZASTAP GENEROWANYM
 * ============================================================================
 *
 * To jest luzna atrapa, zeby projekt kompilowal sie zanim istnieje projekt
 * Supabase. Pierwsza rzecz w Sprincie 1:
 *
 *   npx supabase login
 *   SUPABASE_PROJECT_ID=xxxx npm run db:types
 *
 * Generator NADPISZE ten plik dokladnymi typami z migracji 0001_init.sql
 * i od tego momentu literowka w nazwie kolumny wywali build, a nie produkcje.
 * Dopoki tu stoi `any`, tej ochrony nie ma - nie zostawiaj tego stanu na dluzej.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type LooseTable = {
  Row: Record<string, any>;
  Insert: Record<string, any>;
  Update: Record<string, any>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: { [table: string]: LooseTable };
    Views: { [view: string]: { Row: Record<string, any> } };
    Functions: Record<string, never>;
    Enums: {
      source_kind:
        | 'sejm_api' | 'eli_api' | 'sudop_api' | 'dane_gov' | 'gus_bdl'
        | 'sejm_pdf' | 'sejm_nsf' | 'video' | 'press' | 'user_submission';
      vote_value: 'YES' | 'NO' | 'ABSTAIN' | 'ABSENT' | 'VOTE_VALID' | 'VOTE_INVALID';
      promise_status: 'pending' | 'kept' | 'broken' | 'partial' | 'disputed';
      ai_content_kind: 'act_summary' | 'voting_explainer' | 'glossary' | 'promise_context';
    };
    CompositeTypes: Record<string, never>;
  };
};

export type VoteValue = Database['public']['Enums']['vote_value'];
export type SourceKind = Database['public']['Enums']['source_kind'];
