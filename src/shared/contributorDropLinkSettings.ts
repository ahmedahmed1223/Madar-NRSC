type DropLinkPolicy = {
  contributorDropLinkDailyLimit?: number;
  contributorDropLinkExpiryHours?: number;
};

export const CONTRIBUTOR_DROP_LINK_DEFAULTS = { dailyLimit: 10, expiryHours: 24 } as const;
export const MAX_CONTRIBUTOR_DROP_LINKS_PER_DAY = 100;
export const MAX_CONTRIBUTOR_DROP_LINK_EXPIRY_HOURS = 24;

export function contributorDropLinkSettings(settings?: DropLinkPolicy | null) {
  const limit = settings?.contributorDropLinkDailyLimit;
  const expiry = settings?.contributorDropLinkExpiryHours;
  return {
    dailyLimit: limit !== undefined && Number.isInteger(limit) && limit >= 0 && limit <= MAX_CONTRIBUTOR_DROP_LINKS_PER_DAY
      ? limit : CONTRIBUTOR_DROP_LINK_DEFAULTS.dailyLimit,
    expiryHours: expiry !== undefined && Number.isInteger(expiry) && expiry >= 1 && expiry <= MAX_CONTRIBUTOR_DROP_LINK_EXPIRY_HOURS
      ? expiry : CONTRIBUTOR_DROP_LINK_DEFAULTS.expiryHours,
  };
}

export function contributorDropLinkSettingsError(settings: DropLinkPolicy): string | null {
  const effective = contributorDropLinkSettings(settings);
  if (settings.contributorDropLinkDailyLimit !== undefined && settings.contributorDropLinkDailyLimit !== effective.dailyLimit) {
    return `الحد اليومي لروابط الرفع عدد صحيح بين 0 و${MAX_CONTRIBUTOR_DROP_LINKS_PER_DAY}.`;
  }
  if (settings.contributorDropLinkExpiryHours !== undefined && settings.contributorDropLinkExpiryHours !== effective.expiryHours) {
    return `صلاحية رابط الرفع بين ساعة واحدة و${MAX_CONTRIBUTOR_DROP_LINK_EXPIRY_HOURS} ساعة.`;
  }
  return null;
}
