import type { RequestHandler } from 'express';
import { DropboxClient, DropboxError, dropboxMissingScope, type DropboxCredentials } from './dropbox';
import { validDropboxAppKey } from '../shared/dropboxAuthorization';

const trimmed = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function dropboxTeamDirectory(saved: () => DropboxCredentials | undefined): RequestHandler {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const appKey = trimmed(req.body?.appKey);
    const appSecret = trimmed(req.body?.appSecret);
    const refreshToken = trimmed(req.body?.refreshToken);
    const cursor = trimmed(req.body?.cursor);
    const supplied = Boolean(appKey || appSecret || refreshToken);
    if ((supplied && (!validDropboxAppKey(appKey) || !appSecret || appSecret.length > 256 || !refreshToken || refreshToken.length > 4096)) ||
        cursor.length > 4096) {
      res.status(400).json({ success: false, error: 'راجع بيانات تطبيق Dropbox أو أعد تحميل قائمة الفريق.' });
      return;
    }
    const credentials = supplied ? { appKey, appSecret, refreshToken } : saved();
    if (!credentials) {
      res.status(400).json({ success: false, error: 'أدخل مفتاح تطبيق Dropbox والرمز السري ورمز التجديد لعرض أعضاء الفريق.' });
      return;
    }
    try {
      const data = await new DropboxClient(credentials).listActiveTeamMembers(cursor || undefined);
      res.json({ success: true, data });
    } catch (error) {
      if (dropboxMissingScope(error)) {
        res.status(400).json({ success: false, error: 'فعّل إذن members.read في تطبيق Dropbox ثم أعد تفويض حساب الفريق.' });
      } else if (error instanceof DropboxError && error.status < 500 && error.status !== 429) {
        res.status(400).json({ success: false, error: 'تعذر قراءة قائمة الفريق. تحقق من أن رمز التجديد مرتبط بفريق Dropbox وأنه يسمح بقراءة أعضائه.' });
      } else {
        res.status(503).json({ success: false, error: 'تعذر الاتصال بدليل فريق Dropbox الآن. أعد المحاولة.' });
      }
    }
  };
}
