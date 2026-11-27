export interface NewsCorrection {
  id: string; newsId: string; newsVersion: number; reason: string; summary: string;
  actorId: string; actorName: string; createdAt: string; relatedCorrectionId?: string;
}
export interface CreateCorrectionInput {
  newsId: string; expectedVersion: number; reason: string; summary: string;
  requestId: string; relatedCorrectionId?: string;
}
export const BULLETIN_SOURCE_CORRECTION = 'BULLETIN_SOURCE_CORRECTION';
