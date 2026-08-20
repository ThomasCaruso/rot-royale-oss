export interface OfflineRound {
  question_id: string;
  idx: number;
  client_spec: { prompt: string; options: string[]; category: string; icon: string; time_limit_ms: number };
  option_source_index: number[];
  correct_index: number;
  explanation: string | null;
}
export interface CampaignBundleLevel {
  world: string; level: number; title: string; is_boss: boolean; seed: number; rounds: OfflineRound[];
}
export interface CampaignBundle { bank_version: string; levels: CampaignBundleLevel[]; }
export interface PracticePool { category: string | null; bank_version: string; questions: OfflineRound[]; }

export interface OfflineItem { question_id: string; selected_source_index: number; elapsed_ms: number; }

export type OutboxRecord =
  | { kind: "campaign"; client_id: string; created_at: number; attempts: number;
      payload: { world: string; level: number; items: OfflineItem[] } }
  | { kind: "practice"; client_id: string; created_at: number; attempts: number;
      payload: { mode: string | null; category: string | null; items: OfflineItem[] } };
