import { create } from "zustand";

type DraftState = {
  rawDraft: number;
  stableDraft: number;
  confidence: number;
  waterlineY: number;
  setFrameResult: (data: FrameResult) => void;
};

export type FrameResult = {
  rawDraft: number;
  stableDraft: number;
  confidence: number;
  waterlineY: number;
};

export const useDraftStore = create<DraftState>((set) => ({
  rawDraft: 0,
  stableDraft: 0,
  confidence: 0,
  waterlineY: 0,
  setFrameResult: (data) =>
    set(() => ({
      rawDraft: data.rawDraft,
      stableDraft: data.stableDraft,
      confidence: data.confidence,
      waterlineY: data.waterlineY,
    })),
}));
