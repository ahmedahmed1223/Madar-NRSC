import { apiService } from '../api';
import type { DocContext } from './builders';

/** The organisation name and the signed-in user, stamped on every exported document. */
export function docContext(): DocContext {
  let user: DocContext['user'] = null;
  try {
    user = apiService.getCurrentUser();
  } catch {
    user = null;
  }
  const mediaName = (id: string) => {
    const m: any = apiService.getMedia().find((x: any) => x.id === id);
    return m ? m.title || m.fileName : undefined;
  };
  return { organization: apiService.getSettings()?.organizationName || '', user, mediaName };
}
