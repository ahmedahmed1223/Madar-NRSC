/**
 * Types & Data Models for Broadcast Newsroom & Program Production System
 */

import type { BookingStatus, ContactLogEntry, EpisodeBrief, EpisodeTopic, ProgramTemplate, QuestionKind, ReportBrief, SegmentGuest } from '../shared/episodePlan';

export type UserRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'EDITOR'
  | 'JOURNALIST'
  | 'PRODUCER'
  | 'PRESENTER'
  | 'REPORTER'
  | 'MEDIA'
  | 'CREW'
  | 'VIEWER';


export interface User {
  id: string;
  fullName: string;
  fullNameEn?: string;
  email: string;
  phone?: string;
  role: UserRole;
  customRoleId?: string;
  avatarUrl: string;
  jobTitle: string;
  /** Display name of the department (kept in sync with departmentId). */
  department: string;
  /** Structured department id (see shared/departments). */
  departmentId?: string;
  staffId?: string;
  bio?: string;
  lastLogin?: string;
  twoFactorEnabled?: boolean;
  customPermissions?: string[];
  isActive: boolean;
  createdAt: string;
  deletedAt?: string | null;
}

export interface Permission {
  code: string;
  nameAr: string;
  category: string;
}

export type NewsPriority = 'CRITICAL' | 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW' | 'MEDIUM';

export type NewsStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'UNDER_REVIEW'
  | 'NEEDS_REVISION'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'ARCHIVED'
  | 'REJECTED'
  | 'UNPUBLISHED';

export interface Category {
  id: string;
  nameAr: string;
  nameEn?: string;
  slug?: string;
  color?: string;
  colorCode?: string;
  orderIndex?: number;
  description?: string;
}

export type SourceType =
  | 'REPORTER'
  | 'NEWS_AGENCY'
  | 'OFFICIAL_STATEMENT'
  | 'INTERVIEW'
  | 'SOCIAL_MEDIA'
  | 'SPECIAL_SOURCE'
  | 'OTHER'
  | (string & {});

export interface NewsSource {
  id: string;
  name: string;
  type: SourceType;
  reliabilityScore: number; // 1 to 5
  contactInfo?: string;
  notes?: string;
  /** RSS/Atom feed polled by the server into the wire desk. */
  feedUrl?: string;
  feedEnabled?: boolean;
}

/** Fields prefilled into a new story (e.g. from an agency wire). */
export interface NewsDraftSeed {
  wireId?: string;
  /** Planning-diary entry the story is written for. */
  diaryId?: string;
  storyId?: string;
  categoryId?: string;
  locationName?: string;
  title: string;
  summary: string;
  content: string;
  sourceId?: string;
  internalNotes: string;
}

/** An item fetched by the server from an agency feed (read-only for clients). */
export interface WireItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  summary: string;
  link?: string;
  categories: string[];
  publishedAt: string;
  fetchedAt: string;
  /** Marked urgent/flash by the agency (detected at ingest). */
  flash?: boolean;
}

