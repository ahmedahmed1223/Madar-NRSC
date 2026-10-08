import { z } from 'zod';

const id = z.string().min(1).max(200);
export const offlineAirPacketSchema = z.object({
  version: z.literal(1), packetId: id, dbId: id, userId: id,
  preparedAt: z.iso.datetime(), shellVersion: id, proof: z.string().min(1).max(200),
  show: z.object({
    id, title: z.string().max(500),
    segments: z.array(z.object({
      id, title: z.string().max(500), script: z.string().max(200000),
      durationSeconds: z.number().finite().min(0).max(86400),
      notes: z.string().max(20000), approved: z.boolean(),
    })).min(1).max(2000).refine(rows => new Set(rows.map(row => row.id)).size === rows.length),
  }),
  baseRows: z.array(z.object({
    collection: z.enum(['episodes', 'bulletinStories', 'bulletins']), id,
    segmentId: id.optional(), v: z.number().int().positive(), updatedAt: z.string().optional(),
  })).max(4001),
  confirmedState: z.record(z.string(), z.unknown()).nullable(),
  canOperate: z.boolean(), canEdit: z.boolean(),
});
export type OfflineAirPacket = z.infer<typeof offlineAirPacketSchema>;
export function offlinePacketError(value: unknown): string | null {
  return offlineAirPacketSchema.safeParse(value).success ? null : 'نسخة الحلقة غير مكتملة أو غير صالحة';
}
