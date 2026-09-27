import type { Episode, RundownSegment } from '../types/index';
import { airStories, Bulletin, BulletinStory, bulletinKindName, bulletinTiming, clockOf, storyTiming, storyTypeOf } from '../shared/bulletins';

const escapeXml = (value: unknown = '') =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** MOS 2.8.5 running-order (roCreate) XML for playout automation and prompters. */
export function generateEpisodeMosXml(episode: Episode): string {
  const segments: RundownSegment[] = [...(episode.rundown || [])].sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
  const totalDurationSec = segments.reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0);

  const stories = segments
    .map(
      (s, idx) => `
    <story>
      <storyID>${escapeXml(s.id)}</storyID>
      <storySlug>${escapeXml(s.title)}</storySlug>
      <storyNumber>${s.orderIndex || idx + 1}</storyNumber>
      <storyType>${escapeXml(s.segmentType)}</storyType>
      <storyPresenter>${escapeXml(s.presenterName || '')}</storyPresenter>
      <storyDuration>${Number(s.durationSeconds) || 0}</storyDuration>
      <storyStartTimeOffset>${escapeXml(s.startTimeOffset || '00:00:00')}</storyStartTimeOffset>
      <storyScript>
        <p>${escapeXml(stripHtml(s.scriptText || ''))}</p>
      </storyScript>${
        s.videoAssetUrl
          ? `
      <mosItem>
        <itemID>${escapeXml(s.id)}_video</itemID>
        <itemSlug>${escapeXml(s.title)}_VT</itemSlug>
        <mosAbstract>${escapeXml(s.videoAssetUrl)}</mosAbstract>
      </mosItem>`
          : ''
      }${
        s.guestName
          ? `
      <guestInfo>
        <guestName>${escapeXml(s.guestName)}</guestName>
        <guestId>${escapeXml(s.guestId || '')}</guestId>
      </guestInfo>`
          : ''
      }
    </story>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<mos>
  <ncsID>MADAR_NRCS</ncsID>
  <roCreate>
    <roID>${escapeXml(episode.id)}</roID>
    <roSlug>${escapeXml(episode.title)}</roSlug>
    <roChannel>${escapeXml(episode.programName || 'Main Channel')}</roChannel>
    <roAirDate>${escapeXml(episode.broadcastDate || '')}</roAirDate>
    <roAirTime>${escapeXml(episode.startTime || '')}</roAirTime>
    <roTotalDuration>${totalDurationSec}</roTotalDuration>
    <roMetadata>
      <studio>${escapeXml(episode.studioName || '')}</studio>
      <presenter>${escapeXml(episode.presenterName || '')}</presenter>
      <producer>${escapeXml(episode.producerName || '')}</producer>
      <director>${escapeXml(episode.directorName || '')}</director>
      <status>${escapeXml(episode.status || '')}</status>
    </roMetadata>${stories}
  </roCreate>
</mos>`;
}

/**
 * MOS running order for a news bulletin: aired stories in order with anchor, timing, the
 * approved script, the clip and the graphics (lower thirds, full screens) as MOS items.
 */
export function generateBulletinMosXml(bulletin: Bulletin, stories: BulletinStory[], media: { id: string; fileName?: string; title?: string; url?: string }[]): string {
  const list = airStories(stories);
  const timing = bulletinTiming(bulletin, stories);
  const body = list
    .map((s, idx) => {
      const t = storyTiming(s);
      const clip = s.clipMediaId ? media.find((m) => m.id === s.clipMediaId) : undefined;
      const items = [
        clip
          ? `
      <mosItem>
        <itemID>${escapeXml(s.id)}_clip</itemID>
        <itemSlug>${escapeXml(s.slug)}_${escapeXml(storyTypeOf(s.type).code)}</itemSlug>
        <objID>${escapeXml(clip.id)}</objID>
        <mosAbstract>${escapeXml(clip.title || clip.fileName || '')}</mosAbstract>
        <objDur>${t.clip}</objDur>
      </mosItem>`
          : '',
        ...(s.graphics || []).map(
          (g, gi) => `
      <mosItem>
        <itemID>${escapeXml(s.id)}_cg${gi + 1}</itemID>
        <itemSlug>${escapeXml(g.kind)}</itemSlug>
        <mosAbstract>${escapeXml(g.lines.join(' | '))}</mosAbstract>
      </mosItem>`
        ),
      ].join('');
      return `
    <story>
      <storyID>${escapeXml(s.id)}</storyID>
      <storySlug>${escapeXml(s.slug)}</storySlug>
      <storyNumber>${idx + 1}</storyNumber>
      <storyType>${escapeXml(storyTypeOf(s.type).code)}</storyType>
      <storyPresenter>${escapeXml(s.anchorName || bulletin.anchors[0] || '')}</storyPresenter>
      <storyStatus>${escapeXml(s.status)}</storyStatus>
      <storyDuration>${t.total}</storyDuration>
      <storyReadTime>${t.read}</storyReadTime>
      <storyFrontTime>${escapeXml(clockOf(timing.rows.get(s.id)?.front || 0))}</storyFrontTime>
      <storyScript>
        <p>${escapeXml(s.status === 'APPROVED' ? s.script : '')}</p>
      </storyScript>${items}
    </story>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<mos>
  <ncsID>MADAR_NRCS</ncsID>
  <roCreate>
    <roID>${escapeXml(bulletin.id)}</roID>
    <roSlug>${escapeXml(bulletin.title)}</roSlug>
    <roChannel>${escapeXml(bulletinKindName(bulletin.kind))}</roChannel>
    <roAirDate>${escapeXml(bulletin.date)}</roAirDate>
    <roAirTime>${escapeXml(bulletin.startTime)}</roAirTime>
    <roEdStart>${escapeXml(clockOf(timing.start))}</roEdStart>
    <roEdDur>${timing.planned}</roEdDur>
    <roTotalDuration>${timing.total}</roTotalDuration>
    <roMetadata>
      <studio>${escapeXml(bulletin.studioName || '')}</studio>
      <presenter>${escapeXml(bulletin.anchors.join(', '))}</presenter>
      <editor>${escapeXml(bulletin.editorName || '')}</editor>
      <status>${escapeXml(bulletin.status)}</status>
    </roMetadata>${body}
  </roCreate>
</mos>`;
}