// New Type: Story (representing the overarching event or coverage)
export interface Story {
  id: string;
  title: string;
  description: string;
  slug: string;
  categoryId: string;
  categoryName?: string;
  priority: NewsPriority;
  status: 'ACTIVE' | 'RESOLVED' | 'ARCHIVED';
  keywords: string[];
  locationName?: string;
  startedAt: string;
  endedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface NewsWorkflowLog {
  id: string;
  newsId: string;
  fromStatus: NewsStatus;
  toStatus: NewsStatus;
  changedBy: {
    id: string;
    name: string;
    role: UserRole;
  };
  comment?: string;
  timestamp: string;
}

export interface NewsItem {
  id: string;
  storyId?: string; // Optional link to a parent Story
  title: string;
  shortTitle: string;
  slug: string;
  content: string;
  summary: string;
  mainImageUrl: string;
  videoUrl?: string;
  sourceId: string;
  sourceName?: string;
  /** Agency wire item this story was written from. */
  wireId?: string;
  /** Planning-diary entry this story covers. */
  diaryId?: string;
  /** Library items attached to the story (images, video, audio, documents). */
  mediaIds?: string[];
  categoryId: string;
  categoryName?: string;
  authorId: string;
  authorName?: string;
  editorId?: string;
  editorName?: string;
  approvedById?: string;
  approvedByName?: string;
  approvedAt?: string;
  publishedById?: string;
  publishedByName?: string;
  priority: NewsPriority;
  status: NewsStatus;
  keywords: string[];
  locationName: string;
  eventDate: string;
  publishDate?: string;
  scheduledDate?: string;
  /** Received under embargo: may not be published or aired before this time. */
  embargoUntil?: string;
  embargoNote?: string;
  isBreaking: boolean;
  breakingUntil?: string;
  internalNotes?: string;
  workflowLogs: NewsWorkflowLog[];
  viewsCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// Media Metadata sidecar concept
export interface MediaMetadata {
  id: string;
  assetId: string;
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
  title: string;
  description?: string;
  caption?: string;
  credit?: string;
  copyright?: string;
  author?: string;
  sourceId?: string;
  date?: string;
  location?: string;
  tags: string[];
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  codec?: string;
  fps?: number;
}

export interface BreakingNews {
  id: string;
  newsId?: string;
  title: string;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL';
  isActive: boolean;
  startedAt: string;
  expiresAt: string;
  createdBy: string;
}

export interface ProgramType {
  id: string;
  nameAr: string;
  name?: string;
  description?: string;
}

export interface Program {
  id: string;
  name: string;
  shortName: string;
  description: string;
  coverImageUrl: string;
  typeId: string;
  typeName?: string;
  presenterId: string;
  presenterName?: string;
  producerId: string;
  producerName?: string;
  teamMembers: string[];
  broadcastDays: string[]; // e.g. ['Sunday', 'Tuesday', 'Thursday']
  broadcastTime: string;   // e.g. '20:00'
  durationMinutes: number; // e.g. 50
  channelName: string;
  studioName: string;
  status: 'ACTIVE' | 'HIATUS' | 'ARCHIVED';
  notes?: string;
  episodesCount?: number;
  /** Fixed structure new episodes can start from. */
  template?: ProgramTemplate;
  createdAt: string;
  deletedAt?: string | null;
}

export type EpisodeStatus =
  | 'PLANNING'
  | 'IN_PREPARATION'
  | 'PREPARING'
  | 'READY'
  | 'RECORDING'
  | 'RECORDED'
  | 'EDITING'
  | 'READY_FOR_BROADCAST'
  | 'ON_AIR'
  | 'BROADCASTED'
  | 'ARCHIVED'
  | 'CANCELLED';

export type RundownSegmentType =
  | 'INTRO'
  | 'REPORT'
  | 'LIVE_INTERVIEW'
  | 'NEWS_ITEM'
  | 'BREAK'
  | 'OUTRO'
  | 'DISCUSSION';

export interface RundownSegment {
  id: string;
  episodeId: string;
  orderIndex: number;
  orderNumber?: number;
  title: string;
  segmentType: RundownSegmentType;
  startTimeOffset: string; // '00:00:00'
  durationSeconds: number; // e.g. 180 (3 min)
  plannedDurationFormatted?: string;
  endTimeOffset: string;   // '00:03:00'
  presenterName?: string;
  guestId?: string;
  guestName?: string;
  scriptText: string;
  script?: string;
  videoAssetUrl?: string;
  /** Library items used by the segment (the edited package, stills, audio). */
  mediaIds?: string[];
  newsId?: string;
  newsTitle?: string;
  notes?: string;
  isCompleted?: boolean;
  /** The episode topic (محور) this segment belongs to. */
  topicId?: string;
  /** Everyone speaking in the segment; guestId/guestName mirror the main guest. */
  guests?: SegmentGuest[];
  /** Brief for a filmed report: who films it, where, what is needed. */
  report?: ReportBrief;
}

export interface EpisodeQuestion {
  id: string;
  episodeId: string;
  topicName: string;
  questionText: string;
  orderIndex: number;
  assignedToName?: string;
  notes?: string;
  isAsked: boolean;
  segmentId?: string;
  guestId?: string;
  kind?: QuestionKind;
  /** For follow-up questions: the question they follow. */
  parentId?: string;
}

export interface EpisodeGuest {
  id?: string;
  guestId: string;
  guestName: string;
  fullName?: string;
  guestAvatar?: string;
  avatarUrl?: string;
  organization?: string;
  jobTitle?: string;
  specialty?: string;
  connectionType: 'STUDIO' | 'SATELLITE' | 'ZOOM_SKYPE' | 'PHONE';
  segmentTopic: string;
  arrivalStatus: 'CONFIRMED' | 'PENDING' | 'ARRIVED';
  orderIndex?: number;
  notes?: string;
  bookingStatus?: BookingStatus;
  backupGuestId?: string;
  backupGuestName?: string;
  contactLog?: ContactLogEntry[];
  /** Lower-third lines for the graphics desk. */
  cgName?: string;
  cgTitle?: string;
  /** What the producer wants to get from this guest. */
  briefPoints?: string;
  phone?: string;
}

export interface Episode {
  id: string;
  programId: string;
  programName?: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  description: string;
  recordingDate?: string;
  broadcastDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  plannedDurationMinutes?: number;
  presenterId?: string;
  presenterName?: string;
  producerId?: string;
  producerName?: string;
  directorName?: string;
  studioName: string;
  studioId?: string;
  introScript?: string;
  discussionTopics?: string[];
  directorNotes?: string;
  presenterNotes?: string;
  status: EpisodeStatus;
  guests?: (Guest | EpisodeGuest)[];
  questions?: EpisodeQuestion[];
  rundown?: RundownSegment[];
  rundownSegments?: RundownSegment[];
  linkedNewsIds?: string[];
  attachments?: MediaFile[];
  brief?: EpisodeBrief;
  topics?: EpisodeTopic[];
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface Guest {
  id: string;
  fullName: string;
  avatarUrl: string;
  organization: string;
  jobTitle: string;
  specialty: string;
  phone: string;
  email: string;
  notes?: string;
  totalAppearances: number;
  lastAppearanceDate?: string;
  appearanceHistory?: {
    episodeId: string;
    episodeTitle: string;
    programName: string;
    date: string;
  }[];
  createdAt: string;
  deletedAt?: string | null;
  // Compatibility fields when rendered in episode context
  guestId?: string;
  guestName?: string;
  guestAvatar?: string;
  connectionType?: 'STUDIO' | 'SATELLITE' | 'ZOOM_SKYPE' | 'PHONE';
  segmentTopic?: string;
  arrivalStatus?: 'CONFIRMED' | 'PENDING' | 'ARRIVED';
}

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'DONE' | 'COMPLETED' | 'CANCELLED';
export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'URGENT' | 'NORMAL';

export interface EditorialTask {
  id: string;
  title: string;
  description?: string;
  assigneeId?: string;
  assigneeName?: string;
  assignedToId?: string;
  assignedToName?: string;
  assigneeAvatar?: string;
  creatorId?: string;
  creatorName?: string;
  createdById?: string;
  createdByName?: string;
  priority: TaskPriority | NewsPriority;
  status: TaskStatus;
  startDate?: string;
  dueDate?: string;
  relatedEntityType?: 'NEWS' | 'EPISODE' | 'PROGRAM' | 'GENERAL';
  relatedEntityId?: string;
  relatedEntityTitle?: string;
  notes?: string;
  createdAt?: string;
}

export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'PDF';

export interface MediaFile {
  id: string;
  fileName: string;
  originalName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  fileSize?: number;
  url?: string;
  fileUrl?: string;
  title?: string;
  durationSeconds?: number;
  mediaType: MediaType;
  ownerId?: string;
  ownerName?: string;
  uploadedById?: string;
  uploadedByName?: string;
  tags: string[];
  description?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Video workflow: RAW -> EDITING -> READY -> APPROVED (see shared/production). */
  videoStatus?: 'RAW' | 'EDITING' | 'READY' | 'APPROVED';
  /** Montage editor handling the video. */
  editorId?: string;
  editorName?: string;
  createdAt?: string;
}

export type MediaAsset = MediaFile & {
  title?: string;
  fileUrl?: string;
  fileSize?: number;
  durationSeconds?: number;
  uploadedById?: string;
  uploadedByName?: string;
};

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'TASK_ASSIGNED' | 'TASK' | 'NEWS_REVIEW' | 'NEWS_APPROVED' | 'NEWS_REJECTED' | 'EPISODE_SCHEDULE' | 'BREAKING_NEWS' | 'SYSTEM';
  /** Delivery category (see shared/notifications) — decides e-mail/push per colleague. */
  category?: string;
  urgent?: boolean;
  linkUrl?: string;
  isRead: boolean;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  userAvatar?: string;
  action: string;
  entityType: string;
  entityId: string;
  entityTitle: string;
  summaryAr: string;
  timestamp: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action?: string;
  actionType?: 'LOGIN' | 'LOGOUT' | 'PASSWORD_CHANGE' | 'ROLE_CHANGE' | 'PUBLISH' | 'UNPUBLISH' | 'DELETE' | 'SETTINGS_UPDATE' | string;
  targetEntity?: string;
  entityType?: string;
  targetId?: string;
  severity?: 'INFO' | 'WARNING' | 'SECURITY' | string;
  details: string;
  ipAddress?: string;
  timestamp?: string;
  createdAt?: string;
}

export interface SystemSettings {
  organizationName: string;
  organizationNameEn: string;
  logoUrl: string;
  defaultTimezone: string;
  defaultLanguage: string;
  primaryChannelName: string;
  autoSaveIntervalSeconds: number;
  allowGuestProposals: boolean;
  enableAuditLog: boolean;
  defaultSegmentDurationSeconds?: number;
  /** Station-wide date/time conventions (see shared/dateFormat). */
  dateTime?: Partial<import('../shared/dateFormat').DateTimeSettings>;
}

export interface DbTableInfo {
  name: string;
  rowCount: number;
  columns: string[];
}

export interface DbStats {
  engine: string;
  filePath: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  totalTables: number;
  totalRows: number;
  tables: DbTableInfo[];
  lastSyncAt: string;
  isHealthy: boolean;
}

export interface SqlQueryResult {
  columns: string[];
  values: (string | number | boolean | null)[][];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

export interface DbBackupFileInfo {
  fileName: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
}

