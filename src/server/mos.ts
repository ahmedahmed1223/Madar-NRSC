import type { Episode, RundownSegment } from '../types/index';

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
