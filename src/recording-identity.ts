import { z } from 'zod';
import { sameCatalogueItem, sameMetadataPresentation, type IdentityMedia } from './catalogue-grouping.js';

const external = z.array(z.tuple([z.string().max(100), z.string().max(500)])).max(100).optional();
const artist = z.object({ name: z.string().max(500), external_ids: external });
export const recordingEvidenceSchema = z.object({
  item_id: z.string().min(1).max(2048), provider: z.string().min(1).max(200),
  name: z.string().max(1000), version: z.string().max(500), external_ids: external,
  provider_mappings: z.array(z.object({ item_id: z.string().max(2048).optional(),
    provider_instance: z.string().max(200).optional(), provider_domain: z.string().max(200).optional() })).max(100).optional(),
  duration: z.number().finite().nonnegative().optional(), artists: z.array(artist).max(100).optional(),
  album: z.object({ name: z.string().max(1000), version: z.string().max(500).optional(), year: z.number().nullable().optional(), external_ids: external }).nullable().optional(),
  metadata: z.object({ explicit: z.boolean().nullable().optional() }).optional(),
  disc_number: z.number().int().nonnegative().optional(), track_number: z.number().int().nonnegative().optional(),
});
export const recordingReferenceSchema = z.object({
  provider: z.string().min(1).max(200), itemId: z.string().min(1).max(2048),
  uri: z.string().min(1).max(4096).regex(/^[^\x00-\x1f\x7f]+$/), version: z.string().max(500),
}).strict();
export const recordingDescriptorSchema = recordingReferenceSchema.extend({
  identity: recordingEvidenceSchema.optional(), equivalents: z.array(recordingReferenceSchema).max(8).optional(),
});
export type RecordingReference = z.infer<typeof recordingReferenceSchema>;
export type RecordingDescriptor = z.infer<typeof recordingDescriptorSchema>;

export function sameRecordingEvidence(a: IdentityMedia, b: IdentityMedia) {
  const reference = (item: IdentityMedia) => ({ provider: item.provider, itemId: item.item_id,
    uri: `${item.provider}://track/${item.item_id}`, version: item.version });
  // A canonical library response can explicitly map a domain-based selection to
  // its account instance. Metadata guards still veto conflicting recordings.
  return sameCatalogueItem('track', a, b) || (sameMetadataPresentation('track', a, b) &&
    (matchesReference(b, reference(a)) || matchesReference(a, reference(b))));
}
export function matchesReference(media: IdentityMedia & { uri?: string | null }, ref: RecordingReference) {
  return media.version === ref.version && ((media.provider === ref.provider && media.item_id === ref.itemId && (!media.uri || media.uri === ref.uri)) ||
    (media.provider_mappings ?? []).some(m => m.item_id === ref.itemId && (m.provider_instance === ref.provider || m.provider_domain === ref.provider)));
}
